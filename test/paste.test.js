import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAssignment } from '../src/draw/cycle.js';
import { commitAddParticipants, parsePasteList, planAddParticipants } from '../src/people.js';
import { makeTestApp, seedGroup, textOf } from './helpers.js';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');

test('parsePasteList accepts comma, semicolon, tab and name-only lines', () => {
  const text = 'Ada, ada@example.com\nBen;ben@example.com\n\nCor\tcor@example.com\n   \n  Dirk  \n';
  const { rows, errors } = parsePasteList(text);
  assert.deepEqual(rows, [
    { name: 'Ada', email: 'ada@example.com' },
    { name: 'Ben', email: 'ben@example.com' },
    { name: 'Cor', email: 'cor@example.com' },
    { name: 'Dirk', email: null },
  ]);
  assert.deepEqual(errors, []);
});

test('parsePasteList lower-cases emails and refuses a line with more than a name and an address', () => {
  const { rows } = parsePasteList('Eva; Eva.Jansen@Example.COM\r\nFem, fem@example.com, extra');
  assert.deepEqual(rows[0], { name: 'Eva', email: 'eva.jansen@example.com' });
  assert.equal(parsePasteList('Fem, fem@example.com, extra').errors[0].reason, 'extra-field');
});

test('parsePasteList ignores separators at the end of a line', () => {
  const { rows, errors } = parsePasteList('Bas Jansen, bas@example.com,\nCor;\t\nDirk, dirk@example.com ;');
  assert.deepEqual(rows, [
    { name: 'Bas Jansen', email: 'bas@example.com' },
    { name: 'Cor', email: null },
    { name: 'Dirk', email: 'dirk@example.com' },
  ]);
  assert.deepEqual(errors, []);
});

test('parsePasteList names the real problem of each skipped line', () => {
  const { rows, errors } = parsePasteList([
    'Fenna Mulder fenna@example.com',
    'gerard@example.com, Gerard',
    'Hilde, hilde@example',
    'ida@example.com',
  ].join('\n'));
  assert.deepEqual(rows, []);
  assert.deepEqual(errors.map((e) => [e.line, e.reason]), [
    [1, 'no-separator'],
    [2, 'email-first'],
    [3, 'invalid-email'],
    [4, 'no-name'],
  ]);
});

test('parsePasteList skips a second line with the same address or the same name, naming the first', () => {
  const { rows, errors } = parsePasteList([
    'Anneke de Vries, anneke@example.com',
    'Bas, bas@example.com',
    'Anneke de Vries, anneke@example.com',
    'Annie, ANNEKE@example.com',
    '  bas  ',
    'Cor, cor@',
    'Cor, cor@example.com',
  ].join('\n'));
  assert.deepEqual(rows, [
    { name: 'Anneke de Vries', email: 'anneke@example.com' },
    { name: 'Bas', email: 'bas@example.com' },
    { name: 'Cor', email: 'cor@example.com' },
  ]);
  assert.deepEqual(errors.map((e) => [e.line, e.reason, e.earlier]), [
    [3, 'duplicate-email', 1],
    [4, 'duplicate-email', 1],
    [5, 'duplicate-name', 2],
    [6, 'invalid-email', undefined],
  ]);
});

test('parsePasteList reports bad lines with their line number', () => {
  const { rows, errors } = parsePasteList('Ada, ada@example.com\n\nEva, eva@\n, x@example.com\nBen,');
  assert.deepEqual(rows, [
    { name: 'Ada', email: 'ada@example.com' },
    { name: 'Ben', email: null },
  ]);
  assert.deepEqual(errors, [
    { line: 3, text: 'Eva, eva@', reason: 'invalid-email' },
    { line: 4, text: ', x@example.com', reason: 'no-name' },
  ]);
});

test('parsePasteList treats a bare email address as a line without a name', () => {
  const { rows, errors } = parsePasteList('ada@example.com');
  assert.deepEqual(rows, []);
  assert.deepEqual(errors, [{ line: 1, text: 'ada@example.com', reason: 'no-name' }]);
});

async function setup(options) {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  const seeded = seedGroup(t.ctx, options);
  return { ...t, ...seeded, clock };
}

