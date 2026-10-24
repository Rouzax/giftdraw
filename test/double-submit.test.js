import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { t as tr } from '../src/i18n/index.js';
import { createSubmitLog } from '../src/submit-log.js';
import { makeTestApp, seedGroup, textOf } from './helpers.js';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');

async function setup(seed = { names: ['Ann', 'Bob', 'Cas'], withEmail: false }) {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  const seeded = seedGroup(t.ctx, seed);
  return { ...t, clock, ...seeded, groupId: seeded.group.id };
}

function unescapeHtml(value) {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// The value of a hidden field inside the form posting to `action`.
function formField(body, action, name) {
  const form = new RegExp(`<form[^>]*action="${action}"[^>]*>([\\s\\S]*?)</form>`).exec(body);
  assert.ok(form, `page has a form posting to ${action}`);
  const match = new RegExp(`name="${name}" value="([^"]*)"`).exec(form[1]);
  assert.ok(match, `form ${action} carries ${name}`);
  return unescapeHtml(match[1]);
}

const names = (t) => t.ctx.repo.listParticipants(t.groupId).map((p) => p.name);

test('a double-clicked "Check and add" adds the people once and both answers lead to the result', async () => {
  const t = await setup();
  const page = await t.adminGet(`/admin/groups/${t.groupId}`);
  const action = `/admin/groups/${t.groupId}/participants`;
  const form = { text: 'Dirk\nEva', formToken: formField(page.body, action, 'formToken') };
  const first = await t.adminPost(action, form);
  const second = await t.adminPost(action, form);
  assert.equal(first.statusCode, 303);
  assert.equal(second.statusCode, 303);
  assert.equal(first.headers.location, `/admin/groups/${t.groupId}?done=added`);
  assert.equal(second.headers.location, first.headers.location);
  assert.deepEqual(names(t), ['Ann', 'Bob', 'Cas', 'Dirk', 'Eva']);
  const result = await t.adminGet(first.headers.location);
  assert.ok(textOf(result.body).includes(tr('nl', 'admin.person.done.added')));
});

test('a second paste from a fresh form is added again', async () => {
  const t = await setup();
  const action = `/admin/groups/${t.groupId}/participants`;
  for (let i = 0; i < 2; i += 1) {
    const page = await t.adminGet(`/admin/groups/${t.groupId}`);
    const res = await t.adminPost(action, { text: 'Dirk', formToken: formField(page.body, action, 'formToken') });
    assert.equal(res.statusCode, 303);
  }
  assert.deepEqual(names(t), ['Ann', 'Bob', 'Cas', 'Dirk', 'Dirk']);
});

test('a double-clicked confirm adds once and the second answer is not a refusal', async () => {
  const t = await setup();
  const action = `/admin/groups/${t.groupId}/participants`;
  const check = await t.adminPost(action, { text: 'Dirk\nEva\n, bad line' });
  assert.equal(check.statusCode, 200);
  const form = {
    confirm: '1', plan: formField(check.body, action, 'plan'), formToken: formField(check.body, action, 'formToken'),
  };
  const first = await t.adminPost(action, form);
  const second = await t.adminPost(action, form);
  assert.equal(first.statusCode, 303);
  assert.equal(second.statusCode, 303, second.body);
  assert.equal(second.headers.location, `/admin/groups/${t.groupId}?done=added`);
  assert.deepEqual(names(t), ['Ann', 'Bob', 'Cas', 'Dirk', 'Eva']);
});

test('a double-clicked create event or create group makes one of each', async () => {
  const t = await setup();
  const events = await t.adminGet('/admin');
  const eventForm = { name: 'Lootjes 2027', language: 'nl', formToken: formField(events.body, '/admin/events', 'formToken') };
  const e1 = await t.adminPost('/admin/events', eventForm);
  const e2 = await t.adminPost('/admin/events', eventForm);
  assert.equal(e1.statusCode, 303);
  assert.equal(e2.headers.location, e1.headers.location);
  assert.equal(t.ctx.repo.listEvents().length, 2);
  assert.match(e1.headers.location, /^\/admin\/events\/\d+\?done=event-created$/);
  const eventPage = await t.adminGet(e1.headers.location);
  assert.ok(textOf(eventPage.body).includes(tr('nl', 'admin.person.done.event-created')));

  const eventId = Number(/\/admin\/events\/(\d+)/.exec(e1.headers.location)[1]);
  const action = `/admin/events/${eventId}/groups`;
  const groupForm = { name: 'Dinsdag', exchangeDate: '2026-12-18', formToken: formField(eventPage.body, action, 'formToken') };
  const g1 = await t.adminPost(action, groupForm);
  const g2 = await t.adminPost(action, groupForm);
  assert.equal(g1.statusCode, 303);
  assert.equal(g2.headers.location, g1.headers.location);
  assert.match(g1.headers.location, /^\/admin\/groups\/\d+\?done=group-created$/);
  assert.equal(t.ctx.repo.listGroups(eventId).length, 1);
});

test('a refused post does not use up its form token', async () => {
  const t = await setup();
  const events = await t.adminGet('/admin');
  const token = formField(events.body, '/admin/events', 'formToken');
  const refused = await t.adminPost('/admin/events', { name: '', language: 'nl', formToken: token });
  assert.equal(refused.statusCode, 400);
  const created = await t.adminPost('/admin/events', { name: 'Lootjes 2027', language: 'nl', formToken: token });
  assert.equal(created.statusCode, 303);
  assert.equal(t.ctx.repo.listEvents().length, 2);
});

test('a double-clicked remove confirm leads to the group both times', async () => {
  const t = await setup({ names: ['Ann', 'Bob', 'Cas', 'Dirk'], withEmail: false });
  const dropout = t.people[0];
  const preview = await t.adminGet(`/admin/participants/${dropout.id}/remove`);
  const action = `/admin/participants/${dropout.id}/remove`;
  const form = {
    plan: formField(preview.body, action, 'plan'),
    group: formField(preview.body, action, 'group'),
    formToken: formField(preview.body, action, 'formToken'),
  };
  const first = await t.adminPost(action, form);
  const second = await t.adminPost(action, form);
  assert.equal(first.statusCode, 303);
  assert.equal(second.statusCode, 303, second.body);
  assert.equal(first.headers.location, `/admin/groups/${t.groupId}?done=removed`);
  assert.equal(second.headers.location, first.headers.location);
  assert.deepEqual(names(t), ['Bob', 'Cas', 'Dirk']);
});

test('a second "Open drawing" leads to the open dashboard instead of an error', async () => {
  const t = await setup({ names: ['Ann', 'Bob', 'Cas'], withEmail: false });
  t.ctx.repo.markInvitationsSent(t.groupId, t.ctx.nowIso());
  const first = await t.adminPost(`/admin/groups/${t.groupId}/open`);
  const second = await t.adminPost(`/admin/groups/${t.groupId}/open`);
  assert.equal(first.statusCode, 303);
  assert.equal(second.statusCode, 303, second.body);
  assert.equal(first.headers.location, `/admin/groups/${t.groupId}?done=opened`);
  assert.equal(second.headers.location, first.headers.location);
  const page = await t.adminGet(first.headers.location);
  assert.ok(textOf(page.body).includes(tr('nl', 'admin.person.done.opened')));
  assert.ok(!page.body.includes('notice error'));
});

test('admin pages load the script that disables a form after its first submit', async () => {
  const t = await setup();
  for (const url of ['/admin', `/admin/events/${t.event.id}`, `/admin/groups/${t.groupId}`, `/admin/participants/${t.people[0].id}`]) {
    const res = await t.adminGet(url);
    assert.match(res.body, /<script src="\/static\/js\/submit-once\.js\?v=[^"]+" defer><\/script>/, url);
  }
});

test('the submit log replays a recorded token, forgets it after its time, and stays bounded', () => {
  const clock = { ms: 0 };
  const log = createSubmitLog({ ttlMs: 1000, max: 2, now: () => clock.ms });
  const [a, b, c] = ['A', 'B', 'C'].map((ch) => ch.repeat(22));
  const at = (location) => ({ location });
  assert.equal(log.replay(a, 'f'), null);
  log.record(a, 'f', at('/one'));
  assert.deepEqual(log.replay(a, 'f'), at('/one'));
  log.record(b, 'f', at('/two'));
  log.record(c, 'f', at('/three'));
  assert.equal(log.replay(a, 'f'), null, 'the oldest entry made room');
  assert.deepEqual(log.replay(c, 'f'), at('/three'));
  clock.ms = 1001;
  assert.equal(log.replay(c, 'f'), null);
  // Missing or malformed tokens are never recorded or replayed.
  log.record(undefined, 'f', at('/x'));
  log.record('short', 'f', at('/x'));
  assert.equal(log.replay(undefined, 'f'), null);
  assert.equal(log.replay('short', 'f'), null);
});

// A browser can restore a page with its token after Back, and the organiser
// then sends something else with it.
test('a used token with a different form is acted on; with the same form it replays', async () => {
  const t = await setup();
  const page = await t.adminGet(`/admin/groups/${t.groupId}`);
  const action = `/admin/groups/${t.groupId}/participants`;
  const formToken = formField(page.body, action, 'formToken');
  assert.equal((await t.adminPost(action, { text: 'Dirk', formToken })).statusCode, 303);
  assert.equal((await t.adminPost(action, { text: 'Eva', formToken })).statusCode, 303);
  assert.equal((await t.adminPost(action, { text: 'Eva', formToken })).statusCode, 303);
  assert.deepEqual(names(t), ['Ann', 'Bob', 'Cas', 'Dirk', 'Eva']);

  const events = await t.adminGet('/admin');
  const token = formField(events.body, '/admin/events', 'formToken');
  await t.adminPost('/admin/events', { name: 'Een', language: 'nl', formToken: token });
  await t.adminPost('/admin/events', { name: 'Twee', language: 'nl', formToken: token });
  assert.deepEqual(t.ctx.repo.listEvents().map((e) => e.name).slice(1), ['Een', 'Twee']);
});

test('the token field is left out of browser autofill', async () => {
  const t = await setup();
  const page = await t.adminGet(`/admin/groups/${t.groupId}`);
  assert.match(page.body, /<input type="hidden" name="formToken" value="[^"]+" autocomplete="off">/);
});

test('the submit log replays only for the same fingerprint', () => {
  const log = createSubmitLog();
  const token = 'A'.repeat(22);
  log.record(token, 'one', { location: '/one' });
  assert.equal(log.replay(token, 'two'), null);
  assert.deepEqual(log.replay(token, 'one'), { location: '/one' });
});

// Whether a giver who had drawn got no mail is a pairing hint, and the
// reverse proxy logs every URL.
test('the tell-them-yourself notice travels outside the URL and shows once', async () => {
  const t = await setup({ names: ['Pia', 'Quin', 'Rob', 'Sam'], withEmail: false, opened: true });
  for (const p of t.people) t.ctx.repo.updateParticipant(p.id, { drawnAt: t.ctx.nowIso() });
  const action = `/admin/groups/${t.groupId}/participants`;
  const check = await t.adminPost(action, { text: 'Nieuw' });
  const form = { confirm: '1', plan: formField(check.body, action, 'plan'), formToken: formField(check.body, action, 'formToken') };
  const res = await t.adminPost(action, form);
  assert.equal(res.headers.location, `/admin/groups/${t.groupId}?done=added`);
  const flash = [res.headers['set-cookie']].flat().find((c) => c?.startsWith('giftdraw_flash='));
  assert.ok(flash, 'the notice rides in a cookie');
  assert.match(flash, /HttpOnly/);
  const cookie = `${t.adminCookie()}; ${flash.split(';')[0]}`;
  const page = await t.adminGet(res.headers.location, { cookie });
  assert.ok(textOf(page.body).includes(tr('nl', 'admin.person.done.added-tell')));
  const cleared = [page.headers['set-cookie']].flat().find((c) => c?.startsWith('giftdraw_flash='));
  assert.match(cleared, /^giftdraw_flash=;/);
  // The replay sets it again, since the browser may have dropped the first answer.
  const again = await t.adminPost(action, form);
  assert.ok([again.headers['set-cookie']].flat().some((c) => c?.startsWith('giftdraw_flash=tell')));
  // A hand-typed URL cannot ask for it.
  const typed = await t.adminGet(`/admin/groups/${t.groupId}?done=added-tell`);
  assert.ok(!textOf(typed.body).includes(tr('nl', 'admin.person.done.added-tell')));
});

test('submit-once.js gives a page restored from the back-forward cache its buttons and a fresh token', () => {
  const handlers = {};
  const button = { disabled: true, attrs: { 'data-sent': '' }, removeAttribute(name) { delete this.attrs[name]; } };
  const token = { value: 'A'.repeat(22) };
  const document = {
    addEventListener() {},
    querySelectorAll: (selector) => (selector.includes('formToken') ? [token] : [button]),
  };
  const window = { addEventListener: (type, fn) => { handlers[type] = fn; }, crypto: globalThis.crypto, btoa: globalThis.btoa };
  const source = readFileSync(new URL('../public/js/submit-once.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { window, document, setTimeout, Uint8Array, String });
  handlers.pageshow({ persisted: false });
  assert.equal(button.disabled, true, 'a fresh load changes nothing');
  handlers.pageshow({ persisted: true });
  assert.equal(button.disabled, false);
  assert.match(token.value, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(token.value, 'A'.repeat(22));
});
