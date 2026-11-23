import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import PDFDocument from 'pdfkit';
import JSZip from 'jszip';
import { loadConfig } from '../server/config.js';
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';

export async function startApp({
  dataDir,
  ttsFetchImpl,
  fetchImpl,
  recognize,
  lookup,
  env = {}
} = {}) {
  const directory = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'listnr-test-'));
  const config = loadConfig({ LISTNR_DATA_DIR: directory, PORT: '0', ...env });
  const db = openDatabase(config);
  const app = createApp({ config, db, ttsFetchImpl, fetchImpl, recognize, lookup });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    app,
    config,
    db,
    server,
    base,
    dataDir: directory,
    async close({ keepData = false } = {}) {
      await new Promise((resolve) => server.close(resolve));
      db.close();
      if (!keepData) fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

export async function request(
  base,
  endpoint,
  { method = 'GET', json, body, headers = {} } = {}
) {
  const init = { method, headers: { ...headers } };
  if (json !== undefined) {
    init.body = JSON.stringify(json);
    init.headers['content-type'] = 'application/json';
  } else if (body !== undefined) {
    init.body = body;
  }

  const response = await fetch(`${base}${endpoint}`, init);
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { response, status: response.status, headers: response.headers, text, json: parsed };
}

export async function waitForDocument(base, id, { timeoutMs = 8000, intervalMs = 60 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await request(base, `/api/documents/${id}`);
    const document = result.json?.document;
    if (document && (document.status === 'ready' || document.status === 'error')) {
      return document;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Document ${id} did not finish extracting in time.`);
}

export function createMockTts({ audio = 'fake-mp3-bytes' } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    let body = null;
    if (options.body) {
      try {
        body = JSON.parse(options.body);
      } catch {
        body = null;
      }
    }
    calls.push({ url: href, body });

    if (href.endsWith('/audio/speech')) {
      return new Response(Buffer.from(audio), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' }
      });
    }
    if (href.endsWith('/audio/voices') || href.endsWith('/voices')) {
      return new Response(JSON.stringify(['af_heart', 'af_bella', 'am_michael']), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (href.endsWith('/models')) {
      return new Response(JSON.stringify({ object: 'list', data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response('{}', { status: 404 });
  };
  return { fetchImpl, calls };
}

export function fakeLookup(table) {
  return async (hostname) => {
    const value = table[hostname];
    if (!value) throw new Error(`No fake DNS entry for ${hostname}`);
    return value.map((address) => ({
      address,
      family: address.includes(':') ? 6 : 4
    }));
  };
}

export async function makePdf({
  title = 'The Tides of March',
  heading = 'Why the timing drifts',
  body = 'The Moon does most of the work. Its gravity pulls the water into two bulges.'
} = {}) {
  const pdf = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks = [];
  pdf.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve) => pdf.on('end', resolve));

  pdf.fontSize(24).text(title);
  pdf.moveDown(1);
  pdf.fontSize(11).text(body);
  pdf.moveDown(0.7);
  pdf.fontSize(16).text(heading);
  pdf.moveDown(0.6);
  pdf.fontSize(11).text('A second paragraph explains why high tide arrives later each day.');
  pdf.end();
  await done;
  return Buffer.concat(chunks);
}

export async function makeEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:12345678-1234-1234-1234-123456789012</dc:identifier>
    <dc:title>Test Book</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`
  );
  zip.file(
    'OEBPS/ch1.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head>
<body><h1>Chapter One</h1><p>Hello EPUB world. This is the second sentence.</p></body></html>`
  );
  zip.file(
    'OEBPS/ch2.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter Two</title></head>
<body><h1>Chapter Two</h1><p>The tide keeps its own patient schedule.</p></body></html>`
  );
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Navigation</title></head>
<body><nav epub:type="toc"><ol>
<li><a href="ch1.xhtml">Chapter One</a></li>
<li><a href="ch2.xhtml">Chapter Two</a></li>
</ol></nav></body></html>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}
