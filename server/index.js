import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { createApp } from './app.js';

const config = loadConfig();
const db = openDatabase(config);
const app = createApp({ config, db });

const server = app.listen(config.port, config.host, () => {
  console.log('');
  console.log('  LISTNR server');
  console.log(`  Local API:   http://${config.host}:${config.port}`);
  console.log(`  Data:        ${config.dataDir}`);
  console.log(`  Local voice: ${config.tts.baseUrl} (${config.tts.model}, ${config.tts.voice})`);
  console.log('');
  console.log('  Chrome extension: chrome://extensions → Load unpacked → this folder.');
  console.log('  Local voice server: docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest');
  console.log('');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. Stop the other process or set PORT.`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nStopping LISTNR (${signal})…`);
  server.close(() => {
    try {
      db.close();
    } catch {
      // Already closed.
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
