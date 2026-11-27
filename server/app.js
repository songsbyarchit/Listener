import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import {
  createDocument,
  deleteDocument,
  getAppSetting,
  getDocument,
  getDocumentRow,
  getParagraphContext,
  getSegment,
  listDocuments,
  markDocumentExtracting,
  markDocumentError,
  markDocumentReady,
  setAppSetting,
  updateDocumentState
} from './db.js';
import {
  HttpError,
  badRequest,
  errorBody,
  notFound
} from './errors.js';
import { loadConfig } from './config.js';
import { normalizeDocument, cleanText } from './normalize.js';
import { parseHtml } from './parsers/html.js';
import { parsePlainText } from './parsers/text.js';
import {
  parseFileBuffer,
  titleFromFilename,
  isSupportedExtension
} from './parsers/index.js';
import { createTesseractRecognizer } from './parsers/image.js';
import { fetchPublicHtml, validatePublicUrl } from './ssrf.js';
import { createTtsService } from './tts.js';
import {
  effectiveDefaultVoice,
  getProvider,
  isValidVoiceForProvider,
  providerPresets,
  publicTtsSettings,
  readTtsSettings,
  resetTtsSettings,
  resolveTtsSettings,
  writeTtsSettings
} from './tts-providers.js';
import {
  createUploadMiddleware,
  ensureDirectories,
  extensionOf,
  relativeToData,
  removeUpload,
  resolveUploadPath,
  safeDisplayFilename
} from './files.js';

const IMAGE_TYPES = new Set(['png', 'jpg', 'jpeg']);

function isoNow() {
  return new Date().toISOString();
}

function estimateMinutes(wordCount, rate = 1) {
  if (!wordCount) return 0;
  return Math.max(1, Math.round(wordCount / 155 / Math.max(0.5, Number(rate) || 1)));
}

function progressFor(document) {
  if (!document.segmentCount) return 0;
  const index = Number(document.position?.segmentIndex) || 0;
  return Math.min(1, Math.max(0, index / document.segmentCount));
}

function summarize(document) {
  return {
    id: document.id,
    title: document.title,
    author: document.author,
    sourceType: document.sourceType,
    sourceFilename: document.sourceFilename,
    sourceUrl: document.sourceUrl,
    status: document.status,
    error: document.error,
    wordCount: document.wordCount,
    segmentCount: document.segmentCount,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    lastOpenedAt: document.lastOpenedAt,
    position: document.position,
    settings: document.settings,
    progress: progressFor(document),
    minutes: estimateMinutes(document.wordCount, document.settings?.rate)
  };
}

function detail(document) {
  return {
    ...summarize(document),
    content: document.content || null
  };
}

function readBodyString(value, field, maxLength) {
  if (typeof value !== 'string') throw badRequest(`${field} must be text.`);
  if (value.length > maxLength) {
    throw new HttpError(413, `${field} is too large.`, 'too_large');
  }
  return value;
}

function fixedTitle(text, provided) {
  const title = cleanText(provided).slice(0, 200);
  if (title) return title;
  const firstLine = String(text || '')
    .split(/\n+/)
    .map((line) => cleanText(line))
    .find(Boolean);
  return (firstLine || 'Pasted text').slice(0, 100);
}

function sourceTypeForExtension(extension) {
  return IMAGE_TYPES.has(extension) ? 'image' : extension;
}

function validateGap(value, name, max) {
  const gap = Number(value);
  if (!Number.isInteger(gap) || gap < 0 || gap > max) {
    throw badRequest(`${name} must be an integer between 0 and ${max} ms.`);
  }
  return gap;
}

