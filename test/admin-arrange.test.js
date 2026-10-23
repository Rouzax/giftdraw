import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { openGroup } from '../src/drawing.js';
import { validateAssignment } from '../src/draw/cycle.js';
import { drawFor } from '../src/people.js';
import { assignmentVersion } from '../src/status.js';
import { makeTestApp, seedGroup } from './helpers.js';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');
const FIVE = ['Ada', 'Ben', 'Cor', 'Dirk', 'Eva'];

async function setup(seed = {}) {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  const seeded = seedGroup(t.ctx, { names: FIVE, ...seed });
  return { ...t, clock, ...seeded, groupId: seeded.group.id };
}

function currentVersion(t) {
  const drawn = t.ctx.repo.listParticipants(t.groupId).filter((p) => p.drawnAt).map((p) => p.id);
  return assignmentVersion(t.ctx.repo.getAssignment(t.groupId), drawn);
}

// Two givers that can swap without anyone getting themselves.
function swappable(map) {
  for (const [a, ra] of map) {
    for (const [b, rb] of map) {
      if (a !== b && ra !== b && rb !== a) return [a, b];
    }
  }
  throw new Error('no swappable pair');
}

async function settle(t) {
  await new Promise((resolve) => setImmediate(resolve));
  await t.drain();
  await t.drain();
}

const count = (t, sql, ...params) => t.db.prepare(sql).get(...params).n;
const drawOpenRows = (t) => count(t, "SELECT count(*) AS n FROM outbox WHERE kind = 'draw-open'");

test('the arrange page shows every pair with the version and a swap form per unlocked giver', async () => {
  const t = await setup({ opened: true });
  const [ada, ben] = t.people;
  drawFor(t.ctx, ada.id);
  const res = await t.adminGet(`/admin/groups/${t.groupId}/arrange`);
  assert.equal(res.statusCode, 200);
  const version = currentVersion(t);
  const forms = res.body.match(/<form method="post" action="\/admin\/groups\/\d+\/swap"/g) ?? [];
  assert.equal(forms.length, FIVE.length - 1, 'no form for the giver who has drawn');
  assert.equal((res.body.match(new RegExp(`name="version" value="${version}"`, 'g')) ?? []).length, forms.length);
  assert.ok(res.body.includes(`name="a" value="${ben.id}"`));
  assert.equal(res.body.includes(`name="a" value="${ada.id}"`), false);
  assert.ok(res.body.includes('class="lock"'));
  assert.ok(res.body.includes('/static/js/arrange.js'));
  // The drawn giver is no option in anyone's select either.
  assert.equal(res.body.includes(`<option value="${ada.id}"`), false);
});

test('a swap of two unlocked givers changes exactly their receivers', async () => {
  const t = await setup();
  const before = t.ctx.repo.getAssignment(t.groupId);
  const [a, b] = swappable(before);
  t.clock.ms += 60_000;
  const res = await t.adminPost(`/admin/groups/${t.groupId}/swap`, { a, b, version: currentVersion(t) });
  assert.equal(res.statusCode, 303, res.body);
  assert.equal(res.headers.location, `/admin/groups/${t.groupId}/arrange?swapped=${a}-${b}`);
  const after = t.ctx.repo.getAssignment(t.groupId);
  assert.equal(after.get(a), before.get(b));
  assert.equal(after.get(b), before.get(a));
  for (const [giver, receiver] of before) {
    if (giver !== a && giver !== b) assert.equal(after.get(giver), receiver);
  }
  assert.ok(validateAssignment(after, t.people.map((p) => p.id)));
  const changed = t.ctx.repo.listParticipants(t.groupId).filter((p) => p.receiverChangedAt === new Date(t.clock.ms).toISOString());
  assert.deepEqual(changed.map((p) => p.id).sort(), [a, b].sort());
  const page = await t.adminGet(res.headers.location);
  assert.equal(page.statusCode, 200);
  assert.ok(page.body.includes('class="notice done"'));
});

test('a swap in an open group of two undrawn givers is allowed and sends no mail', async () => {
  const t = await setup({ opened: true });
  const before = t.ctx.repo.getAssignment(t.groupId);
  const [a, b] = swappable(before);
  const res = await t.adminPost(`/admin/groups/${t.groupId}/swap`, { a, b, version: currentVersion(t) });
  assert.equal(res.statusCode, 303, res.body);
  assert.equal(t.ctx.repo.getAssignment(t.groupId).get(a), before.get(b));
  await settle(t);
  assert.equal(count(t, 'SELECT count(*) AS n FROM outbox'), 0);
  assert.equal(t.mails.length, 0);
});

