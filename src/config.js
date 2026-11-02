import { isIP } from 'node:net';
import { assetHash, PUBLIC_DIR } from './assets.js';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

// Messages name the variable only: values may be secrets and errors end up in logs.
function fail(name, problem) {
  throw new Error(`Invalid configuration: ${name} ${problem}`);
}

function value(env, name) {
  const raw = env[name];
  if (raw === undefined) return null;
  const trimmed = String(raw).trim();
  return trimmed === '' ? null : trimmed;
}

function portFrom(env, name, fallback) {
  const raw = value(env, name);
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw)) fail(name, 'must be a port number');
  const port = Number(raw);
  if (port < 1 || port > 65535) fail(name, 'must be between 1 and 65535');
  return port;
}

function parseAppUrl(env) {
  const raw = value(env, 'APP_URL');
  if (raw === null) fail('APP_URL', 'is required');
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail('APP_URL', 'must be an absolute URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') fail('APP_URL', 'must use http or https');
  return { appUrl: raw.replace(/\/+$/, ''), appOrigin: url.origin, appHost: url.hostname };
}

// Returns null for a valid entry, otherwise the problem to report.
function proxyEntryProblem(entry) {
  const [address, prefix, ...rest] = entry.split('/');
  const family = isIP(address);
  if (rest.length > 0 || family === 0) return 'must be a comma-separated list of IP addresses or CIDRs';
  if (prefix === undefined) return null;
  if (!/^\d+$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128)) {
    return 'must be a comma-separated list of IP addresses or CIDRs';
  }
  // Trusting every address would let anyone send the user header.
  if (Number(prefix) === 0) return 'must not contain a /0 range';
  // Clients are matched as plain IPv4, so a mapped range would never match
  // and the matcher cannot build it.
  if (/^::ffff:/i.test(address)) return 'must give IPv4 ranges as IPv4 CIDRs, not IPv4-mapped IPv6';
  return null;
}

function parseTrustedProxies(env, required) {
  const raw = value(env, 'TRUSTED_PROXIES');
  if (raw === null) {
    if (required) fail('TRUSTED_PROXIES', 'is required when ADMIN_AUTH is proxy');
    return [];
  }
  const entries = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    const problem = proxyEntryProblem(entry);
    if (problem) fail('TRUSTED_PROXIES', problem);
  }
  if (required && entries.length === 0) fail('TRUSTED_PROXIES', 'is required when ADMIN_AUTH is proxy');
  return entries;
}

function parseTimeZone(env) {
  const tz = value(env, 'TZ') ?? 'Europe/Amsterdam';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
  } catch {
    fail('TZ', 'must be an IANA time zone name');
  }
  return tz;
}

const HOST_NAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const SEND_INTERVAL_MAX = 300;
const MAX_MESSAGES_MAX = 1000;

// The name the app greets the mail server with (EHLO). Without it the mail
// library falls back to the container's host name or an address literal
// such as [127.0.0.1], which spam filters count against the mail. The site's
// own domain is the natural default; a name without a dot like localhost or
// an IP address gives no better greeting, so those leave the library's
// choice. A top-level label is never all digits, which rules out IPv4 and
// look-alikes such as 999.1.1.1.
function parseSmtpName(env, appHost) {
  const raw = value(env, 'SMTP_NAME');
  if (raw === null) return HOST_NAME.test(appHost) && !/\.\d+$/.test(appHost) ? appHost : null;
  if (!HOST_NAME.test(raw) || /\.\d+$/.test(raw)) fail('SMTP_NAME', 'must be a domain name such as gifts.example.com');
  return raw;
}

function parseSendInterval(env) {
  const raw = value(env, 'SMTP_SEND_INTERVAL');
  if (raw === null) return 5_000;
  if (!/^\d+$/.test(raw) || Number(raw) > SEND_INTERVAL_MAX) {
    fail('SMTP_SEND_INTERVAL', `must be a whole number of seconds from 0 to ${SEND_INTERVAL_MAX}`);
  }
  return Number(raw) * 1000;
}

// Some shared mail hosts pass only the first few messages of a connection
// straight on and hold the rest in their queue for later, so the pool opens
// a fresh connection after this many. Ten matches a common hosting limit and
// costs little elsewhere: one reconnect per ten mails.
function parseMaxMessages(env) {
  const raw = value(env, 'SMTP_MAX_MESSAGES');
  if (raw === null) return 10;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > MAX_MESSAGES_MAX) {
    fail('SMTP_MAX_MESSAGES', `must be a whole number from 1 to ${MAX_MESSAGES_MAX}`);
  }
  return Number(raw);
}

function parseSmtp(env, appHost) {
  const host = value(env, 'SMTP_HOST');
  if (host === null) return null;
  const from = value(env, 'SMTP_FROM');
  if (from === null) fail('SMTP_FROM', 'is required when SMTP_HOST is set');
  return {
    host,
    port: portFrom(env, 'SMTP_PORT', 587),
    user: value(env, 'SMTP_USER'),
    pass: value(env, 'SMTP_PASS'),
    from,
    name: parseSmtpName(env, appHost),
    sendIntervalMs: parseSendInterval(env),
    maxMessages: parseMaxMessages(env),
  };
}

export function loadConfig(env) {
  const { appUrl, appOrigin, appHost } = parseAppUrl(env);

  const adminAuth = value(env, 'ADMIN_AUTH');
  if (adminAuth !== 'proxy' && adminAuth !== 'password') fail('ADMIN_AUTH', 'must be proxy or password');

  let adminPassword = null;
  let sessionSecret = null;
  if (adminAuth === 'password') {
    // Raw values, not trimmed: whitespace in a password is significant. Only
    // the carriage return a CRLF env file leaves behind is dropped, since
    // nobody can type it into the login form.
    adminPassword = (env.ADMIN_PASSWORD ?? '').replace(/\r$/, '');
    sessionSecret = (env.SESSION_SECRET ?? '').replace(/\r$/, '');
    if (adminPassword.length < 12) fail('ADMIN_PASSWORD', 'must be at least 12 characters');
    if (sessionSecret.length < 32) fail('SESSION_SECRET', 'must be at least 32 characters');
  }

  const logLevel = value(env, 'LOG_LEVEL') ?? 'info';
  if (!LOG_LEVELS.includes(logLevel)) fail('LOG_LEVEL', `must be one of ${LOG_LEVELS.join(', ')}`);

  return {
    port: portFrom(env, 'PORT', 3000),
    appUrl,
    appOrigin,
    dbPath: value(env, 'DB_PATH') ?? './data/giftdraw.db',
    tz: parseTimeZone(env),
    logLevel,
    trustedProxies: parseTrustedProxies(env, adminAuth === 'proxy'),
    adminAuth,
    // Node lowercases incoming header names, so lookups need the lowercase form.
    adminUserHeader: (value(env, 'ADMIN_USER_HEADER') ?? 'remote-user').toLowerCase(),
    adminPassword,
    sessionSecret,
    smtp: parseSmtp(env, appHost),
    assetVersion: assetHash(PUBLIC_DIR),
  };
}
