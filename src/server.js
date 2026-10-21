import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { makeContext } from './context.js';
import { openDb } from './db/open.js';
import { createMailer } from './mail/mailer.js';
import { errorCode } from './mail/outbox.js';
import { startScheduler } from './scheduler.js';

const config = loadConfig(process.env);
if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });
const db = openDb(config.dbPath);
const mailer = createMailer(config);
const ctx = makeContext({ config, db, mailer });
const app = await buildApp(ctx);
let scheduler = null;
let stopping = false;

// Order matters: nothing may touch the database or the mail pool after they
// close, so first the timer and the request handlers stop, then the send in
// flight finishes. A second signal while this runs is ignored.
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  ctx.log.info({ signal }, 'server_stopping');
  try {
    ctx.state.stopping = true;
    await scheduler?.stop();
    await app.close();
    // A failed drain was already logged where it was started.
    await ctx.state.drain?.catch(() => {});
    await mailer.close();
    db.close();
  } catch (err) {
    ctx.log.error({ code: errorCode(err) }, 'shutdown_error');
    process.exit(1);
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Listening on the raw server skips Fastify's prose startup lines, which list
// every interface address; one fixed event replaces them.
await app.ready();
await new Promise((resolve, reject) => {
  app.server.once('error', reject);
  app.server.listen(config.port, '0.0.0.0', resolve);
});
ctx.log.info({ port: config.port }, 'server_listening');
if (!stopping) scheduler = startScheduler(ctx);
