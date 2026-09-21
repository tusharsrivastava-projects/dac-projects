import { Readable } from 'node:stream';
import { GoogleAuthError, getAccessToken, resetTokenCache } from './google.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

export class DriveError extends Error {
  constructor(message, status = null) {
    super(message);
    this.status = status;
  }
}

/** Every Drive call goes through here so the 401-retry lives in one place. */
async function call(creds, url, init = {}, { retry = true } = {}) {
  const token = await getAccessToken(creds);
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });

  if (res.status === 401 && retry) {
    resetTokenCache();
    return call(creds, url, init, { retry: false });
  }
  return res;
}

async function readError(res) {
  const text = await res.text().catch(() => '');
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* raw text is fine */ }
  const reason = parsed?.error?.errors?.[0]?.reason;
  const message = parsed?.error?.message || text.slice(0, 200) || res.statusText;

  if (reason === 'storageQuotaExceeded') {
    return new DriveError(
      'Drive rejected the upload: storage quota exceeded. A service account has no quota of ' +
      'its own — if the folder lives in a personal My Drive, authenticate with GOOGLE_REFRESH_TOKEN ' +
      'instead, or move the folder into a Shared Drive.',
      res.status,
    );
  }
  return new DriveError(`Drive API error (${res.status}): ${message}`, res.status);
}

const escapeQuery = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** Shared-drive support has to be asked for explicitly on every call. */
const SHARED = 'supportsAllDrives=true&includeItemsFromAllDrives=true';

export const folderLink = (id) => `https://drive.google.com/drive/folders/${id}`;
export const fileLink = (id) => `https://drive.google.com/file/d/${id}/view`;

/** Finds a child folder by name, creating it if it is not there yet. */
export async function ensureFolder(creds, name, parentId = null) {
  const clauses = [
    `name = '${escapeQuery(name)}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    'trashed = false',
    parentId ? `'${escapeQuery(parentId)}' in parents` : null,
  ].filter(Boolean).join(' and ');

  const found = await call(creds, `${API}/files?q=${encodeURIComponent(clauses)}&fields=files(id,name)&pageSize=1&${SHARED}`);
  if (!found.ok) throw await readError(found);
  const { files } = await found.json();
  if (files?.length) return files[0].id;

  const created = await call(creds, `${API}/files?fields=id&${SHARED}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  if (!created.ok) throw await readError(created);
  return (await created.json()).id;
}

/**
 * Multipart upload — metadata and bytes in one request. Recordings are a few
 * hundred KB, so a resumable session would only add round trips.
 */
export async function uploadFile(creds, { name, mimeType, buffer, parentId, description = null }) {
  const boundary = `dac-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({
    name,
    ...(parentId ? { parents: [parentId] } : {}),
    ...(description ? { description } : {}),
  });

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const res = await call(creds, `${UPLOAD_API}/files?uploadType=multipart&fields=id,name,size,webViewLink&${SHARED}`, {
    method: 'POST',
    headers: { 'content-type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw await readError(res);

  const file = await res.json();
  return { id: file.id, name: file.name, size: Number(file.size) || buffer.length, link: file.webViewLink || fileLink(file.id) };
}

/**
 * Streams a file back. `range` is passed straight through, so the audio player
 * can scrub without us buffering the whole recording.
 */
export async function downloadFile(creds, fileId, { range = null } = {}) {
  const res = await call(creds, `${API}/files/${encodeURIComponent(fileId)}?alt=media&${SHARED}`, {
    headers: range ? { range } : {},
  });
  if (!res.ok && res.status !== 206) throw await readError(res);

  return {
    status: res.status,
    contentType: res.headers.get('content-type'),
    contentLength: res.headers.get('content-length'),
    contentRange: res.headers.get('content-range'),
    stream: res.body ? Readable.fromWeb(res.body) : null,
  };
}

export async function deleteFile(creds, fileId) {
  const res = await call(creds, `${API}/files/${encodeURIComponent(fileId)}?${SHARED}`, { method: 'DELETE' });
  // A file someone already removed by hand is not an error worth raising.
  if (!res.ok && res.status !== 404) throw await readError(res);
}

export async function getFile(creds, fileId) {
  const res = await call(creds, `${API}/files/${encodeURIComponent(fileId)}?fields=id,name,size,mimeType,webViewLink,trashed&${SHARED}`);
  if (!res.ok) throw await readError(res);
  return res.json();
}

/** Used by the startup check so a misconfiguration surfaces at boot, not mid-interview. */
export async function verifyAccess(creds, folderId) {
  try {
    if (folderId) {
      const file = await getFile(creds, folderId);
      if (file.trashed) throw new DriveError('The configured Drive folder is in the trash.');
      return { ok: true, folderId, name: file.name, link: folderLink(folderId) };
    }
    const id = await ensureFolder(creds, creds.rootFolderName);
    return { ok: true, folderId: id, name: creds.rootFolderName, link: folderLink(id), created: true };
  } catch (err) {
    if (err instanceof GoogleAuthError || err instanceof DriveError) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: `Could not reach Google Drive: ${err.message}` };
  }
}
