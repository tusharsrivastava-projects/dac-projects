import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config.js';
import { badRequest } from '../lib/http.js';

const IMAGE = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const DOC = { ...IMAGE, 'application/pdf': '.pdf' };

/**
 * Disk uploads into a named subfolder. Filenames are random; the original
 * name is kept only in the database. `services/` and `avatars/` are served
 * publicly; `private/` is only ever streamed through an access check.
 */
function uploader(folder, types) {
  const dir = path.join(config.uploadDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (_req, file, cb) => cb(null, `${crypto.randomBytes(12).toString('hex')}${types[file.mimetype] || ''}`),
    }),
    limits: { fileSize: config.maxUploadBytes, files: 8 },
    fileFilter: (_req, file, cb) => {
      if (!types[file.mimetype]) return cb(badRequest(`${file.originalname} is not an accepted file type (${Object.values(types).join(', ')}).`));
      cb(null, true);
    },
  });
}

export const serviceImages = uploader('services', IMAGE);
export const avatars = uploader('avatars', IMAGE);
export const privateDocs = uploader('private', DOC);
export const officialQr = uploader('private', IMAGE);

/** Path relative to the upload root, which is what gets stored. */
export const rel = (file) => path.relative(config.uploadDir, file.path).split(path.sep).join('/');
