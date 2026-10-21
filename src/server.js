import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { makeContext } from './context.js';
import { openDb } from './db/open.js';

const config = loadConfig(process.env);
if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });
const db = openDb(config.dbPath);
const ctx = makeContext({ config, db, mailer: { enabled: false } });
const app = await buildApp(ctx);

async function shutdown(signal) {
  ctx.log.info({ signal }, 'server_stopping');
  await app.close();
  db.close();
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

// Listening on the raw server skips Fastify's prose startup lines, which list
// every interface address; one fixed event replaces them.
await app.ready();
await new Promise((resolve, reject) => {
  app.server.once('error', reject);
  app.server.listen(config.port, '0.0.0.0', resolve);
});
ctx.log.info({ port: config.port }, 'server_listening');
