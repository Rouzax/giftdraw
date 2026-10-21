import pino from 'pino';
import { createRepo } from './db/repo.js';

const TOKEN_PATH = /\/p\/[^/?#\s"]+/g;
// Token shape (32 random bytes in base64url), wherever it appears.
const TOKEN_RUN = /[A-Za-z0-9_-]{43,}/g;

export function redactPath(value) {
  return value.replace(TOKEN_PATH, '/p/:token').replace(TOKEN_RUN, ':token');
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


export function makeContext({ config, db, mailer, clock = () => new Date(), logStream }) {
  const options = {
    level: config.logLevel,
    // No pid or hostname on every line: host names stay out of the logs.
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      // The route pattern, never the URL: encodings and dot segments give a
      // token too many spellings to redact reliably.
      req: (request) => ({ method: request.method, url: request.routeOptions?.url ?? 'unmatched', id: request.id }),
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
