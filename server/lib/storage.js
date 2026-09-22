import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db } from '../db/index.js';
import * as drive from './drive.js';
import { parseServiceAccount } from './google.js';

/**
 * Recordings go either to local disk or to a Google Drive folder. Drive is the
 * useful one in practice: a free Render instance has no persistent disk, so a
 * locally stored interview is gone at the next restart — and filing answers
 * into Drive means the panel can also just open the folder and listen.
 */

export const usingDrive = () => config.storageDriver === 'drive';

let credentials = null;
export function driveCredentials() {
  if (!credentials) {
    credentials = {
      ...config.drive,
      serviceAccount: parseServiceAccount(config.drive.serviceAccountRaw),
    };
  }
  return credentials;
}

export function describeDriver() {
  if (!usingDrive()) return `local disk (${config.uploadDir})`;
  if (config.drive.refreshToken) return 'Google Drive (OAuth account)';
  if (config.drive.serviceAccountRaw) return 'Google Drive (service account)';
  // Saying "service account" here would send someone off to mint a key, which
  // is the wrong fix when the folder lives in a personal My Drive.
  return 'Google Drive (no credentials set)';
}

const localPath = (file) => path.join(config.uploadDir, file);

/* ── Drive folder layout ─────────────────────────────────────────────────────
   <root>/<Role title>/<Candidate name> — app<id>/
   so a reviewer can open Drive directly and still find their way around.  */

let rootFolderId = null;

async function ensureRoot() {
  if (rootFolderId) return rootFolderId;
  const creds = driveCredentials();
  rootFolderId = config.drive.folderId || await drive.ensureFolder(creds, config.drive.rootFolderName);
  return rootFolderId;
}

const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Unnamed';

/**
 * Filename stem for one answer. Questions usually end in a question mark or a
 * full stop, which would otherwise leave us with "…finished..webm", and a hard
 * slice can strand a trailing space or a half word.
 */
const answerFileName = (number, prompt, ext) => {
  const stem = safeName(prompt).slice(0, 60).replace(/[\s.]+$/, '') || 'Answer';
  return `Q${number} — ${stem}${ext}`;
};

/**
 * Folders in flight, keyed by application id. Two answers uploaded at the same
 * time would otherwise both miss the cached id — the first one has not written
 * it back yet — and each create their own candidate folder.
 */
const pendingFolders = new Map();

/** Per-application folder, cached on the application row so we ask Drive once. */
async function ensureApplicationFolder(application) {
  if (application.drive_folder_id) return application.drive_folder_id;

  // Another request may have finished since this row was read.
  const fresh = db.prepare('SELECT drive_folder_id, drive_folder_link FROM applications WHERE id = ?')
    .get(application.id);
  if (fresh?.drive_folder_id) {
    application.drive_folder_id = fresh.drive_folder_id;
    application.drive_folder_link = fresh.drive_folder_link;
    return fresh.drive_folder_id;
  }

  if (pendingFolders.has(application.id)) return pendingFolders.get(application.id);

  const work = (async () => {
    const creds = driveCredentials();
    const root = await ensureRoot();
    const roleFolder = await drive.ensureFolder(creds, safeName(application.job_title), root);
    const folderId = await drive.ensureFolder(
      creds,
      `${safeName(application.candidate_name)} — app${application.id}`,
      roleFolder,
    );

    db.prepare('UPDATE applications SET drive_folder_id = ?, drive_folder_link = ? WHERE id = ?')
      .run(folderId, drive.folderLink(folderId), application.id);
    application.drive_folder_id = folderId;
    application.drive_folder_link = drive.folderLink(folderId);
    return folderId;
  })();

  pendingFolders.set(application.id, work);
  try {
    return await work;
  } finally {
    pendingFolders.delete(application.id);
  }
}

/**
 * Takes the file multer just wrote and puts it where it belongs.
 * Returns the columns to store on the answer row.
 *
 * If Drive fails we keep the local file rather than losing the candidate's
 * recording — the admin console flags anything that landed this way.
 */
