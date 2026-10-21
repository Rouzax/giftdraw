import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminCookieValue, formBody, makeTestApp, seedGroup } from './helpers.js';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = 'correct-horse-battery';
const PORTAL_NL = 'alleen bereikbaar via het inlogportaal';

const PROXY_CONFIG = {
  adminAuth: 'proxy',
  trustedProxies: ['192.0.2.0/24', '2001:db8::/32', '203.0.113.5'],
  adminPassword: null,
  sessionSecret: null,
};

async function setup(configOverrides = {}) {
  const clock = { ms: T0 };
  const t = await makeTestApp({ configOverrides, clock: () => new Date(clock.ms) });
  const seeded = seedGroup(t.ctx, { names: ['Ada', 'Ben', 'Cor'] });
  return { ...t, clock, ada: seeded.people[0] };
}

const proxySetup = () => setup(PROXY_CONFIG);

function asProxy(app, { url = '/admin', remoteAddress = '192.0.2.10', user = 'organiser', headers = {} } = {}) {
  const all = { ...headers };
  if (user !== null) all['remote-user'] = user;
  return app.inject({ method: 'GET', url, remoteAddress, headers: all });
}

function login(app, password, { remoteAddress = '198.51.100.20', origin = 'https://gifts.example.com' } = {}) {
  return app.inject({
    method: 'POST',
    url: '/admin/login',
    remoteAddress,
    payload: formBody({ password }),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
  });
}

function cookieNamed(res, name) {
  const raw = res.headers['set-cookie'];
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return list.find((c) => c.startsWith(`${name}=`));
}

function assertRedirectToLogin(res) {
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/admin/login');
}

// Proxy mode

test('proxy mode: a request from outside the trusted proxies is refused', async () => {
  const { app } = await proxySetup();
  const res = await asProxy(app, { remoteAddress: '198.51.100.9' });
  assert.equal(res.statusCode, 403);
  assert.match(res.headers['content-type'], /^text\/html/);
  assert.ok(res.body.includes(PORTAL_NL));
  assert.ok(!res.body.includes('action="/admin/lang"'));
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('proxy mode: a trusted proxy with the user header reaches the admin', async () => {
  const { app } = await proxySetup();
  const res = await asProxy(app);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('<html lang="nl">'));
  assert.ok(res.body.includes('Evenementen'));
  assert.ok(res.body.includes('Gifts 2026'));
});

test('proxy mode: the check uses the socket, not the forwarded client address', async () => {
  const { app } = await proxySetup();
  const res = await asProxy(app, { headers: { 'x-forwarded-for': '198.51.100.9' } });
  assert.equal(res.statusCode, 200);
});

test('proxy mode: a trusted proxy without the user header is refused', async () => {
  const { app } = await proxySetup();
  assert.equal((await asProxy(app, { user: null })).statusCode, 403);
  assert.equal((await asProxy(app, { user: '' })).statusCode, 403);
  assert.equal((await asProxy(app, { user: '   ' })).statusCode, 403);
});

test('proxy mode: a spoofed X-Forwarded-For from an outside address is refused', async () => {
  const { app } = await proxySetup();
  const res = await asProxy(app, { remoteAddress: '198.51.100.9', headers: { 'x-forwarded-for': '192.0.2.10' } });
  assert.equal(res.statusCode, 403);
});

test('proxy mode: CIDR, single address, IPv6 and IPv4-mapped addresses', async () => {
  const { app } = await proxySetup();
  assert.equal((await asProxy(app, { remoteAddress: '192.0.2.254' })).statusCode, 200);
  assert.equal((await asProxy(app, { remoteAddress: '::ffff:192.0.2.10' })).statusCode, 200);
  assert.equal((await asProxy(app, { remoteAddress: '203.0.113.5' })).statusCode, 200);
  assert.equal((await asProxy(app, { remoteAddress: '2001:db8::7' })).statusCode, 200);
  assert.equal((await asProxy(app, { remoteAddress: '203.0.113.6' })).statusCode, 403);
  assert.equal((await asProxy(app, { remoteAddress: '192.0.3.1' })).statusCode, 403);
  assert.equal((await asProxy(app, { remoteAddress: '::ffff:198.51.100.9' })).statusCode, 403);
  assert.equal((await asProxy(app, { remoteAddress: '2001:db9::1' })).statusCode, 403);
});

test('proxy mode: the user header name comes from the configuration', async () => {
  const { app } = await setup({ ...PROXY_CONFIG, adminUserHeader: 'x-forwarded-user' });
  assert.equal((await asProxy(app)).statusCode, 403);
  const res = await asProxy(app, { user: null, headers: { 'x-forwarded-user': 'organiser' } });
  assert.equal(res.statusCode, 200);
});

test('proxy mode: there is no password login', async () => {
  const { app } = await proxySetup();
  const outside = await asProxy(app, { url: '/admin/login', remoteAddress: '198.51.100.9' });
  assert.equal(outside.statusCode, 403);
  const res = await login(app, PASSWORD, { remoteAddress: '198.51.100.9' });
  assert.equal(res.statusCode, 403);
  assert.equal(cookieNamed(res, 'giftdraw_admin'), undefined);
});

test('proxy mode: non-canonical admin paths are refused too', async () => {
  const { app } = await proxySetup();
  for (const url of ['//admin', '/%61dmin', '/x/../admin', '/admin/', '/admin/nothing-here', '/ADMIN/../admin']) {
    const res = await asProxy(app, { url, remoteAddress: '198.51.100.9' });
    assert.equal(res.statusCode, 403, url);
    assert.ok(!res.body.includes('Evenementen'), url);
  }
});

// Password mode

test('password mode: the admin redirects to the login page', async () => {
  const { app } = await setup();
  assertRedirectToLogin(await app.inject('/admin'));
  const page = await app.inject('/admin/login');
  assert.equal(page.statusCode, 200);
  assert.ok(page.body.includes('<html lang="nl">'));
  assert.ok(page.body.includes('type="password"'));
  assert.ok(page.body.includes('action="/admin/login"'));
  assert.equal(page.headers['cache-control'], 'no-store');
});

test('password mode: non-canonical admin paths are guarded', async () => {
  const { app } = await setup();
  for (const url of ['//admin', '/%61dmin', '/x/../admin', '/admin/nothing-here']) {
    const res = await app.inject(url);
    assertRedirectToLogin(res);
  }
});

test('password mode: a POST without a session is refused', async () => {
  const { post } = await setup();
  const res = await post('/admin/logout');
  assert.equal(res.statusCode, 403);
});

test('password mode: a wrong password stays on the form with an error', async () => {
  const { app, logs } = await setup();
  const res = await login(app, 'wrong-password-123');
  assert.equal(res.statusCode, 401);
  assert.ok(res.body.includes('Dat wachtwoord klopt niet.'));
  assert.ok(res.body.includes('type="password"'));
  assert.equal(cookieNamed(res, 'giftdraw_admin'), undefined);
  const text = logs.join('');
  assert.ok(text.includes('admin_login_failed'));
  assert.ok(!text.includes('wrong-password-123'));
});

test('password mode: the right password sets the session cookie and reaches the admin', async () => {
  const { app, logs } = await setup();
  const res = await login(app, PASSWORD);
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/admin');
  const cookie = cookieNamed(res, 'giftdraw_admin');
  assert.ok(cookie);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Path=\/admin/);
  const value = cookie.split(';')[0];
  assert.match(value, /^giftdraw_admin=\d+\.[A-Za-z0-9_-]+$/);

  const page = await app.inject({ url: '/admin', headers: { cookie: value } });
  assert.equal(page.statusCode, 200);
  assert.ok(page.body.includes('Evenementen'));
  assert.ok(page.body.includes('action="/admin/logout"'));

  const text = logs.join('');
  assert.ok(text.includes('admin_login'));
  assert.ok(!text.includes(PASSWORD));
  assert.ok(!text.includes(value.split('.')[1]));
});

