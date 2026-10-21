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

await app.listen({ port: config.port, host: '0.0.0.0' });
ctx.log.info({ port: config.port }, 'server_started');