export async function storeAnswer({ file, application, question, questionNumber }) {
  const base = {
    audio_file: file.filename,
    mime_type: String(file.mimetype || '').split(';')[0],
    size_bytes: file.size,
    storage: 'local',
    drive_file_id: null,
    drive_link: null,
  };

  if (!usingDrive()) return base;

  try {
    const folderId = await ensureApplicationFolder(application);
    const ext = path.extname(file.filename) || '.webm';
    const name = answerFileName(questionNumber, question.prompt, ext);

    const uploaded = await drive.uploadFile(driveCredentials(), {
      name,
      mimeType: base.mime_type || 'audio/webm',
      buffer: fs.readFileSync(localPath(file.filename)),
      parentId: folderId,
      description: [
        `Candidate: ${application.candidate_name} <${application.candidate_email}>`,
        `Role: ${application.job_title} (${application.job_code})`,
        `Question: ${question.prompt}`,
        `Recorded: ${new Date().toISOString()}`,
      ].join('\n'),
    });

    if (!config.drive.keepLocalCopy) fs.rmSync(localPath(file.filename), { force: true });

    return {
      ...base,
      storage: 'drive',
      drive_file_id: uploaded.id,
      drive_link: uploaded.link,
      size_bytes: uploaded.size || file.size,
    };
  } catch (err) {
    // Never block a candidate mid-interview because Drive is unhappy.
    console.error(`[storage] Drive upload failed, keeping the local copy instead: ${err.message}`);
    return { ...base, storage: 'local' };
  }
}

/**
 * Serves a stored recording. Mirrors the shape of a Range response either way,
 * so the route does not have to care which backend it came from.
 */
export async function readAnswer(answer, { range = null } = {}) {
  if (answer.storage === 'drive' && answer.drive_file_id) {
    const res = await drive.downloadFile(driveCredentials(), answer.drive_file_id, { range });
    return {
      kind: 'stream',
      status: res.status === 206 ? 206 : 200,
      contentType: answer.mime_type || res.contentType || 'application/octet-stream',
      contentLength: res.contentLength,
      contentRange: res.contentRange,
      stream: res.stream,
    };
  }

  const file = localPath(answer.audio_file);
  let stat;
  try { stat = fs.statSync(file); } catch { return { kind: 'missing' }; }
  return { kind: 'file', file, size: stat.size, contentType: answer.mime_type || 'application/octet-stream' };
}

/** Best-effort cleanup when a candidate re-records or drops a take. */
export async function removeAnswer(answer) {
  if (answer.storage === 'drive' && answer.drive_file_id) {
    try {
      await drive.deleteFile(driveCredentials(), answer.drive_file_id);
    } catch (err) {
      console.error(`[storage] could not delete Drive file ${answer.drive_file_id}: ${err.message}`);
    }
  }
  if (answer.audio_file) fs.rmSync(localPath(answer.audio_file), { force: true });
}

/** Called at boot so a bad configuration shows up before anyone records. */
export async function checkStorage() {
  if (!usingDrive()) return { ok: true, driver: 'local', detail: config.uploadDir };
  try {
    const result = await drive.verifyAccess(driveCredentials(), config.drive.folderId);
    if (result.ok) rootFolderId = result.folderId;
    return { ...result, driver: 'drive' };
  } catch (err) {
    return { ok: false, driver: 'drive', error: err.message };
  }
}

export const submissionsFolderLink = () =>
  (usingDrive() && rootFolderId) ? drive.folderLink(rootFolderId) : null;

/** Last boot-check result, so the console can say *why* Drive is not working. */
let lastCheck = null;
export const setLastCheck = (result) => { lastCheck = result; };
export const storageStatus = () => ({
  driver: usingDrive() ? 'drive' : 'local',
  label: describeDriver(),
  folderLink: submissionsFolderLink(),
  ok: usingDrive() ? Boolean(lastCheck?.ok) : true,
  error: lastCheck?.ok === false ? lastCheck.error : null,
});
