import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { unsupported } from './errors.js';
import { isSupportedExtension } from './parsers/index.js';

export function ensureDirectories(config) {
  for (const directory of [config.dataDir, config.uploadsDir, config.audioDir, config.tessdataDir]) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

export function extensionOf(filename) {
  return path.extname(String(filename || '')).slice(1).toLowerCase();
}

export function safeDisplayFilename(filename) {
  const base = path.basename(String(filename || 'document'));
  const cleaned = base
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[^\p{L}\p{N}._() \-]+/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return cleaned || 'document';
}

export function relativeToData(config, absolutePath) {
  const absolute = path.resolve(absolutePath);
  const root = path.resolve(config.dataDir);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error('Refusing to use a path outside the LISTNR data directory.');
  }
  return path.relative(root, absolute);
}

export function resolveUploadPath(config, relativePath) {
  if (!relativePath) return null;
  const absolute = path.resolve(config.dataDir, relativePath);
  const uploads = path.resolve(config.uploadsDir);
  if (absolute !== uploads && !absolute.startsWith(uploads + path.sep)) return null;
  return absolute;
}

export function removeUpload(config, relativePath) {
  const absolute = resolveUploadPath(config, relativePath);
  if (!absolute) return;
  try {
    fs.unlinkSync(absolute);
  } catch {
    // Already gone.
  }
}

export function createUploadMiddleware(config) {
  const storage = multer.diskStorage({
    destination(_request, _file, callback) {
      callback(null, config.uploadsDir);
    },
    filename(_request, file, callback) {
      const extension = extensionOf(file.originalname) || 'bin';
      callback(null, `${crypto.randomUUID()}.${extension}`);
    }
  });

  return multer({
    storage,
    limits: { fileSize: config.maxUploadBytes, files: 1 },
    fileFilter(_request, file, callback) {
      const extension = extensionOf(file.originalname);
      if (!isSupportedExtension(extension)) {
        callback(
          unsupported(
            `Unsupported file type. Use ${'.txt, .md, .html, .pdf, .epub, .png, .jpg, .jpeg'}.`
          )
        );
        return;
      }
      callback(null, true);
    }
  });
}
