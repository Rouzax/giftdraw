import { createHash, randomBytes } from 'node:crypto';

const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const HOUR_MS = 60 * 60_000;

// Every rendered form that creates something carries a fresh random token.
// The server needs no record of the tokens it hands out, only of those
// already used, so an unknown token is simply a first submit.
export function newFormToken() {
  return randomBytes(16).toString('base64url');
}

// The posted form without its token, in a fixed field order.
export function formFingerprint(body) {
  const fields = Object.entries(body && typeof body === 'object' ? body : {})
    .filter(([name]) => name !== 'formToken')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(fields)).digest('base64url');
}

// Remembers where each used form token led, so a repeated post of the same
// form (a double click, a resend after a slow answer) is sent to the result
// of the first one instead of doing the work again or reporting a conflict.
// The token alone is not enough: a browser can restore a page with its
// token after Back, and what is then sent with it may differ. So a replay
// also needs the same fingerprint of the rest of the form.
// Kept in memory: it only has to outlive the seconds between two clicks, and
// the app runs as a single process. Route handlers check and record without
// awaiting in between, so two posts of one token cannot both get through.
export function createSubmitLog({ ttlMs = HOUR_MS, max = 2000, now = () => Date.now() } = {}) {
  const used = new Map();
  const valid = (token) => typeof token === 'string' && TOKEN.test(token);

  // Returns the recorded result, or null to treat the post as a first one.
  function replay(token, fingerprint) {
    if (!valid(token)) return null;
    const entry = used.get(token);
    if (!entry || now() - entry.at > ttlMs || entry.fingerprint !== fingerprint) return null;
    return entry.result;
  }

  // A Map iterates in insertion order, so the oldest entries come first.
  function record(token, fingerprint, result) {
    if (!valid(token)) return;
    const at = now();
    used.delete(token);
    used.set(token, { fingerprint, result, at });
    for (const [key, entry] of used) {
      if (used.size <= max && at - entry.at <= ttlMs) break;
      used.delete(key);
    }
  }

  return { replay, record };
}