function validatePosition(input, segmentCount) {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('position must be an object.');
  }

  const output = {};
  const maxSegment = Math.max(0, (Number(segmentCount) || 0) - 1);

  if (input.segmentIndex !== undefined) {
    const index = Number(input.segmentIndex);
    if (!Number.isInteger(index) || index < 0 || index > maxSegment) {
      throw badRequest(`segmentIndex must be an integer between 0 and ${maxSegment}.`);
    }
    output.segmentIndex = index;
  }

  for (const key of ['chapterIndex', 'paragraphIndex']) {
    if (input[key] === undefined) continue;
    const index = Number(input[key]);
    if (!Number.isInteger(index) || index < 0) {
      throw badRequest(`${key} must be a non-negative integer.`);
    }
    output[key] = index;
  }

  return output;
}

function validateSettings(input, providerId = 'kokoro') {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('settings must be an object.');
  }

  const output = {};

  if (input.voice !== undefined) {
    if (!isValidVoiceForProvider(providerId, input.voice)) throw badRequest('Invalid voice name.');
    output.voice = input.voice;
  }

  if (input.rate !== undefined) {
    const rate = Number(input.rate);
    if (!Number.isFinite(rate) || rate < 0.5 || rate > 3) {
      throw badRequest('rate must be between 0.5 and 3.');
    }
    output.rate = Math.round(rate * 100) / 100;
  }

  if (input.volume !== undefined) {
    const volume = Number(input.volume);
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
      throw badRequest('volume must be between 0 and 1.');
    }
    output.volume = Math.round(volume * 100) / 100;
  }

  if (input.sentenceGap !== undefined) {
    output.sentenceGap = validateGap(input.sentenceGap, 'sentenceGap', 1000);
  }
  if (input.paragraphGap !== undefined) {
    output.paragraphGap = validateGap(input.paragraphGap, 'paragraphGap', 2000);
  }

  return output;
}

function publicErrorMessage(error) {
  if (error instanceof HttpError) return error.message;
  if (error instanceof Error && error.message && error.message.length < 300) {
    return error.message;
  }
  return 'The document could not be extracted.';
}