test('planAddParticipants in a closed group plans no insertion givers', async () => {
  const { ctx, group } = await setup({ names: ['Ada', 'Ben', 'Cor'] });
  const plan = planAddParticipants(ctx, group.id, [{ name: 'Dirk', email: null }]);
  assert.equal(typeof plan.version, 'string');
  assert.deepEqual(plan.rows, [{ name: 'Dirk', email: null, insertGiverId: null }]);
  assert.deepEqual(plan.changedGivers, []);
  assert.deepEqual(plan.duplicates, []);
});

test('planAddParticipants in an open group prefers givers who have not drawn', async () => {
  const { ctx, group, people } = await setup({ names: ['Ada', 'Ben', 'Cor', 'Dirk'], opened: true });
  const [ada, ben, cor] = people;
  for (const p of [ada, ben, cor]) ctx.repo.updateParticipant(p.id, { drawnAt: ctx.nowIso() });
  const plan = planAddParticipants(ctx, group.id, [{ name: 'Eva', email: 'eva@example.com' }]);
  assert.equal(plan.rows[0].insertGiverId, people[3].id);
  assert.deepEqual(plan.changedGivers, [people[3].id]);
});

test('commitAddParticipants in an open group invites the newcomer and tells a drawn giver', async () => {
  const { ctx, group, people } = await setup({ names: ['Ada', 'Ben', 'Cor'], opened: true });
  for (const p of people) ctx.repo.updateParticipant(p.id, { drawnAt: ctx.nowIso() });
  const plan = planAddParticipants(ctx, group.id, [{ name: 'Eva', email: 'eva@example.com' }]);
  const giver = plan.rows[0].insertGiverId;
  const { added } = commitAddParticipants(ctx, group.id, plan);
  assert.equal(added.length, 1);
  const eva = ctx.repo.getParticipant(added[0].id);
  assert.ok(eva.invitedAt);
  const map = ctx.repo.getAssignment(group.id);
  assert.equal(map.get(giver), eva.id);
  assert.ok(validateAssignment(map, [...people.map((p) => p.id), eva.id]));
  // One mail: the invitation, which says the draw is open.
  assert.equal(ctx.repo.mailStatus(eva.id).pendingCount, 1);
  const outbox = ctx.repo.mailStatus(giver).pendingCount;
  assert.equal(outbox, 1);
});

test('commitAddParticipants refuses a tampered plan', async () => {
  const { ctx, group } = await setup({ names: ['Ada', 'Ben', 'Cor'], opened: true });
  const other = seedGroup(ctx, { names: ['Gijs', 'Hans', 'Ilse'] });
  const plan = planAddParticipants(ctx, group.id, [{ name: 'Eva', email: 'eva@example.com' }]);
  const tampered = [
    { ...plan, rows: [{ ...plan.rows[0], name: '   ' }] },
    { ...plan, rows: [{ ...plan.rows[0], email: 'not-an-email' }] },
    { ...plan, rows: [{ ...plan.rows[0], insertGiverId: other.people[0].id }] },
    { ...plan, rows: [{ ...plan.rows[0], insertGiverId: null }] },
    { ...plan, rows: [] },
    { ...plan, rows: 'Eva' },
    { ...plan, version: 'something-else' },
    null,
  ];
  for (const bad of tampered) {
    const result = commitAddParticipants(ctx, group.id, bad);
    assert.ok(result.error, JSON.stringify(bad));
  }
  assert.equal(ctx.repo.listParticipants(group.id).length, 3);
  assert.equal(commitAddParticipants(ctx, group.id, plan).added.length, 1);
});

test('commitAddParticipants in a closed group builds or extends the cycle', async () => {
  const { ctx, group, people } = await setup({ names: ['Ada', 'Ben'] });
  assert.equal(ctx.repo.getAssignment(group.id).size, 0);
  const plan = planAddParticipants(ctx, group.id, [{ name: 'Cor', email: null }]);
  commitAddParticipants(ctx, group.id, plan);
  const ids = ctx.repo.listParticipants(group.id).map((p) => p.id);
  assert.equal(ids.length, 3);
  assert.ok(validateAssignment(ctx.repo.getAssignment(group.id), ids));
  const next = planAddParticipants(ctx, group.id, [{ name: 'Dirk', email: null }, { name: 'Eva', email: null }]);
  commitAddParticipants(ctx, group.id, next);
  const all = ctx.repo.listParticipants(group.id);
  assert.equal(all.length, 5);
  assert.ok(validateAssignment(ctx.repo.getAssignment(group.id), all.map((p) => p.id)));
  assert.ok(all.every((p) => !p.invitedAt || people.some((q) => q.id === p.id)));
});