test('a swap posted with a version from before one giver drew is refused and nothing changes', async () => {
  const t = await setup({ opened: true });
  const before = t.ctx.repo.getAssignment(t.groupId);
  const [a, b] = swappable(before);
  const version = currentVersion(t);
  drawFor(t.ctx, a);
  const res = await t.adminPost(`/admin/groups/${t.groupId}/swap`, { a, b, version });
  assert.equal(res.statusCode, 409);
  assert.ok(res.body.includes('role="alert"'));
  assert.deepEqual(t.ctx.repo.getAssignment(t.groupId), before);
});

test('a swap with a giver who has drawn is refused even with a current version', async () => {
  const t = await setup({ opened: true });
  const before = t.ctx.repo.getAssignment(t.groupId);
  const [a, b] = swappable(before);
  drawFor(t.ctx, b);
  const res = await t.adminPost(`/admin/groups/${t.groupId}/swap`, { a, b, version: currentVersion(t) });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(t.ctx.repo.getAssignment(t.groupId), before);
});

test('a stale version is refused', async () => {
  const t = await setup();
  const before = t.ctx.repo.getAssignment(t.groupId);
  const [a, b] = swappable(before);
  const res = await t.adminPost(`/admin/groups/${t.groupId}/swap`, { a, b, version: '0000000000000000' });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(t.ctx.repo.getAssignment(t.groupId), before);
});

test('a self-giving swap is refused', async () => {
  const t = await setup();
  const before = t.ctx.repo.getAssignment(t.groupId);
  const a = t.people[0].id;
  const b = before.get(a);
  const res = await t.adminPost(`/admin/groups/${t.groupId}/swap`, { a, b, version: currentVersion(t) });
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.includes('role="alert"'));
  assert.deepEqual(t.ctx.repo.getAssignment(t.groupId), before);
});

test('a swap with ids outside the group, malformed or equal is refused', async () => {
  const t = await setup();
  const other = seedGroup(t.ctx, { names: ['Fay', 'Gus', 'Hal'] });
  const before = t.ctx.repo.getAssignment(t.groupId);
  const version = currentVersion(t);
  const a = t.people[0].id;
  for (const b of [other.people[0].id, 'x', '', a, '99999']) {
    const res = await t.adminPost(`/admin/groups/${t.groupId}/swap`, { a, b, version });
    assert.equal(res.statusCode, 400, String(b));
  }
  assert.deepEqual(t.ctx.repo.getAssignment(t.groupId), before);
});

test('the arrange page and swap answer 404 for an unknown group', async () => {
  const t = await setup();
  assert.equal((await t.adminGet('/admin/groups/999/arrange')).statusCode, 404);
  assert.equal((await t.adminPost('/admin/groups/999/swap', { a: 1, b: 2, version: 'x' })).statusCode, 404);
  assert.equal((await t.adminPost('/admin/groups/999/open')).statusCode, 404);
});

test('opening before the invitations went out is refused', async () => {
  const t = await setup();
  assert.deepEqual(openGroup(t.ctx, t.groupId), { opened: false, reason: 'no-invitations' });
  const res = await t.adminPost(`/admin/groups/${t.groupId}/open`);
  assert.equal(res.statusCode, 409);
  assert.ok(res.body.includes('role="alert"'));
  assert.equal(t.ctx.repo.getGroup(t.groupId).openedAt, null);
  assert.equal(drawOpenRows(t), 0);
});

test('opening a group of 2 is refused', async () => {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  const { group } = seedGroup(t.ctx, { names: ['Ada', 'Ben'] });
  t.ctx.repo.markInvitationsSent(group.id, t.ctx.nowIso());
  assert.deepEqual(openGroup(t.ctx, group.id), { opened: false, reason: 'too-small' });
  const res = await t.adminPost(`/admin/groups/${group.id}/open`);
  assert.equal(res.statusCode, 409);
  assert.equal(t.ctx.repo.getGroup(group.id).openedAt, null);
  assert.equal(drawOpenRows(t), 0);
});

