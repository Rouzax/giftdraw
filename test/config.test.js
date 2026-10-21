import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { assetHash } from '../src/assets.js';
import { loadConfig } from '../src/config.js';

const PASSWORD = 'correct-horse-battery';
const SECRET = 's'.repeat(32);
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));

function passwordEnv(extra = {}) {
  return {
    APP_URL: 'https://gifts.example.com',
    ADMIN_AUTH: 'password',
    ADMIN_PASSWORD: PASSWORD,
    SESSION_SECRET: SECRET,
    ...extra,
  };
}

function throwsNaming(env, name) {
  assert.throws(() => loadConfig(env), (err) => {
    assert.match(err.message, new RegExp(`\\b${name}\\b`));
    return true;
  });
}

test('missing APP_URL throws naming it', () => {
  const env = passwordEnv();
  delete env.APP_URL;
  throwsNaming(env, 'APP_URL');
});

test('relative or non-http APP_URL throws', () => {
  throwsNaming(passwordEnv({ APP_URL: '/gifts' }), 'APP_URL');
  throwsNaming(passwordEnv({ APP_URL: 'ftp://gifts.example.com' }), 'APP_URL');
});

test('missing ADMIN_AUTH throws naming it', () => {
  const env = passwordEnv();
  delete env.ADMIN_AUTH;
  throwsNaming(env, 'ADMIN_AUTH');
  throwsNaming(passwordEnv({ ADMIN_AUTH: 'none' }), 'ADMIN_AUTH');
});

test('proxy mode without TRUSTED_PROXIES throws', () => {
  throwsNaming({ APP_URL: 'https://gifts.example.com', ADMIN_AUTH: 'proxy' }, 'TRUSTED_PROXIES');
});

test('proxy mode parses TRUSTED_PROXIES and rejects bad entries', () => {
  const config = loadConfig({
    APP_URL: 'https://gifts.example.com',
    ADMIN_AUTH: 'proxy',
    TRUSTED_PROXIES: '192.0.2.10, 172.16.0.0/12,2001:db8::/32',
  });
  assert.deepEqual(config.trustedProxies, ['192.0.2.10', '172.16.0.0/12', '2001:db8::/32']);
  assert.equal(config.adminAuth, 'proxy');
  assert.equal(config.adminPassword, null);
  assert.equal(config.sessionSecret, null);
  throwsNaming(
    { APP_URL: 'https://gifts.example.com', ADMIN_AUTH: 'proxy', TRUSTED_PROXIES: '192.0.2.0/33' },
    'TRUSTED_PROXIES',
  );
  throwsNaming(
    { APP_URL: 'https://gifts.example.com', ADMIN_AUTH: 'proxy', TRUSTED_PROXIES: 'proxy.example.com' },
    'TRUSTED_PROXIES',
  );
});

test('password mode rejects an 11 character password', () => {
  throwsNaming(passwordEnv({ ADMIN_PASSWORD: 'p'.repeat(11) }), 'ADMIN_PASSWORD');
  assert.equal(loadConfig(passwordEnv({ ADMIN_PASSWORD: 'p'.repeat(12) })).adminPassword, 'p'.repeat(12));
});

test('password mode rejects a 31 character session secret', () => {
  throwsNaming(passwordEnv({ SESSION_SECRET: 's'.repeat(31) }), 'SESSION_SECRET');
});

test('APP_URL trailing slash is stripped and origin derived', () => {
  const config = loadConfig(passwordEnv({ APP_URL: 'https://gifts.example.com/draw/' }));
  assert.equal(config.appUrl, 'https://gifts.example.com/draw');
  assert.equal(config.appOrigin, 'https://gifts.example.com');
  assert.equal(loadConfig(passwordEnv({ APP_URL: 'http://localhost:3000/' })).appUrl, 'http://localhost:3000');
});

test('defaults', () => {
  const config = loadConfig(passwordEnv());
  assert.equal(config.port, 3000);
  assert.equal(config.dbPath, './data/giftdraw.db');
  assert.equal(config.tz, 'Europe/Amsterdam');
  assert.equal(config.logLevel, 'info');
  assert.equal(config.adminUserHeader, 'remote-user');
  assert.deepEqual(config.trustedProxies, []);
  assert.equal(config.smtp, null);
  assert.equal(config.assetVersion, assetHash(PUBLIC));
});

test('explicit values override defaults', () => {
  const config = loadConfig(passwordEnv({
    PORT: '8080',
    DB_PATH: '/srv/giftdraw.db',
    TZ: 'UTC',
    LOG_LEVEL: 'debug',
    ADMIN_USER_HEADER: 'X-Forwarded-User',
    // No longer read: the asset version follows the files themselves.
    APP_VERSION: '1.2.3',
  }));
  assert.equal(config.port, 8080);
  assert.equal(config.dbPath, '/srv/giftdraw.db');
  assert.equal(config.tz, 'UTC');
  assert.equal(config.logLevel, 'debug');
  assert.equal(config.adminUserHeader, 'x-forwarded-user');
  assert.equal(config.assetVersion, assetHash(PUBLIC));
});

test('invalid PORT, TZ and LOG_LEVEL throw naming the variable', () => {
  throwsNaming(passwordEnv({ PORT: 'abc' }), 'PORT');
  throwsNaming(passwordEnv({ PORT: '70000' }), 'PORT');
  throwsNaming(passwordEnv({ TZ: 'Mars/Olympus' }), 'TZ');
  throwsNaming(passwordEnv({ LOG_LEVEL: 'loud' }), 'LOG_LEVEL');
});

test('smtp is null without SMTP_HOST and filled with it', () => {
  assert.equal(loadConfig(passwordEnv({ SMTP_USER: 'mailer' })).smtp, null);
  const config = loadConfig(passwordEnv({
    SMTP_HOST: 'smtp.example.com',
    SMTP_USER: 'mailer',
    SMTP_PASS: 'mail-pass',
    SMTP_FROM: 'Gift Draw <draw@example.com>',
  }));
  assert.deepEqual(config.smtp, {
    host: 'smtp.example.com',
    port: 587,
    user: 'mailer',
    pass: 'mail-pass',
    from: 'Gift Draw <draw@example.com>',
  });
  throwsNaming(passwordEnv({ SMTP_HOST: 'smtp.example.com' }), 'SMTP_FROM');
  throwsNaming(passwordEnv({ SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'draw@example.com', SMTP_PORT: 'x' }), 'SMTP_PORT');
});

test('no error message echoes a secret value', () => {
  const shortPassword = 'hunter2-abc';
  const shortSecret = 'q'.repeat(31);
  const cases = [
    passwordEnv({ ADMIN_PASSWORD: shortPassword }),
    passwordEnv({ ADMIN_PASSWORD: PASSWORD, SESSION_SECRET: shortSecret }),
    passwordEnv({ APP_URL: 'not a url ' + PASSWORD }),
    passwordEnv({ PORT: PASSWORD }),
  ];
  for (const env of cases) {
    assert.throws(() => loadConfig(env), (err) => {
      for (const value of [shortPassword, shortSecret, PASSWORD]) {
        assert.ok(!err.message.includes(value), `message leaks a value: ${err.message}`);
      }
      return true;
    });
  }
});