test('password mode: the cookie is not Secure when the app runs on http', async () => {
  const { app } = await setup({ appUrl: 'http://localhost:3000', appOrigin: 'http://localhost:3000' });
  const res = await login(app, PASSWORD, { origin: 'http://localhost:3000' });
  assert.equal(res.statusCode, 303);
  assert.doesNotMatch(cookieNamed(res, 'giftdraw_admin'), /Secure/);
});

test('password mode: tampered, expired, future and foreign cookies are rejected', async () => {
  const { app, ctx } = await setup();
  const { config } = ctx;
  const good = adminCookieValue(config, T0);
  const [issued, mac] = good.split('.');
  const flipped = mac[0] === 'A' ? `B${mac.slice(1)}` : `A${mac.slice(1)}`;
  const otherPassword = { ...config, adminPassword: 'an-older-password' };
  const otherSecret = { ...config, sessionSecret: 't'.repeat(32) };
  const rejected = [
    `${issued}.${flipped}`,
    `${Number(issued) + 1}.${mac}`,
    `${issued}.${mac}x`,
    `${issued}`,
    'garbage',
    '',
    adminCookieValue(config, T0 - 31 * DAY),
    adminCookieValue(config, T0 + DAY),
    adminCookieValue(otherPassword, T0),
    adminCookieValue(otherSecret, T0),
  ];
  for (const value of rejected) {
    assertRedirectToLogin(await app.inject({ url: '/admin', headers: { cookie: `giftdraw_admin=${value}` } }));
  }
  const fresh = await app.inject({ url: '/admin', headers: { cookie: `giftdraw_admin=${good}` } });
  assert.equal(fresh.statusCode, 200);
  const old = adminCookieValue(config, T0 - 29 * DAY);
  assert.equal((await app.inject({ url: '/admin', headers: { cookie: `giftdraw_admin=${old}` } })).statusCode, 200);
});

test('password mode: a session stops working after 30 days', async () => {
  const { app, adminCookie, clock } = await setup();
  const cookie = adminCookie();
  clock.ms += 30 * DAY;
  assert.equal((await app.inject({ url: '/admin', headers: { cookie } })).statusCode, 200);
  clock.ms += 1;
  assertRedirectToLogin(await app.inject({ url: '/admin', headers: { cookie } }));
});

