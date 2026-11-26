import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  source_type TEXT NOT NULL,
  source_url TEXT,
  source_filename TEXT,
  status TEXT NOT NULL DEFAULT 'extracting',
  error TEXT,
  content_json TEXT,
  plain_text TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  segment_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT,
  position_json TEXT,
  settings_json TEXT,
  original_path TEXT
);

CREATE TABLE IF NOT EXISTS segments (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  chapter_index INTEGER NOT NULL,
  paragraph_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (document_id, idx)
);

CREATE INDEX IF NOT EXISTS idx_segments_document ON segments(document_id, idx);

CREATE TABLE IF NOT EXISTS audio_cache (
  key TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audio_last_used ON audio_cache(last_used_at);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const now = () => new Date().toISOString();

const DEFAULT_POSITION = {
  segmentIndex: 0,
  chapterIndex: 0,
  paragraphIndex: 0
};

// The database can hold a TTS API key, so keep it (and its WAL sidecars)
// readable only by the account running LISTNR. Modes are advisory on Windows.
function hardenPermissions(config) {
  if (process.platform === 'win32') return;

  try {
    fs.chmodSync(config.dataDir, 0o700);
  } catch {
    // A mounted volume may refuse the mode change; it still works.
  }

  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.chmodSync(`${config.dbPath}${suffix}`, 0o600);
    } catch {
      // Sidecars appear lazily, and some filesystems ignore chmod.
    }
  }
}

export function openDatabase(config) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  hardenPermissions(config);

  // A previous process died mid-extraction. Do not leave a spinner forever.
  db.prepare(
    `UPDATE documents
       SET status = 'error',
           error = 'Extraction was interrupted when the server stopped. Retry to continue.',
           updated_at = ?
     WHERE status = 'extracting'`
  ).run(now());

  return db;
}

export function createDocument(db, doc) {
  const timestamp = now();
  db.prepare(
    `INSERT INTO documents
       (id, title, author, source_type, source_url, source_filename, status, error,
        content_json, plain_text, word_count, segment_count, created_at, updated_at,
        last_opened_at, position_json, settings_json, original_path)
     VALUES
       (@id, @title, @author, @sourceType, @sourceUrl, @sourceFilename, @status, @error,
        @contentJson, @plainText, @wordCount, @segmentCount, @createdAt, @updatedAt,
        NULL, @positionJson, @settingsJson, @originalPath)`
  ).run({
    id: doc.id,
    title: doc.title,
    author: doc.author || null,
    sourceType: doc.sourceType,
    sourceUrl: doc.sourceUrl || null,
    sourceFilename: doc.sourceFilename || null,
    status: doc.status || 'extracting',
    error: doc.error || null,
    contentJson: doc.content ? JSON.stringify(doc.content) : null,
    plainText: doc.plainText || null,
    wordCount: doc.wordCount || 0,
    segmentCount: doc.segmentCount || 0,
    createdAt: doc.createdAt || timestamp,
    updatedAt: doc.updatedAt || timestamp,
    positionJson: JSON.stringify(doc.position || DEFAULT_POSITION),
    settingsJson: JSON.stringify(doc.settings || {}),
    originalPath: doc.originalPath || null
  });
  return getDocument(db, doc.id);
}

