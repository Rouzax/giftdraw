import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, seedGroup } from './helpers.js';

const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'";

async function setup() {
  const t = await makeTestApp();
  const seeded = seedGroup(t.ctx, { names: ['Ada', 'Ben', 'Cor'] });
  t.app.post('/admin/ping', async () => 'pong');
  t.app.get('/boom', async () => {
    throw new Error('kaboom with private detail');
  });
  return { ...t, ...seeded, token: seeded.people[0].token };
}

function assertSecurityHeaders(res) {
  assert.equal(res.headers['referrer-policy'], 'same-origin');
  assert.equal(res.headers['x-robots-tag'], 'noindex');
  assert.equal(res.headers['content-security-policy'], CSP);
}

test('participant pages carry the security headers and no-store', async () => {
  const { app, token } = await setup();
  const res = await app.inject(`/p/${token}`);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /^text\/html/);
  assertSecurityHeaders(res);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('participant pages reached through an encoded path are still no-store', async () => {
  const { app, token } = await setup();
  const res = await app.inject(`/%70/${token}`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('error pages carry the security headers', async () => {
  const { app } = await setup();
  const res = await app.inject('/nope');
  assert.equal(res.statusCode, 404);
  assertSecurityHeaders(res);
});

test('static files are immutable and linked with the asset version', async () => {
  const { app, ctx, token } = await setup();
  const page = await app.inject(`/p/${token}`);
  const href = `/static/css/base.css?v=${ctx.config.assetVersion}`;
  assert.ok(page.body.includes(`href="${href}"`));
  const res = await app.inject(href);
  assert.equal(res.statusCode, 200);
  assertSecurityHeaders(res);
  assert.match(res.headers['cache-control'], /immutable/);
  assert.match(res.headers['cache-control'], /max-age=31536000/);
});

test('POST from another origin is refused with an HTML page', async () => {
  const { post, token, people, ctx } = await setup();
  const res = await post(`/p/${token}/lang`, { lang: 'en' }, { origin: 'https://evil.example' });
  assert.equal(res.statusCode, 403);
  assert.match(res.headers['content-type'], /^text\/html/);
  assert.ok(res.body.includes('Dit mag helaas niet.'));
  assert.equal(ctx.repo.getParticipant(people[0].id).language, 'nl');
});

test('POST with Origin null is refused', async () => {
  const { post, token } = await setup();
  const res = await post(`/p/${token}/lang`, { lang: 'en' }, { origin: 'null' });
  assert.equal(res.statusCode, 403);
});

test('POST without Origin is judged by Referer', async () => {
  const { post, token, ctx } = await setup();
  const ok = await post(`/p/${token}/lang`, { lang: 'en' }, {
    origin: undefined,
    referer: `${ctx.config.appOrigin}/p/${token}`,
  });
  assert.equal(ok.statusCode, 303);
  const bad = await post(`/p/${token}/lang`, { lang: 'en' }, {
    origin: undefined,
    referer: `https://evil.example/p/${token}`,
  });
  assert.equal(bad.statusCode, 403);
  const junk = await post(`/p/${token}/lang`, { lang: 'en' }, { origin: undefined, referer: 'not a url' });
  assert.equal(junk.statusCode, 403);
});

test('POST without Origin and Referer passes under /p/ and fails under /admin', async () => {
  const { post, token } = await setup();
  const participant = await post(`/p/${token}/lang`, { lang: 'en' }, { origin: undefined });
  assert.equal(participant.statusCode, 303);
  const admin = await post('/admin/ping', {}, { origin: undefined });
  assert.equal(admin.statusCode, 403);
  const adminSameOrigin = await post('/admin/ping', {});
  assert.equal(adminSameOrigin.statusCode, 200);
});

test('the log never contains a participant token', async () => {
  const { app, logs, token } = await setup();
  const urls = [`/p/${token}`, `/p/${token}/`, `//p/${token}`, `/p/${token}/draw`, `/p/${token}?x=1`, `/%70/${token}`];
  for (const url of urls) {
    await app.inject(url);
  }
  const text = logs.join('');
  assert.ok(logs.length > 0);
  assert.ok(text.includes('/p/:token'));
  assert.ok(!text.includes(token));
});

test('an unknown page renders the HTML 404 page and logs only the method', async () => {
  const { app, logs } = await setup();
  const res = await app.inject('/nope/secret-path');
  assert.equal(res.statusCode, 404);
  assert.match(res.headers['content-type'], /^text\/html/);
  assert.ok(res.body.includes('<html lang="nl">'));
  assert.ok(res.body.includes('Deze pagina bestaat niet.'));
  const entry = logs.map((line) => JSON.parse(line)).find((l) => l.msg === 'not_found');
  assert.equal(entry.method, 'GET');
  assert.ok(!JSON.stringify(entry).includes('secret-path'));
});

test('a thrown error renders the HTML 500 page and logs only the error class', async () => {
  const { app, logs } = await setup();
  const res = await app.inject('/boom');
  assert.equal(res.statusCode, 500);
  assert.match(res.headers['content-type'], /^text\/html/);
  assert.ok(res.body.includes('Er ging iets mis.'));
  assert.ok(!res.body.includes('kaboom'));
  const entry = logs.map((line) => JSON.parse(line)).find((l) => l.msg === 'request_error');
  assert.equal(entry.error_class, 'Error');
  assert.ok(!logs.join('').includes('kaboom'));
});

test('a malformed URL renders an HTML 400 page, not JSON', async () => {
  const { app, logs } = await setup();
  const res = await app.inject('/p/%E0%A4%A');
  assert.equal(res.statusCode, 400);
  assert.match(res.headers['content-type'], /^text\/html/);
  assertSecurityHeaders(res);
  assert.ok(!logs.join('').includes('%E0%A4%A'));
});