test('password mode: logout clears the cookie', async () => {
  const { adminPost } = await setup();
  const res = await adminPost('/admin/logout');
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/admin/login');
  const cleared = cookieNamed(res, 'giftdraw_admin');
  assert.ok(cleared);
  assert.match(cleared, /^giftdraw_admin=;/);
  assert.match(cleared, /Path=\/admin/);
  assert.match(cleared, /Expires=Thu, 01 Jan 1970|Max-Age=0/);
});

test('password mode: the 11th failed login from one IP is refused even with the right password', async () => {
  const { app, clock, logs } = await setup();
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await login(app, `wrong-${i}-password`)).statusCode, 401);
  }
  const refused = await login(app, PASSWORD);
  assert.equal(refused.statusCode, 429);
  assert.ok(refused.body.includes('Te veel pogingen. Probeer het later opnieuw.'));
  assert.equal(cookieNamed(refused, 'giftdraw_admin'), undefined);
  assert.ok(logs.join('').includes('admin_login_blocked'));

  assert.equal((await login(app, PASSWORD, { remoteAddress: '198.51.100.21' })).statusCode, 303);

  clock.ms += 15 * 60 * 1000;
  assert.equal((await login(app, PASSWORD)).statusCode, 303);
});

test('password mode: 50 failed logins in an hour lock the form for everyone', async () => {
  const { app, clock } = await setup();
  for (let ip = 0; ip < 5; ip += 1) {
    for (let i = 0; i < 10; i += 1) {
      const res = await login(app, `wrong-${i}-password`, { remoteAddress: `198.51.100.${30 + ip}` });
      assert.equal(res.statusCode, 401);
    }
  }
  assert.equal((await login(app, PASSWORD, { remoteAddress: '198.51.100.99' })).statusCode, 429);
  clock.ms += 60 * 60 * 1000;
  assert.equal((await login(app, PASSWORD, { remoteAddress: '198.51.100.99' })).statusCode, 303);
});

test('password mode: a login from another origin is refused', async () => {
  const { app } = await setup();
  const res = await login(app, PASSWORD, { origin: 'https://evil.example.com' });
  assert.equal(res.statusCode, 403);
  assert.equal(cookieNamed(res, 'giftdraw_admin'), undefined);
});

// Language

test('the admin is Dutch by default and switches with the language cookie', async () => {
  const { adminGet, adminPost, adminCookie } = await setup();
  const res = await adminPost('/admin/lang', { lang: 'en' }, { referer: 'https://gifts.example.com/admin/login' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/admin/login');
  const cookie = cookieNamed(res, 'giftdraw_lang');
  assert.match(cookie, /^giftdraw_lang=en;/);
  assert.match(cookie, /Path=\/admin/);

  const english = await adminGet('/admin', { cookie: `${adminCookie()}; giftdraw_lang=en` });
  assert.ok(english.body.includes('<html lang="en">'));
  assert.ok(english.body.includes('Events'));
  const unknown = await adminGet('/admin', { cookie: `${adminCookie()}; giftdraw_lang=de` });
  assert.ok(unknown.body.includes('<html lang="nl">'));
});

test('the language switch ignores unknown languages and foreign return paths', async () => {
  const { adminPost } = await setup();
  const bad = await adminPost('/admin/lang', { lang: 'de' });
  assert.equal(bad.statusCode, 303);
  assert.equal(bad.headers.location, '/admin');
  assert.equal(cookieNamed(bad, 'giftdraw_lang'), undefined);
  const foreign = await adminPost('/admin/lang', { lang: 'en' }, { referer: 'https://evil.example.com/admin/x' });
  assert.equal(foreign.headers.location, '/admin');
  const outside = await adminPost('/admin/lang', { lang: 'en' }, { referer: 'https://gifts.example.com/p/abc' });
  assert.equal(outside.headers.location, '/admin');
});

test('the login page can switch language before logging in', async () => {
  const { app, post } = await setup();
  const res = await post('/admin/lang', { lang: 'en' });
  assert.equal(res.statusCode, 303);
  assert.ok(cookieNamed(res, 'giftdraw_lang'));
  const page = await app.inject({ url: '/admin/login', headers: { cookie: 'giftdraw_lang=en' } });
  assert.ok(page.body.includes('<html lang="en">'));
  assert.ok(page.body.includes('action="/admin/lang"'));
});

// Participants

test('participant pages are unaffected by either admin mode', async () => {
  for (const overrides of [{}, PROXY_CONFIG]) {
    const { app, ada } = await setup(overrides);
    const res = await app.inject({ url: `/p/${ada.token}`, remoteAddress: '198.51.100.9' });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes('Hallo Ada!'));
  }
});

test('proxy mode: health is reachable from anywhere without the user header', async () => {
  const { app } = await proxySetup();
  const res = await app.inject({ method: 'GET', url: '/health', remoteAddress: '198.51.100.7' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
});