test('opening with an incomplete pairing is refused', async () => {
  const t = await setup();
  t.ctx.repo.markInvitationsSent(t.groupId, t.ctx.nowIso());
  const partial = t.ctx.repo.getAssignment(t.groupId);
  partial.delete(t.people[0].id);
  t.ctx.repo.setAssignment(t.groupId, partial, t.ctx.nowIso());
  assert.deepEqual(openGroup(t.ctx, t.groupId), { opened: false, reason: 'invalid' });
  assert.equal(t.ctx.repo.getGroup(t.groupId).openedAt, null);
});

test('opening sends one draw-open per participant with email', async () => {
  const t = await setup();
  const noEmail = t.people[4];
  t.ctx.repo.updateParticipant(noEmail.id, { email: null });
  t.ctx.repo.markInvitationsSent(t.groupId, t.ctx.nowIso());
  const res = await t.adminPost(`/admin/groups/${t.groupId}/open`);
  assert.equal(res.statusCode, 303, res.body);
  assert.equal(res.headers.location, `/admin/groups/${t.groupId}`);
  assert.ok(t.ctx.repo.getGroup(t.groupId).openedAt);
  await settle(t);
  assert.equal(drawOpenRows(t), 4);
  assert.deepEqual(t.mails.map((m) => m.to).sort(), t.people.slice(0, 4).map((p) => p.email).sort());
  assert.ok(t.logs.some((line) => line.includes('"msg":"group_opened"')));
});

test('opening invites anyone with email who was never invited, before the draw-open mail', async () => {
  const t = await setup();
  // An address added after the invitations went out is not mailed by itself.
  const late = t.people[4];
  t.db.prepare('UPDATE participants SET invited_at = NULL WHERE id = ?').run(late.id);
  t.ctx.repo.markInvitationsSent(t.groupId, t.ctx.nowIso());
  t.clock.ms += 60_000;
  assert.deepEqual(openGroup(t.ctx, t.groupId), { opened: true });
  assert.equal(t.ctx.repo.getParticipant(late.id).invitedAt, t.ctx.nowIso());
  const rows = t.db.prepare('SELECT participant_id, kind FROM outbox ORDER BY id').all();
  assert.deepEqual(rows.filter((r) => r.participant_id === late.id).map((r) => r.kind), ['invite', 'draw-open']);
  assert.equal(rows.filter((r) => r.kind === 'invite').length, 1);
  assert.equal(drawOpenRows(t), FIVE.length);
});

test('opening twice, including two overlapping posts, sends no more', async () => {
  const t = await setup();
  t.ctx.repo.markInvitationsSent(t.groupId, t.ctx.nowIso());
  t.mailer.delayMs = 20;
  const [first, second] = await Promise.all([
    t.adminPost(`/admin/groups/${t.groupId}/open`),
    t.adminPost(`/admin/groups/${t.groupId}/open`),
  ]);
  assert.deepEqual([first.statusCode, second.statusCode].sort(), [303, 409]);
  const third = await t.adminPost(`/admin/groups/${t.groupId}/open`);
  assert.equal(third.statusCode, 409);
  assert.deepEqual(openGroup(t.ctx, t.groupId), { opened: false, reason: 'already-open' });
  await settle(t);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await settle(t);
  assert.equal(drawOpenRows(t), FIVE.length);
  assert.equal(t.mails.length, FIVE.length);
});

test('opening with mail off opens the group and queues nothing', async () => {
  const t = await setup();
  t.mailer.enabled = false;
  t.ctx.repo.markInvitationsSent(t.groupId, t.ctx.nowIso());
  t.db.prepare('UPDATE participants SET invited_at = NULL').run();
  assert.deepEqual(openGroup(t.ctx, t.groupId), { opened: true });
  assert.ok(t.ctx.repo.getGroup(t.groupId).openedAt);
  assert.equal(count(t, 'SELECT count(*) AS n FROM outbox'), 0);
  assert.equal(count(t, 'SELECT count(*) AS n FROM participants WHERE invited_at IS NOT NULL'), 0);
});

