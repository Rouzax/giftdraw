import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { makeContext } from './context.js';
import { openDb } from './db/open.js';
import { createShutdown, recoverOutbox } from './lifecycle.js';
import { createMailer } from './mail/mailer.js';
import { startScheduler } from './scheduler.js';

const config = loadConfig(process.env);
if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });
const db = openDb(config.dbPath);
const mailer = createMailer(config);
const ctx = makeContext({ config, db, mailer });
const app = await buildApp(ctx);
let scheduler = null;
const shutdown = createShutdown({ ctx, app, mailer, db, scheduler: () => scheduler });
let stopping = false;

function onSignal(signal) {
  stopping = true;
  shutdown(signal);
}

process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

// Listening on the raw server skips Fastify's prose startup lines, which list
// every interface address; one fixed event replaces them.
await app.ready();
await new Promise((resolve, reject) => {
  app.server.once('error', reject);
  app.server.listen(config.port, '0.0.0.0', resolve);
});
ctx.log.info({ port: config.port }, 'server_listening');
if (!stopping) {
  recoverOutbox(ctx);
  scheduler = startScheduler(ctx);
}
