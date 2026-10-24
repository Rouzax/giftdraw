import { randomBytes } from 'node:crypto';

const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const HOUR_MS = 60 * 60_000;

// Every rendered form that creates something carries a fresh random token.
// The server needs no record of the tokens it hands out, only of those
// already used, so an unknown token is simply a first submit.
export function newFormToken() {
  return randomBytes(16).toString('base64url');
}

// Remembers where each used form token led, so a repeated post of the same
// form (a double click, a resend after a slow answer) is sent to the result
// of the first one instead of doing the work again or reporting a conflict.
// Kept in memory: it only has to outlive the seconds between two clicks, and
// the app runs as a single process. Route handlers check and record without
// awaiting in between, so two posts of one token cannot both get through.
export function createSubmitLog({ ttlMs = HOUR_MS, max = 2000, now = () => Date.now() } = {}) {
  const used = new Map();
  const valid = (token) => typeof token === 'string' && TOKEN.test(token);

  function replay(token) {
    if (!valid(token)) return null;
    const entry = used.get(token);
    return entry && now() - entry.at <= ttlMs ? entry.location : null;
  }

  // A Map iterates in insertion order, so the oldest entries come first.
  function record(token, location) {
    if (!valid(token)) return;
    const at = now();
    used.delete(token);
    used.set(token, { location, at });
    for (const [key, entry] of used) {
      if (used.size <= max && at - entry.at <= ttlMs) break;
      used.delete(key);
    }
  }

  return { replay, record };
}