test('commitAddParticipants with email off queues nothing and marks nobody invited, even in an open group', async () => {
  const { ctx, group, people } = await setup({ names: ['Ada', 'Ben', 'Cor'], opened: true });
  for (const p of people) ctx.repo.updateParticipant(p.id, { drawnAt: ctx.nowIso() });
  ctx.mailer.enabled = false;
  const plan = planAddParticipants(ctx, group.id, [{ name: 'Eva', email: 'eva@example.com' }]);
  const { added } = commitAddParticipants(ctx, group.id, plan);
  assert.equal(ctx.repo.getParticipant(added[0].id).invitedAt, null);
  for (const p of [...people, added[0]]) assert.equal(ctx.repo.mailStatus(p.id).pendingCount, 0);
});

test('commitAddParticipants invites emailed newcomers to a closed group whose invitations went out', async () => {
  const { ctx, group } = await setup({ names: ['Ada', 'Ben', 'Cor'] });
  ctx.repo.markInvitationsSent(group.id, ctx.nowIso());
  const plan = planAddParticipants(ctx, group.id, [{ name: 'Eva', email: 'eva@example.com' }, { name: 'Fem', email: null }]);
  const { added } = commitAddParticipants(ctx, group.id, plan);
  const [eva, fem] = added.map((p) => ctx.repo.getParticipant(p.id));
  assert.ok(eva.invitedAt);
  assert.equal(ctx.repo.mailStatus(eva.id).invite, 'queued');
  assert.equal(ctx.repo.mailStatus(eva.id).pendingCount, 1);
  assert.equal(fem.invitedAt, null);
  assert.equal(ctx.repo.mailStatus(fem.id).pendingCount, 0);
});

test('commitAddParticipants leaves newcomers to a closed group uninvited before invitations went out', async () => {
  const { ctx, group } = await setup({ names: ['Ada', 'Ben', 'Cor'] });
  const plan = planAddParticipants(ctx, group.id, [{ name: 'Eva', email: 'eva@example.com' }]);
  const { added } = commitAddParticipants(ctx, group.id, plan);
  assert.equal(ctx.repo.getParticipant(added[0].id).invitedAt, null);
  assert.equal(ctx.repo.mailStatus(added[0].id).pendingCount, 0);
});

test('planAddParticipants flags an email already in a group of the event', async () => {
  const { ctx, group } = await setup({ names: ['Ada', 'Ben', 'Cor'] });
  const plan = planAddParticipants(ctx, group.id, [
    { name: 'Eva', email: 'eva@example.com' },
    { name: 'Ada Two', email: 'ada@example.com' },
  ]);
  assert.deepEqual(plan.duplicates, [{ row: 1, otherGroupName: 'Monday' }]);
});

test('a paste with the same person twice adds one and reports the second line', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor'] });
  const text = 'Anneke, anneke@example.com\nAnneke, anneke@example.com';
  const check = await t.adminPost(`/admin/groups/${t.group.id}/participants`, { text });
  assert.equal(check.statusCode, 200);
  const page = textOf(check.body);
  assert.match(page, /regel 2: Anneke, anneke@example\.com \(dit e-mailadres staat al op regel 1\)/);
  assert.match(page, /Ja, voeg deze 1 toe/);
  const form = /<form[^>]*>\s*<input type="hidden" name="confirm" value="1">[\s\S]*?<\/form>/.exec(check.body)[0];
  const value = (name) => /value="([^"]*)"/.exec(new RegExp(`name="${name}"[^>]*`).exec(form)[0])[1].replace(/&quot;/g, '"');
  const plan = value('plan');
  const formToken = value('formToken');
  const res = await t.adminPost(`/admin/groups/${t.group.id}/participants`, { confirm: '1', plan, formToken });
  assert.equal(res.statusCode, 303);
  const names = t.ctx.repo.listParticipants(t.group.id).map((p) => p.name);
  assert.deepEqual(names.filter((n) => n === 'Anneke'), ['Anneke']);
});
