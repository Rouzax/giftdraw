import pino from 'pino';
import { createRepo } from './db/repo.js';

const TOKEN_PATH = /\/p\/[^/?#\s"]+/g;

export function redactPath(value) {
  return value.replace(TOKEN_PATH, '/p/:token');
}

// The path as the router sees it: percent-decoded, duplicate slashes
// collapsed and dot segments resolved, so /%70/<token> and /x/../p/<token>
// are recognised as participant paths. Query and fragment are dropped.
export function normalisePath(url) {
  let path = String(url ?? '').split(/[?#]/)[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    // A malformed escape is left as is; the router refuses such URLs.
  }
  path = path.replace(/\/{2,}/g, '/');
  try {
    path = new URL(path, 'http://localhost').pathname;
  } catch {
    // Unparseable: keep the collapsed form.
  }
  return path.replace(/\/{2,}/g, '/');
}

// Logs only the normalised path: the query string can carry anything a
// client sends, and an encoded path would hide a token from redactPath.
function redactUrl(url) {
  return redactPath(normalisePath(url));
}

export function makeContext({ config, db, mailer, clock = () => new Date(), logStream }) {
  const options = {
    level: config.logLevel,
    // No pid or hostname on every line: host names stay out of the logs.
    base: undefined,
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