export function markDocumentReady(db, id, parsed) {
  const timestamp = now();
  const transaction = db.transaction(() => {
    db.prepare(
      `UPDATE documents
          SET title = @title,
              author = @author,
              status = 'ready',
              error = NULL,
              content_json = @contentJson,
              plain_text = @plainText,
              word_count = @wordCount,
              segment_count = @segmentCount,
              updated_at = @updatedAt
        WHERE id = @id`
    ).run({
      id,
      title: parsed.title,
      author: parsed.author || null,
      contentJson: JSON.stringify(parsed.content),
      plainText: parsed.plainText,
      wordCount: parsed.wordCount || 0,
      segmentCount: parsed.content.segmentCount,
      updatedAt: timestamp
    });

    db.prepare('DELETE FROM segments WHERE document_id = ?').run(id);
    const insert = db.prepare(
      `INSERT INTO segments
         (document_id, idx, chapter_index, paragraph_index, kind, text)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const segment of parsed.segments) {
      insert.run(id, segment.i, segment.chapterIndex, segment.paragraphIndex, segment.kind, segment.text);
    }
  });
  transaction();
  return getDocument(db, id);
}

export function markDocumentError(db, id, message) {
  db.prepare(
    `UPDATE documents
        SET status = 'error', error = ?, updated_at = ?
      WHERE id = ?`
  ).run(String(message || 'Extraction failed.'), now(), id);
  return getDocument(db, id);
}

export function markDocumentExtracting(db, id) {
  db.prepare(
    `UPDATE documents
        SET status = 'extracting', error = NULL, updated_at = ?
      WHERE id = ?`
  ).run(now(), id);
  return getDocument(db, id);
}

export function getDocumentRow(db, id) {
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id) || null;
}

export function getDocument(db, id, { touch = false } = {}) {
  const row = getDocumentRow(db, id);
  if (!row) return null;
  if (touch) {
    const timestamp = now();
    db.prepare('UPDATE documents SET last_opened_at = ? WHERE id = ?').run(timestamp, id);
    row.last_opened_at = timestamp;
  }

  return {
    id: row.id,
    title: row.title,
    author: row.author,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    sourceFilename: row.source_filename,
    status: row.status,
    error: row.error,
    wordCount: row.word_count,
    segmentCount: row.segment_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
    position: safeJson(row.position_json, DEFAULT_POSITION),
    settings: safeJson(row.settings_json, {}),
    plainText: row.plain_text,
    content: safeJson(row.content_json, null),
    originalPath: row.original_path
  };
}

export function listDocuments(db, { query = '', limit = 100 } = {}) {
  const trimmed = String(query || '').trim();
  const cappedLimit = Math.min(300, Math.max(1, Number(limit) || 100));
  const escaped = trimmed.replace(/[\\%_]/g, (character) => `\\${character}`);

  const rows = trimmed
    ? db
        .prepare(
          `SELECT id, title, author, source_type, source_filename, status, error,
                  word_count, segment_count, created_at, updated_at, last_opened_at,
                  position_json, settings_json
             FROM documents
            WHERE title LIKE @term ESCAPE '\\' COLLATE NOCASE
               OR COALESCE(plain_text, '') LIKE @term ESCAPE '\\' COLLATE NOCASE
            ORDER BY COALESCE(last_opened_at, updated_at) DESC
            LIMIT @limit`
        )
        .all({ term: `%${escaped}%`, limit: cappedLimit })
    : db
        .prepare(
          `SELECT id, title, author, source_type, source_filename, status, error,
                  word_count, segment_count, created_at, updated_at, last_opened_at,
                  position_json, settings_json
             FROM documents
            ORDER BY COALESCE(last_opened_at, updated_at) DESC
            LIMIT @limit`
        )
        .all({ limit: cappedLimit });

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    author: row.author,
    sourceType: row.source_type,
    sourceFilename: row.source_filename,
    status: row.status,
    error: row.error,
    wordCount: row.word_count,
    segmentCount: row.segment_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
    position: safeJson(row.position_json, DEFAULT_POSITION),
    settings: safeJson(row.settings_json, {})
  }));
}

export function updateDocumentState(db, id, { position, settings }) {
  const row = getDocumentRow(db, id);
  if (!row) return null;

  const existingPosition = safeJson(row.position_json, DEFAULT_POSITION);
  const existingSettings = safeJson(row.settings_json, {});
  const nextPosition = position ? { ...existingPosition, ...position } : existingPosition;
  const nextSettings = settings ? { ...existingSettings, ...settings } : existingSettings;

  db.prepare(
    `UPDATE documents
        SET position_json = ?, settings_json = ?, last_opened_at = ?, updated_at = ?
      WHERE id = ?`
  ).run(JSON.stringify(nextPosition), JSON.stringify(nextSettings), now(), now(), id);

  return { position: nextPosition, settings: nextSettings };
}

export function deleteDocument(db, id) {
  const row = getDocumentRow(db, id);
  if (!row) return null;
  db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  return row;
}

export function getSegment(db, documentId, index) {
  return (
    db
      .prepare(
        `SELECT idx, chapter_index, paragraph_index, kind, text
           FROM segments
          WHERE document_id = ? AND idx = ?`
      )
      .get(documentId, index) || null
  );
}

export function getParagraphContext(db, documentId, index, maxChars = 1200) {
  const segment = db
    .prepare(
      `SELECT idx, chapter_index, paragraph_index
         FROM segments
        WHERE document_id = ? AND idx = ?`
    )
    .get(documentId, index);
  if (!segment) return null;

  const rows = db
    .prepare(
      `SELECT idx, text
         FROM segments
        WHERE document_id = ? AND chapter_index = ? AND paragraph_index = ?
        ORDER BY idx`
    )
    .all(documentId, segment.chapter_index, segment.paragraph_index);

  let before = '';
  let after = '';
  for (const row of rows) {
    if (row.idx < index) before += `${before ? ' ' : ''}${row.text}`;
    else if (row.idx > index) after += `${after ? ' ' : ''}${row.text}`;
  }

  return {
    previousText: before.slice(-maxChars),
    nextText: after.slice(0, maxChars)
  };
}

export function getSegmentCount(db, documentId) {
  return db.prepare('SELECT COUNT(*) AS count FROM segments WHERE document_id = ?').get(documentId).count;
}

export function getCachedAudio(db, key) {
  const row = db.prepare('SELECT * FROM audio_cache WHERE key = ?').get(key);
  if (!row) return null;
  db.prepare('UPDATE audio_cache SET last_used_at = ? WHERE key = ?').run(now(), key);
  return row;
}

export function putCachedAudio(db, entry) {
  const timestamp = now();
  db.prepare(
    `INSERT INTO audio_cache (key, file, content_type, bytes, created_at, last_used_at)
     VALUES (@key, @file, @contentType, @bytes, @createdAt, @lastUsedAt)
     ON CONFLICT(key) DO UPDATE SET
       file = excluded.file,
       content_type = excluded.content_type,
       bytes = excluded.bytes,
       last_used_at = excluded.last_used_at`
  ).run({
    key: entry.key,
    file: entry.file,
    contentType: entry.contentType,
    bytes: entry.bytes,
    createdAt: timestamp,
    lastUsedAt: timestamp
  });
}

export function pruneAudioCache(db, maxBytes) {
  const total = db.prepare('SELECT COALESCE(SUM(bytes), 0) AS bytes FROM audio_cache').get().bytes;
  if (total <= maxBytes) return { removed: 0, freed: 0 };

  let remaining = total;
  let removed = 0;
  let freed = 0;
  const rows = db.prepare('SELECT key, file, bytes FROM audio_cache ORDER BY last_used_at ASC').all();
  const remove = db.prepare('DELETE FROM audio_cache WHERE key = ?');
  for (const row of rows) {
    if (remaining <= maxBytes) break;
    try {
      fs.unlinkSync(row.file);
    } catch {
      // File already missing; drop the row anyway.
    }
    remove.run(row.key);
    remaining -= row.bytes;
    freed += row.bytes;
    removed += 1;
  }
  return { removed, freed };
}

export function audioCacheTotal(db) {
  return db.prepare('SELECT COALESCE(SUM(bytes), 0) AS bytes FROM audio_cache').get().bytes;
}

export function getAppSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function deleteAppSetting(db, key) {
  db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
}

export function setAppSetting(db, key, value) {
  db.prepare(
    `INSERT INTO app_settings (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

function safeJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function resolveDataPath(config, relativePath) {
  if (!relativePath) return null;
  const absolute = path.resolve(config.dataDir, relativePath);
  const root = path.resolve(config.dataDir);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
  return absolute;
}