test('the dashboard offers opening and arranging until the group opens', async () => {
  const t = await setup();
  const closed = await t.adminGet(`/admin/groups/${t.groupId}`);
  assert.ok(closed.body.includes(`action="/admin/groups/${t.groupId}/open"`));
  assert.ok(closed.body.includes(`href="/admin/groups/${t.groupId}/arrange"`));
  t.ctx.repo.markInvitationsSent(t.groupId, t.ctx.nowIso());
  openGroup(t.ctx, t.groupId);
  const open = await t.adminGet(`/admin/groups/${t.groupId}`);
  assert.equal(open.body.includes(`action="/admin/groups/${t.groupId}/open"`), false);
  assert.ok(open.body.includes(`href="/admin/groups/${t.groupId}/arrange"`));
});

test('with mail off the dashboard does not promise an email on opening', async () => {
  const t = await setup();
  t.mailer.enabled = false;
  const res = await t.adminGet(`/admin/groups/${t.groupId}`);
  assert.ok(res.body.includes('Na het openen kan iedereen via de eigen link trekken.'));
  assert.equal(res.body.includes('Iedereen met e-mail krijgt bericht'), false);
  assert.ok(res.body.includes('Druk eerst op &quot;De links zijn gedeeld&quot;'));
  assert.equal(res.body.includes('Verstuur eerst de uitnodigingen'), false);
});

test('opening a group that does not exist is refused as invalid', async () => {
  const t = await setup();
  assert.deepEqual(openGroup(t.ctx, 999), { opened: false, reason: 'invalid' });
  assert.equal(drawOpenRows(t), 0);
});

test('a group of 3 shows that no swap is possible and offers no swap controls', async () => {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  const { group } = seedGroup(t.ctx, { names: ['Ada', 'Ben', 'Cor'] });
  const res = await t.adminGet(`/admin/groups/${group.id}/arrange`);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('In een groep van 3 kan niemand wisselen'));
  assert.equal(res.body.includes('/swap"'), false);
  assert.equal(res.body.includes('data-arrange-bar'), false);
  assert.equal(res.body.includes('/static/js/arrange.js'), false);
  for (const name of ['Ada', 'Ben', 'Cor']) assert.ok(res.body.includes(`<span class="pair-giver">${name}</span>`));
});

test('the dashboard says to send the invitations first next to the open button', async () => {
  const t = await setup();
  const hint = 'Verstuur eerst de uitnodigingen, daarna kan het trekken open.';
  const before = await t.adminGet(`/admin/groups/${t.groupId}`);
  assert.equal(before.body.split(hint).length - 1, 1);
  const refused = await t.adminPost(`/admin/groups/${t.groupId}/open`);
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.split(hint).length - 1, 1, 'the refusal does not repeat the sentence');
  t.ctx.repo.markInvitationsSent(t.groupId, t.ctx.nowIso());
  const after = await t.adminGet(`/admin/groups/${t.groupId}`);
  assert.equal(after.body.includes(hint), false);
});

test('the arrange page keeps the live region outside the confirm bar', async () => {
  const t = await setup();
  const res = await t.adminGet(`/admin/groups/${t.groupId}/arrange`);
  const bar = /<li class="arrange-bar"[^>]*>[\s\S]*?<\/li>/.exec(res.body);
  assert.ok(bar, 'the bar is a list item inside the pairs list');
  assert.ok(/role="group" aria-label="[^"]+"/.test(bar[0]));
  assert.equal(bar[0].includes('aria-live'), false);
  assert.ok(/<p class="visually-hidden" aria-live="polite" data-live><\/p>/.test(res.body));
});

// Runs the shipped script against a page without a pairs list, which is
// enough to reach the pageshow listener it registers first.
function runArrangeScript() {
  const handlers = {};
  const reloads = [];
  const window = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    location: { reload: () => reloads.push(true) },
  };
  const document = { querySelector: () => null, documentElement: { classList: {} } };
  const source = readFileSync(new URL('../public/js/arrange.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { window, document });
  return { handlers, reloads };
}

test('arrange.js reloads a page restored from the back/forward cache', () => {
  const { handlers, reloads } = runArrangeScript();
  assert.equal(typeof handlers.pageshow, 'function');
  handlers.pageshow({ persisted: false });
  assert.equal(reloads.length, 0, 'a normal load is left alone');
  handlers.pageshow({ persisted: true });
  assert.equal(reloads.length, 1, 'a restored page, with its stale pairs and disabled buttons, is fetched again');
});