export function createApp({ config = loadConfig(), db, fetchImpl, ttsFetchImpl, recognize, lookup } = {}) {
  ensureDirectories(config);

  const tts = createTtsService({ config, db, fetchImpl: ttsFetchImpl });
  const upload = createUploadMiddleware(config);
  const ocr = recognize || createTesseractRecognizer({ cachePath: config.tessdataDir });

  const ttsSettings = () => readTtsSettings(db, config);

  const documentDefaults = () => ({
    voice: effectiveDefaultVoice(db, ttsSettings()),
    rate: 1,
    volume: 1,
    sentenceGap: 160,
    paragraphGap: 600
  });

  async function knownVoices() {
    try {
      return await tts.fetchVoices({ timeoutMs: 1500 });
    } catch {
      return [];
    }
  }

  function resolveVoice(settings, candidate, voices) {
    const ids = voices.map((voice) => voice.id);
    const usable =
      candidate &&
      isValidVoiceForProvider(settings.provider, candidate) &&
      (!ids.length || ids.includes(candidate));

    return usable ? candidate : effectiveDefaultVoice(db, settings, ids);
  }

  let importQueue = Promise.resolve();
  function enqueue(task) {
    importQueue = importQueue
      .then(task)
      .catch((error) => {
        console.error('[LISTNR] Import job failed:', error);
      });
    return importQueue;
  }

  async function processDocument(id) {
    const document = getDocument(db, id);
    if (!document) return null;

    try {
      let parsed;

      if (document.sourceType === 'url') {
        if (!document.sourceUrl) throw new Error('This URL document has no source URL.');
        const fetched = await fetchPublicHtml(document.sourceUrl, {
          lookup,
          fetchImpl,
          timeoutMs: config.urlImport.timeoutMs,
          maxRedirects: config.urlImport.maxRedirects,
          maxBytes: config.maxUrlBytes
        });
        parsed = /text\/plain/i.test(fetched.contentType)
          ? parsePlainText(fetched.html, { title: document.title })
          : parseHtml(fetched.html, { url: fetched.url });
      } else {
        const original = resolveUploadPath(config, document.originalPath);
        if (!original || !fs.existsSync(original)) {
          throw new Error('The original uploaded file is missing.');
        }
        const extension = extensionOf(document.sourceFilename || original);
        const buffer = await fs.promises.readFile(original);
        parsed = await parseFileBuffer({
          buffer,
          extension,
          filename: document.sourceFilename,
          title: document.title,
          recognize: ocr
        });
      }

      const normalized = normalizeDocument(parsed);
      return markDocumentReady(db, id, normalized);
    } catch (error) {
      console.error(`[LISTNR] Extraction failed for ${id}:`, error);
      return markDocumentError(db, id, publicErrorMessage(error));
    }
  }

  const app = express();
  app.disable('x-powered-by');

  app.use((request, response, next) => {
    const origin = request.headers.origin;
    const allowedOrigin =
      !origin ||
      origin.startsWith('chrome-extension://') ||
      origin === `http://127.0.0.1:${config.port}` ||
      origin === `http://localhost:${config.port}`;

    if (origin && allowedOrigin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.setHeader('Access-Control-Allow-Private-Network', 'true');
      response.setHeader('Access-Control-Max-Age', '600');
    }

    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');

    if (request.method === 'OPTIONS') {
      if (!allowedOrigin) {
        response.status(403).json(errorBody(new HttpError(403, 'Origin not allowed.', 'forbidden')));
        return;
      }
      response.status(204).end();
      return;
    }

    if (!allowedOrigin) {
      response.status(403).json(errorBody(new HttpError(403, 'Origin not allowed.', 'forbidden')));
      return;
    }

    next();
  });

  app.use(
    express.json({
      limit: `${Math.max(2, Math.ceil((config.maxPasteChars * 4) / 1024 / 1024))}mb`
    })
  );

  // The Chrome extension (toolbar popup + in-page player) is the only UI;
  // this server exposes the local API it talks to.
  app.get('/', (_request, response) => {
    response.json({
      ok: true,
      name: 'LISTNR',
      hint: 'Load this folder as an unpacked Chrome extension and click the LISTNR toolbar icon.'
    });
  });

  app.get('/api/health', (_request, response) => {
    const settings = ttsSettings();
    response.json({
      ok: true,
      name: 'LISTNR',
      version: '0.2.2',
      tts: {
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        model: settings.model
      }
    });
  });

  app.get('/api/tts/status', async (_request, response) => {
    response.json(await tts.probe());
  });

  app.get('/api/tts/settings', (_request, response) => {
    const settings = ttsSettings();
    response.json({
      ...publicTtsSettings(settings),
      defaultVoice: effectiveDefaultVoice(db, settings)
    });
  });

  app.patch('/api/tts/settings', async (request, response) => {
    const patch = request.body;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw badRequest('Send the voice settings as a JSON object.');
    }

    if (patch.reset === true) {
      resetTtsSettings(db);
    } else {
      writeTtsSettings(db, config, patch);
    }

    const settings = ttsSettings();
    const voices = await tts.fetchVoices({ force: true }).catch(() => []);
    const ids = voices.map((voice) => voice.id);

    const stored = getAppSetting(db, 'defaultVoice');
    if (!stored || !ids.includes(stored)) {
      const next = effectiveDefaultVoice(db, settings, ids);
      if (next) setAppSetting(db, 'defaultVoice', next);
    }

    response.json({
      ...publicTtsSettings(settings),
      defaultVoice: getAppSetting(db, 'defaultVoice') || effectiveDefaultVoice(db, settings, ids),
      voices
    });
  });

  app.post('/api/tts/test', async (request, response) => {
    let candidate;
    try {
      candidate = resolveTtsSettings(db, config, request.body || {});
    } catch (error) {
      if (error instanceof HttpError) {
        response.json({
          ok: false,
          reachable: null,
          authorized: false,
          message: error.message,
          code: error.code
        });
        return;
      }
      throw error;
    }

    const result = await tts.probe({ settingsOverride: candidate });
    response.json({
      ...result,
      ok: result.reachable === true && result.authorized !== false,
      providerLabel: getProvider(candidate.provider)?.label || candidate.provider
    });
  });

  // Desktop Listnr uses this route so it speaks through exactly the same
  // provider, model and voice settings as the Chrome reader.
  app.post('/api/tts/speak', async (request, response) => {
    const text = String(request.body?.text || '').trim();
    if (!text) throw badRequest('Text is required.');
    if (text.length > 5000) throw badRequest('This passage is too long. Select a shorter section.');

    const settings = ttsSettings();
    const voices = await knownVoices();
    const voice = resolveVoice(settings, String(request.body?.voice || ''), voices);
    if (!voice) {
      throw new HttpError(409, 'No usable voice is configured for this provider.', 'voice_required');
    }

    const audio = await tts.synthesize(text, voice);
    const buffer = await fs.promises.readFile(audio.file);
    response.setHeader('Content-Type', audio.contentType);
    response.setHeader('Cache-Control', 'private, max-age=86400');
    response.send(buffer);
  });

  app.get('/api/voices', async (_request, response) => {
    const settings = ttsSettings();
    const voices = await tts.fetchVoices();
    response.json({
      provider: settings.provider,
      providerLabel: getProvider(settings.provider)?.label || settings.provider,
      providers: providerPresets(),
      voices,
      defaultVoice: effectiveDefaultVoice(db, settings, voices.map((voice) => voice.id))
    });
  });

  app.get('/api/voices/:id/preview', async (request, response) => {
    const voice = String(request.params.id || '');
    const settings = ttsSettings();
    if (!isValidVoiceForProvider(settings.provider, voice)) throw badRequest('Invalid voice name.');

    const sample =
      'Hello. This is how I read. The tide keeps its own patient schedule, and there is no need to rush.';
    const audio = await tts.synthesize(sample, voice);
    const buffer = await fs.promises.readFile(audio.file);

    response.setHeader('Content-Type', audio.contentType);
    response.setHeader('Cache-Control', 'private, max-age=86400');
    response.send(buffer);
  });

  app.get('/api/settings', (_request, response) => {
    response.json({
      defaultVoice: effectiveDefaultVoice(db, ttsSettings())
    });
  });

  app.patch('/api/settings', (request, response) => {
    const voice = request.body?.defaultVoice;
    const settings = ttsSettings();
    if (!isValidVoiceForProvider(settings.provider, voice)) throw badRequest('Invalid default voice.');
    setAppSetting(db, 'defaultVoice', voice);
    response.json({ defaultVoice: voice });
  });

  app.get('/api/documents', (request, response) => {
    const documents = listDocuments(db, {
      query: request.query.q || '',
      limit: request.query.limit
    });
    response.json({
      documents: documents.map((document) => summarize(document))
    });
  });

  app.post('/api/documents', (request, response) => {
    const text = readBodyString(request.body?.text, 'text', config.maxPasteChars);
    if (!text.trim()) throw badRequest('Paste some text first.');

    const title = fixedTitle(text, request.body?.title);
    const parsedBase = parsePlainText(text, { title });
    const parsed = {
      ...parsedBase,
      author: cleanText(request.body?.author) || null
    };

    const normalized = normalizeDocument(parsed);
    const id = crypto.randomUUID();
    const createdAt = isoNow();
    const settings = documentDefaults();

    createDocument(db, {
      id,
      title,
      author: parsed.author,
      sourceType: 'paste',
      status: 'extracting',
      createdAt,
      settings
    });
    markDocumentReady(db, id, normalized);

    response.status(201).json({ document: detail(getDocument(db, id)) });
  });

  app.post('/api/documents/import/file', upload.single('file'), async (request, response) => {
    if (!request.file) throw badRequest('Choose a file to import.');

    const originalName = safeDisplayFilename(request.file.originalname);
    const extension = extensionOf(originalName);

    if (!isSupportedExtension(extension)) {
      removeUpload(config, relativeToData(config, request.file.path));
      throw new HttpError(415, 'Unsupported file type.', 'unsupported_file');
    }

    const id = crypto.randomUUID();
    const providedTitle = cleanText(request.body?.title).slice(0, 200);
    const title = providedTitle || titleFromFilename(originalName) || 'Untitled document';
    const relativePath = relativeToData(config, request.file.path);

    try {
      createDocument(db, {
        id,
        title,
        sourceType: sourceTypeForExtension(extension),
        sourceFilename: originalName,
        status: 'extracting',
        originalPath: relativePath,
        settings: documentDefaults()
      });
    } catch (error) {
      removeUpload(config, relativePath);
      throw error;
    }

    if (request.query.wait === '1') {
      await processDocument(id);
      const document = getDocument(db, id);
      response.status(document.status === 'ready' ? 201 : 200).json({ document: detail(document) });
      return;
    }

    response
      .status(202)
      .location(`/api/documents/${id}`)
      .json({ document: summarize(getDocument(db, id)) });

    enqueue(() => processDocument(id));
  });

  app.post('/api/documents/import/page', (request, response) => {
    let rawHtml = typeof request.body?.html === 'string' ? request.body.html : '';
    let rawText = typeof request.body?.text === 'string' ? request.body.text : '';
    const sourceUrl =
      typeof request.body?.url === 'string' ? request.body.url.slice(0, 4096) : null;
    const providedTitle = cleanText(request.body?.title).slice(0, 200);

    if (!rawHtml.trim() && !rawText.trim()) {
      throw badRequest('The page had no readable text.');
    }
    if (rawHtml.length > 6_000_000 || rawText.length > 2_000_000) {
      throw new HttpError(413, 'That page is too large to import.', 'too_large');
    }

    let parsed;
    if (rawHtml.trim()) {
      try {
        parsed = parseHtml(rawHtml, {
          url: sourceUrl || undefined,
          title: providedTitle || 'Web page'
        });
      } catch (error) {
        if (!rawText.trim()) throw error;
        rawHtml = '';
      }
    }

    if (!parsed) {
      parsed = parsePlainText(rawText, {
        title: providedTitle || 'Web page'
      });
    }

    const normalized = normalizeDocument(parsed);
    const id = crypto.randomUUID();

    createDocument(db, {
      id,
      title: normalized.title || providedTitle || 'Web page',
      author: parsed.author || null,
      sourceType: 'page',
      sourceUrl,
      status: 'extracting',
      settings: documentDefaults()
    });
    markDocumentReady(db, id, normalized);

    response.status(201).json({ document: detail(getDocument(db, id)) });
  });

  app.post('/api/documents/import/url', async (request, response) => {
    const rawUrl = readBodyString(request.body?.url, 'url', 4096);
    const validated = await validatePublicUrl(rawUrl, { lookup });

    const id = crypto.randomUUID();
    const sourceUrl = validated.url.toString();
    const title = validated.url.hostname.replace(/^www\./, '') || 'Web page';

    createDocument(db, {
      id,
      title,
      sourceType: 'url',
      sourceUrl,
      status: 'extracting',
      settings: documentDefaults()
    });

    if (request.query.wait === '1') {
      await processDocument(id);
      const document = getDocument(db, id);
      response.status(document.status === 'ready' ? 201 : 200).json({ document: detail(document) });
      return;
    }

    response
      .status(202)
      .location(`/api/documents/${id}`)
      .json({ document: summarize(getDocument(db, id)) });

    enqueue(() => processDocument(id));
  });

  app.get('/api/documents/:id', (request, response) => {
    const document = getDocument(db, request.params.id, { touch: true });
    if (!document) throw notFound('Document not found.');
    response.json({ document: detail(document) });
  });

  app.patch('/api/documents/:id/state', (request, response) => {
    const document = getDocument(db, request.params.id);
    if (!document) throw notFound('Document not found.');

    const position = validatePosition(request.body?.position, document.segmentCount);
    const settings = validateSettings(request.body?.settings, ttsSettings().provider);

    const state = updateDocumentState(db, document.id, { position, settings });
    response.json({
      position: state.position,
      settings: state.settings,
      progress: document.segmentCount
        ? Math.min(1, Math.max(0, (state.position.segmentIndex || 0) / document.segmentCount))
        : 0
    });
  });

  app.delete('/api/documents/:id', (request, response) => {
    const document = getDocument(db, request.params.id);
    if (!document) throw notFound('Document not found.');

    deleteDocument(db, document.id);
    removeUpload(config, document.originalPath);
    response.status(204).end();
  });

  app.get('/api/documents/:id/export.txt', (request, response) => {
    const document = getDocument(db, request.params.id);
    if (!document) throw notFound('Document not found.');
    if (document.status !== 'ready' || !document.plainText) {
      throw new HttpError(409, 'This document is not ready to export.', 'not_ready');
    }

    const filename = safeDisplayFilename(`${document.title || 'document'}.txt`);
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
    response.send(document.plainText);
  });

  app.post('/api/documents/:id/retry', async (request, response) => {
    const document = getDocument(db, request.params.id);
    if (!document) throw notFound('Document not found.');
    if (document.status !== 'error') {
      throw new HttpError(409, 'Only documents with an extraction error can be retried.', 'not_retryable');
    }
    if (document.sourceType !== 'url' && !document.originalPath) {
      throw new HttpError(409, 'The original file is no longer available.', 'no_source');
    }

    markDocumentExtracting(db, document.id);
    if (request.query.wait === '1') {
      await processDocument(document.id);
      const updated = getDocument(db, document.id);
      response.status(200).json({ document: detail(updated) });
      return;
    }

    response.status(202).json({ document: summarize(getDocument(db, document.id)) });
    enqueue(() => processDocument(document.id));
  });

  app.get('/api/documents/:id/audio/:index', async (request, response) => {
    const document = getDocument(db, request.params.id);
    if (!document) throw notFound('Document not found.');
    if (document.status !== 'ready') {
      throw new HttpError(409, 'This document is still being extracted.', 'not_ready');
    }

    const index = Number(request.params.index);
    if (!Number.isInteger(index) || index < 0) throw badRequest('Invalid sentence index.');

    const segment = getSegment(db, document.id, index);
    if (!segment) throw notFound('Sentence not found.');

    const settings = ttsSettings();
    const voices = await knownVoices();
    const requested = String(request.query.voice || document.settings?.voice || '');
    const voice = resolveVoice(settings, requested, voices);

    if (!voice) {
      throw new HttpError(409, 'No usable voice is configured for this provider.', 'voice_required');
    }

    // ElevenLabs can hear the surrounding paragraph and speak the sentence with
    // continuity; the extra text is context only, so it is not spoken or billed.
    const context =
      settings.provider === 'elevenlabs' ? getParagraphContext(db, document.id, index, 1200) : undefined;

    const audio = await tts.synthesize(segment.text, voice, { context });
    const buffer = await fs.promises.readFile(audio.file);

    response.setHeader('Content-Type', audio.contentType);
    response.setHeader('Cache-Control', 'private, max-age=86400');
    response.send(buffer);
  });

  const kernlAppearancePath = path.join(os.homedir(), '.fleet', 'appearance');

  app.get('/api/kernl/appearance', async (_request, response) => {
    const value = await fs.promises.readFile(kernlAppearancePath, 'utf8').catch(() => 'system');
    const clean = ['system', 'light', 'dark'].includes(value.trim()) ? value.trim() : 'system';
    response.json({ ok: true, appearance: clean });
  });

  app.patch('/api/kernl/appearance', async (request, response) => {
    const value = String(request.body?.appearance || '').trim().toLowerCase();
    if (!['system', 'light', 'dark'].includes(value)) {
      response.status(400).json(errorBody(badRequest('Appearance must be system, light or dark.')));
      return;
    }
    await fs.promises.mkdir(path.dirname(kernlAppearancePath), { recursive: true, mode: 0o700 });
    await fs.promises.writeFile(kernlAppearancePath, value + '\n', { mode: 0o600 });
    response.json({ ok: true, appearance: value });
  });

  // Clips: things saved to read or listen to later. One small JSON file in the
  // data folder, so the Chrome extension and the Mac app share one collection.
  const clipsPath = path.join(config.dataDir, 'clips.json');
  const readClips = async () => {
    const raw = await fs.promises.readFile(clipsPath, 'utf8').catch(() => '[]');
    try {
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };
  const writeClips = async (list) => {
    await fs.promises.mkdir(path.dirname(clipsPath), { recursive: true });
    await fs.promises.writeFile(clipsPath, JSON.stringify(list.slice(0, 1000), null, 2), { mode: 0o600 });
  };

  app.get('/api/clips', async (_request, response) => {
    response.json({ ok: true, clips: await readClips() });
  });

  app.post('/api/clips', async (request, response) => {
    const body = request.body || {};
    const text = String(body.text || '').trim();
    if (!text) {
      response.status(400).json(errorBody(badRequest('A clip needs some text.')));
      return;
    }
    const url = String(body.url || '').slice(0, 2000);
    const kind = body.kind === 'selection' ? 'selection' : 'article';
    const list = await readClips();
    // Clipping the same article again replaces the old copy instead of adding a second one.
    const kept = list.filter((clip) => !(kind === 'article' && clip.kind === 'article' && url && clip.url === url));
    const clip = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      title: String(body.title || 'Untitled').slice(0, 300),
      url,
      site: String(body.site || '').slice(0, 120),
      kind,
      text: text.slice(0, 400000),
      words: text.split(/\s+/).filter(Boolean).length,
      done: false
    };
    await writeClips([clip, ...kept]);
    response.json({ ok: true, clip });
  });

  app.patch('/api/clips/:id', async (request, response) => {
    const list = await readClips();
    const clip = list.find((item) => item.id === request.params.id);
    if (!clip) {
      response.status(404).json(errorBody(notFound('Clip not found.')));
      return;
    }
    if (typeof request.body?.done === 'boolean') clip.done = request.body.done;
    await writeClips(list);
    response.json({ ok: true, clip });
  });

  app.delete('/api/clips/:id', async (request, response) => {
    const list = await readClips();
    await writeClips(list.filter((item) => item.id !== request.params.id));
    response.json({ ok: true });
  });

  app.use('/api', (_request, _response, next) => {
    next(notFound('API route not found.'));
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof multer.MulterError) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      const message =
        error.code === 'LIMIT_FILE_SIZE'
          ? `That file is larger than the ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB limit.`
          : 'That upload could not be accepted.';
      response.status(status).json(errorBody(new HttpError(status, message, 'upload_failed')));
      return;
    }

    if (error?.type === 'entity.parse.failed' || (error instanceof SyntaxError && error.status === 400)) {
      response.status(400).json(errorBody(badRequest('The request body is not valid JSON.')));
      return;
    }

    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) console.error('[LISTNR] Request failed:', error);
    response.status(status).json(errorBody(error instanceof HttpError ? error : new HttpError(500, 'Internal server error.', 'internal_error')));
  });

  app.locals.config = config;
  app.locals.db = db;
  app.locals.tts = tts;
  app.locals.processDocument = processDocument;

  return app;
}
