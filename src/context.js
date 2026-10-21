import pino from 'pino';
import { createRepo } from './db/repo.js';

const TOKEN_PATH = /\/p\/[^/?#\s"]+/g;

export function redactPath(value) {
  return value.replace(TOKEN_PATH, '/p/:token');
}

// Logs only the path: the query string can carry anything a client sends.
function redactUrl(url) {
  return redactPath(String(url ?? '').split('?')[0]);
}

export function makeContext({ config, db, mailer, clock = () => new Date(), logStream }) {
  const options = {
    level: config.logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      req: (request) => ({ method: request.method, url: redactUrl(request.url), id: request.id }),
    },
    hooks: {
      logMethod(args, method) {
        return method.apply(this, args.map((arg) => (typeof arg === 'string' ? redactPath(arg) : arg)));
      },
    },
  };
  const log = logStream ? pino(options, logStream) : pino(options);
  return {
    config,
    repo: createRepo(db),
    mailer,
    log,
    now: clock,
    nowIso: () => clock().toISOString(),
    state: {},
  };
}
