import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAssignment } from '../src/draw/cycle.js';
import { t as tr } from '../src/i18n/index.js';
import { drawFor, planRemoveParticipant } from '../src/people.js';
import { makeTestApp, seedGroup } from './helpers.js';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');
const SIX = ['Ada', 'Ben', 'Cor', 'Dirk', 'Eva', 'Fem'];

async function setup(seed) {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  const seeded = seedGroup(t.ctx, seed);
  return { ...t, clock, ...seeded, groupId: seeded.group.id };
}

function unescapeHtml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function hidden(body, name) {
  const match = new RegExp(`name="${name}" value="([^"]*)"`).exec(body);
  assert.ok(match, `page carries ${name}`);
  return unescapeHtml(match[1]);
}

async function settle(t) {
  await new Promise((resolve) => setImmediate(resolve));
  await t.drain();
  await t.drain();
}

const outbox = (t) => t.db.prepare('SELECT participant_id, kind, manual, status FROM outbox ORDER BY id').all();
const kindsFor = (t, id) => outbox(t).filter((r) => r.participant_id === id).map((r) => r.kind);
const giverOf = (map, id) => [...map].find(([, r]) => r === id)[0];
const markDrawn = (t, ids) => ids.forEach((id) => t.ctx.repo.updateParticipant(id, { drawnAt: t.ctx.nowIso() }));

// Opens the remove preview and confirms it as shown.
async function removeVia(t, id) {
  const preview = await t.adminGet(`/admin/participants/${id}/remove`);
  assert.equal(preview.statusCode, 200, preview.body);
  const form = { plan: hidden(preview.body, 'plan'), group: hidden(preview.body, 'group') };
  const res = await t.adminPost(`/admin/participants/${id}/remove`, form);
  return { preview, form, res };
}

function changedGivers(before, after, removed) {
  return [...after.keys()].filter((g) => g !== removed && before.get(g) !== after.get(g)).sort((a, b) => a - b);
}

test('removing from an open group of 6 changes exactly the previewed giver, who is mailed after drawing', async () => {
  const t = await setup({ names: SIX, opened: true });
  const before = t.ctx.repo.getAssignment(t.groupId);
  const dropout = t.people[0];
  const giver = t.people.find((p) => p.id === giverOf(before, dropout.id));
  markDrawn(t, [giver.id]);

  const plan = planRemoveParticipant(t.ctx, dropout.id);
  assert.deepEqual(plan.changedGivers, [giver.id]);
  const { preview, res } = await removeVia(t, dropout.id);
  assert.ok(preview.body.includes(tr('nl', 'admin.paste.change', { giver: giver.name, receiver: t.people.find((p) => p.id === before.get(dropout.id)).name })));
  assert.equal(res.statusCode, 303, res.body);
  assert.equal(res.headers.location, `/admin/groups/${t.groupId}`);

  const after = t.ctx.repo.getAssignment(t.groupId);
  const remaining = t.ctx.repo.listParticipants(t.groupId).map((p) => p.id);
  assert.equal(remaining.includes(dropout.id), false);
  assert.ok(validateAssignment(after, remaining));
  assert.deepEqual(changedGivers(before, after, dropout.id), [giver.id]);
  assert.equal(after.get(giver.id), before.get(dropout.id));
  assert.deepEqual(outbox(t).map((r) => [r.participant_id, r.kind]), [[giver.id, 'reassigned']]);

  await settle(t);
  assert.equal(t.mails.length, 1);
  assert.equal(t.mails[0].to, giver.email);
  assert.equal(t.mails[0].text.includes(dropout.name), false, 'the mail never names the dropout');
});

test('removing in an open group sends nothing when the changed giver has not drawn', async () => {
  const t = await setup({ names: SIX, opened: true });
  const dropout = t.people[2];
  const { res } = await removeVia(t, dropout.id);
  assert.equal(res.statusCode, 303);
  assert.deepEqual(outbox(t), []);
});

test('a 2-loop removal changes exactly the previewed givers', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor', 'Dirk', 'Eva'], opened: true });
  const [ada, ben, cor, dirk, eva] = t.people;
  t.ctx.repo.setAssignment(t.groupId, new Map([
    [ada.id, ben.id], [ben.id, ada.id], [cor.id, dirk.id], [dirk.id, eva.id], [eva.id, cor.id],
  ]), t.ctx.nowIso());
  // Only Eva has not drawn, so Ben is placed in front of her receiver.
  markDrawn(t, [ben.id, cor.id, dirk.id]);
  const before = t.ctx.repo.getAssignment(t.groupId);

  const { preview, res } = await removeVia(t, ada.id);
  assert.ok(preview.body.includes(tr('nl', 'admin.paste.change', { giver: ben.name, receiver: cor.name })));
  assert.ok(preview.body.includes(tr('nl', 'admin.paste.change', { giver: eva.name, receiver: ben.name })));
  assert.equal(res.statusCode, 303, res.body);
  const after = t.ctx.repo.getAssignment(t.groupId);
  assert.deepEqual(changedGivers(before, after, ada.id), [ben.id, eva.id].sort((a, b) => a - b));
  assert.ok(validateAssignment(after, [ben.id, cor.id, dirk.id, eva.id]));
  assert.deepEqual(outbox(t).map((r) => [r.participant_id, r.kind]), [[ben.id, 'reassigned']]);
});

test('removing from an open group of 3 is refused', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor'], opened: true });
  const plan = planRemoveParticipant(t.ctx, t.people[0].id);
  assert.equal(plan.refused, 'too-small');
  const preview = await t.adminGet(`/admin/participants/${t.people[0].id}/remove`);
  assert.equal(preview.statusCode, 200);
  assert.ok(preview.body.includes(tr('nl', 'admin.remove.tooSmall')));
  assert.equal(preview.body.includes('name="plan"'), false);
  const forged = JSON.stringify({ version: plan.version, map: null });
  const res = await t.adminPost(`/admin/participants/${t.people[0].id}/remove`, { plan: forged, group: String(t.groupId) });
  assert.equal(res.statusCode, 409);
  assert.equal(t.ctx.repo.listParticipants(t.groupId).length, 3);
});

test('removing from closed groups of 3 and of 2 succeeds and clears the assignment', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor'] });
  assert.equal(t.ctx.repo.getAssignment(t.groupId).size, 3);
  const three = await removeVia(t, t.people[0].id);
  assert.equal(three.res.statusCode, 303, three.res.body);
  assert.equal(t.ctx.repo.listParticipants(t.groupId).length, 2);
  assert.equal(t.ctx.repo.getAssignment(t.groupId).size, 0);

  const two = await removeVia(t, t.people[1].id);
  assert.equal(two.res.statusCode, 303, two.res.body);
  assert.deepEqual(t.ctx.repo.listParticipants(t.groupId).map((p) => p.id), [t.people[2].id]);
  assert.equal(t.ctx.repo.getAssignment(t.groupId).size, 0);
  assert.deepEqual(outbox(t), []);
});

test('removing from a closed group of 5 keeps a valid assignment without mail', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor', 'Dirk', 'Eva'] });
  const { res } = await removeVia(t, t.people[1].id);
  assert.equal(res.statusCode, 303);
  const remaining = t.ctx.repo.listParticipants(t.groupId).map((p) => p.id);
  assert.ok(validateAssignment(t.ctx.repo.getAssignment(t.groupId), remaining));
  assert.deepEqual(outbox(t), []);
});

test('a remove confirm built before a giver drew is refused as stale, and so is a repeated one', async () => {
  const t = await setup({ names: SIX, opened: true });
  const dropout = t.people[0];
  const preview = await t.adminGet(`/admin/participants/${dropout.id}/remove`);
  const form = { plan: hidden(preview.body, 'plan'), group: hidden(preview.body, 'group') };
  drawFor(t.ctx, t.people[3].id);
  const stale = await t.adminPost(`/admin/participants/${dropout.id}/remove`, form);
  assert.equal(stale.statusCode, 409);
  assert.ok(stale.body.includes(tr('nl', 'admin.remove.stale')));
  assert.equal(t.ctx.repo.listParticipants(t.groupId).length, 6);

  const fresh = await removeVia(t, dropout.id);
  assert.equal(fresh.res.statusCode, 303);
  const again = await t.adminPost(`/admin/participants/${dropout.id}/remove`, fresh.form);
  assert.equal(again.statusCode, 409);
  assert.ok(again.body.includes(tr('nl', 'admin.remove.stale')));
  assert.ok(again.body.includes(`href="/admin/groups/${t.groupId}"`));
  assert.equal(t.ctx.repo.listParticipants(t.groupId).length, 5);
});

test('a tampered remove plan is refused', async () => {
  const t = await setup({ names: SIX, opened: true });
  const dropout = t.people[0];
  const preview = await t.adminGet(`/admin/participants/${dropout.id}/remove`);
  const plan = JSON.parse(hidden(preview.body, 'plan'));
  // The previewed cycle run backwards: still one valid cycle over the rest,
  // and with five people never the same as the preview.
  const reversed = plan.map.map(([giver, receiver]) => [receiver, giver]);
  assert.equal(plan.map.length, 5);
  const bad = [
    { ...plan, map: reversed },
    { ...plan, map: null },
    { ...plan, map: 'x' },
    { version: plan.version },
    'not json',
  ];
  for (const value of bad) {
    const res = await t.adminPost(`/admin/participants/${dropout.id}/remove`, {
      plan: typeof value === 'string' ? value : JSON.stringify(value), group: String(t.groupId),
    });
    assert.ok(res.statusCode === 400 || res.statusCode === 409, `${res.statusCode} for ${JSON.stringify(value)}`);
  }
  assert.equal(t.ctx.repo.listParticipants(t.groupId).length, 6);
});

test('a removed participant takes their queued mail along and nothing is sent to them', async () => {
  const t = await setup({ names: SIX });
  const dropout = t.people[0];
  t.ctx.repo.enqueue(dropout.id, 'invite', t.ctx.nowIso());
  const { res } = await removeVia(t, dropout.id);
  assert.equal(res.statusCode, 303);
  assert.deepEqual(outbox(t), []);
  await settle(t);
  assert.deepEqual(t.mails, []);
});

test('a late joiner in an open group where everyone drew changes the previewed giver', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor', 'Dirk'], opened: true });
  markDrawn(t, t.people.map((p) => p.id));
  const res = await t.adminPost(`/admin/groups/${t.groupId}/participants`, { text: 'Gijs, gijs@example.com' });
  assert.equal(res.statusCode, 200);
  const plan = JSON.parse(hidden(res.body, 'plan'));
  const giver = t.people.find((p) => p.id === plan.rows[0].insertGiverId);
  assert.ok(res.body.includes(tr('nl', 'admin.paste.change', { giver: giver.name, receiver: 'Gijs' })));
  const before = t.ctx.repo.getAssignment(t.groupId);

  const confirm = await t.adminPost(`/admin/groups/${t.groupId}/participants`, { confirm: '1', plan: JSON.stringify(plan) });
  assert.equal(confirm.statusCode, 303, confirm.body);
  const gijs = t.ctx.repo.listParticipants(t.groupId).find((p) => p.name === 'Gijs');
  const after = t.ctx.repo.getAssignment(t.groupId);
  assert.deepEqual(changedGivers(before, after, gijs.id), [giver.id]);
  assert.equal(after.get(giver.id), gijs.id);
  assert.deepEqual(kindsFor(t, giver.id), ['reassigned']);
  assert.deepEqual(kindsFor(t, gijs.id).sort(), ['draw-open', 'invite']);
});

test('regenerating a link makes the old one 404 and the new one work', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor'] });
  const ada = t.people[0];
  const refused = await t.adminPost(`/admin/participants/${ada.id}/regenerate-link`, {});
  assert.equal(refused.statusCode, 400);
  assert.equal(t.ctx.repo.getParticipant(ada.id).token, ada.token);

  const res = await t.adminPost(`/admin/participants/${ada.id}/regenerate-link`, { confirm: '1' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location.includes(ada.token), false);
  const token = t.ctx.repo.getParticipant(ada.id).token;
  assert.notEqual(token, ada.token);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await t.app.inject({ url: `/p/${ada.token}` })).statusCode, 404);
  assert.equal((await t.app.inject({ url: `/p/${token}` })).statusCode, 200);
  assert.equal(t.logs.join('').includes(token), false);
});

test('remind now queues a manual remind-draw that does not count toward the automatic ones', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor'], opened: true });
  const ada = t.people[0];
  const res = await t.adminPost(`/admin/participants/${ada.id}/remind`);
  assert.equal(res.statusCode, 303);
  assert.deepEqual(outbox(t).map((r) => [r.participant_id, r.kind, r.manual]), [[ada.id, 'remind-draw', 1]]);
  assert.equal(t.ctx.repo.reminderHistory(ada.id, 'remind-draw').count, 0);
  await settle(t);
  assert.deepEqual(t.mails.map((m) => m.to), [ada.email]);

  markDrawn(t, [ada.id]);
  const nothing = await t.adminPost(`/admin/participants/${ada.id}/remind`);
  assert.equal(nothing.statusCode, 303);
  assert.equal(outbox(t).length, 1);
  const page = await t.adminGet(nothing.headers.location);
  assert.ok(page.body.includes(tr('nl', 'admin.person.done.nothing-to-remind')));
});

test('resend failed mail sends the failed kind again', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor'] });
  const ada = t.people[0];
  const id = t.ctx.repo.enqueue(ada.id, 'invite', t.ctx.nowIso());
  t.ctx.repo.claimDue(t.ctx.nowIso(), 10);
  t.ctx.repo.markFailed(id, 'smtp-550', null, t.ctx.nowIso());
  const dashboard = await t.adminGet(`/admin/groups/${t.groupId}`);
  assert.ok(dashboard.body.includes(`action="/admin/participants/${ada.id}/resend-failed"`));
  assert.equal(dashboard.body.includes(`action="/admin/participants/${t.people[1].id}/resend-failed"`), false);

  const res = await t.adminPost(`/admin/participants/${ada.id}/resend-failed`, { back: 'group' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/admin/groups/${t.groupId}?done=failed-requeued`);
  const back = await t.adminGet(res.headers.location);
  assert.ok(back.body.includes(tr('nl', 'admin.person.done.failed-requeued')));
  await settle(t);
  assert.equal(t.mails.length, 1);
  assert.equal(t.mails[0].to, ada.email);
  assert.deepEqual(outbox(t).map((r) => [r.kind, r.status]), [['invite', 'sent']]);
});

test('the dashboard sends all given-up mail of the group again with one button', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor', 'Dirk'] });
  const [ada, ben, cor] = t.people;
  const action = `action="/admin/groups/${t.groupId}/resend-failed"`;
  assert.equal((await t.adminGet(`/admin/groups/${t.groupId}`)).body.includes(action), false, 'hidden without failures');

  const giveUp = (id, kind) => {
    const row = t.ctx.repo.enqueue(id, kind, t.ctx.nowIso());
    t.ctx.repo.claimDue(t.ctx.nowIso(), 10);
    t.ctx.repo.markFailed(row, 'smtp-550', null, t.ctx.nowIso());
  };
  giveUp(ada.id, 'invite');
  giveUp(ada.id, 'remind-wishes');
  giveUp(ben.id, 'invite');
  // Still being retried: it goes out by itself and is left alone.
  const retrying = t.ctx.repo.enqueue(cor.id, 'invite', t.ctx.nowIso());
  t.ctx.repo.claimDue(t.ctx.nowIso(), 10);
  t.ctx.repo.markFailed(retrying, 'smtp-421', new Date(t.clock.ms + 60 * 60_000).toISOString(), t.ctx.nowIso());
  // Another group's failure stays as it is.
  const other = seedGroup(t.ctx, { names: ['Eva', 'Fem', 'Gijs'] }).people[0];
  giveUp(other.id, 'invite');

  const dashboard = await t.adminGet(`/admin/groups/${t.groupId}`);
  assert.ok(dashboard.body.includes(action));
  assert.ok(dashboard.body.includes(tr('nl', 'admin.failure.groupCount', { count: 3 })));
  const en = await t.adminGet(`/admin/groups/${t.groupId}`, { cookie: `${t.adminCookie()}; giftdraw_lang=en` });
  assert.ok(en.body.includes(tr('en', 'admin.failure.resendAll')));

  const res = await t.adminPost(`/admin/groups/${t.groupId}/resend-failed`);
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/admin/groups/${t.groupId}?done=all-requeued`);
  const rows = t.db.prepare('SELECT participant_id, status, attempts, error_code FROM outbox ORDER BY id').all();
  assert.deepEqual(rows.map((r) => [r.participant_id, r.status, r.attempts, r.error_code]), [
    [ada.id, 'pending', 0, null],
    [ada.id, 'pending', 0, null],
    [ben.id, 'pending', 0, null],
    [cor.id, 'pending', 1, 'smtp-421'],
    [other.id, 'gaveup', 1, 'smtp-550'],
  ]);
  const back = await t.adminGet(res.headers.location);
  assert.ok(back.body.includes(tr('nl', 'admin.person.done.all-requeued')));
  assert.equal(back.body.includes(action), false);
  await settle(t);
  // The wishes reminder still applies, so all three go out.
  assert.deepEqual(t.mails.map((m) => m.to).sort(), [ada.email, ada.email, ben.email].sort());

  const none = await t.adminPost(`/admin/groups/${t.groupId}/resend-failed`);
  assert.equal(none.headers.location, `/admin/groups/${t.groupId}?done=no-failure`);
  t.mailer.enabled = false;
  const off = await t.adminPost(`/admin/groups/${t.groupId}/resend-failed`);
  assert.equal(off.headers.location, `/admin/groups/${t.groupId}?done=mail-off`);
});

test('send all again resends only the latest given-up mail per person and kind', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor', 'Dirk'] });
  const [ada, ben, cor, dirk] = t.people;
  const action = `action="/admin/groups/${t.groupId}/resend-failed"`;
  const giveUp = (id, kind, code = 'smtp-550') => {
    const row = t.ctx.repo.enqueue(id, kind, t.ctx.nowIso());
    t.ctx.repo.claimDue(t.ctx.nowIso(), 10);
    t.ctx.repo.markFailed(row, code, null, t.ctx.nowIso());
    return row;
  };
  // Ada's invite gave up, then a newer one went out.
  giveUp(ada.id, 'invite');
  const resent = t.ctx.repo.enqueue(ada.id, 'invite', t.ctx.nowIso());
  t.ctx.repo.claimDue(t.ctx.nowIso(), 10);
  t.ctx.repo.markSent(resent, t.ctx.nowIso());
  // Ben's invite gave up twice: one mail is enough.
  giveUp(ben.id, 'invite');
  const benLatest = giveUp(ben.id, 'invite');
  // Skips that would only give up again.
  for (const code of ['no-email', 'no-receiver', 'no-participant', 'no-group', 'stale-reminder']) {
    giveUp(cor.id, 'remind-wishes', code);
  }
  giveUp(dirk.id, 'reassigned', 'no-receiver');

  const dashboard = await t.adminGet(`/admin/groups/${t.groupId}`);
  assert.ok(dashboard.body.includes(tr('nl', 'admin.failure.groupCount', { count: 1 })));
  for (const p of [ada, cor, dirk]) {
    assert.equal(dashboard.body.includes(`action="/admin/participants/${p.id}/resend-failed"`), false, p.name);
    assert.equal(t.ctx.repo.mailStatus(p.id).lastFailure, null, p.name);
    assert.equal(t.ctx.repo.requeueLastFailed(p.id, t.ctx.nowIso()), false, p.name);
  }

  const res = await t.adminPost(`/admin/groups/${t.groupId}/resend-failed`);
  assert.equal(res.headers.location, `/admin/groups/${t.groupId}?done=all-requeued`);
  const pending = t.db.prepare(`SELECT id FROM outbox WHERE status = 'pending'`).all();
  assert.deepEqual(pending.map((r) => r.id), [benLatest]);
  await settle(t);
  assert.deepEqual(t.mails.map((m) => m.to), [ben.email]);
  assert.equal((await t.adminGet(`/admin/groups/${t.groupId}`)).body.includes(action), false);
  assert.equal(t.ctx.repo.countGivenUp(t.groupId), 0);
});

test('the send all button stays hidden when only permanent skips gave up', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor'] });
  const row = t.ctx.repo.enqueue(t.people[0].id, 'reassigned', t.ctx.nowIso());
  t.ctx.repo.claimDue(t.ctx.nowIso(), 10);
  t.ctx.repo.markFailed(row, 'no-receiver', null, t.ctx.nowIso());
  assert.equal(t.ctx.repo.countGivenUp(t.groupId), 0);
  const dashboard = await t.adminGet(`/admin/groups/${t.groupId}`);
  assert.equal(dashboard.body.includes(`action="/admin/groups/${t.groupId}/resend-failed"`), false);
  const none = await t.adminPost(`/admin/groups/${t.groupId}/resend-failed`);
  assert.equal(none.headers.location, `/admin/groups/${t.groupId}?done=no-failure`);
});

test('send again from the dashboard reports nothing to send and mail off on the dashboard', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor'] });
  const ada = t.people[0];
  const none = await t.adminPost(`/admin/participants/${ada.id}/resend-failed`, { back: 'group' });
  assert.equal(none.headers.location, `/admin/groups/${t.groupId}?done=no-failure`);
  const page = await t.adminGet(none.headers.location);
  assert.ok(page.body.includes(tr('nl', 'admin.person.done.no-failure')));

  t.mailer.enabled = false;
  const off = await t.adminPost(`/admin/participants/${ada.id}/resend-failed`, { back: 'group' });
  assert.equal(off.headers.location, `/admin/groups/${t.groupId}?done=mail-off`);
  assert.ok((await t.adminGet(off.headers.location)).body.includes(tr('nl', 'admin.person.done.mail-off')));

  // Unknown outcomes in the query show nothing.
  const odd = await t.adminGet(`/admin/groups/${t.groupId}?done=%3Cb%3E`);
  assert.equal(odd.statusCode, 200);
  assert.equal(odd.body.includes('role="status"'), false);
});

test('remind now refuses someone not invited yet and the page explains why', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor'], invited: false });
  const ada = t.people[0];
  const page = await t.adminGet(`/admin/participants/${ada.id}`);
  assert.equal(page.body.includes(`action="/admin/participants/${ada.id}/remind"`), false);
  assert.ok(page.body.includes(tr('nl', 'admin.person.mail.notInvited')));

  const res = await t.adminPost(`/admin/participants/${ada.id}/remind`);
  assert.equal(res.headers.location, `/admin/participants/${ada.id}?done=not-invited`);
  assert.deepEqual(outbox(t), []);
  assert.ok((await t.adminGet(res.headers.location)).body.includes(tr('nl', 'admin.person.done.not-invited')));
});

test('resend invite queues an invitation and marks the participant invited', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor'], invited: false });
  const ada = t.people[0];
  const res = await t.adminPost(`/admin/participants/${ada.id}/resend-invite`);
  assert.equal(res.statusCode, 303);
  assert.deepEqual(kindsFor(t, ada.id), ['invite']);
  assert.ok(t.ctx.repo.getParticipant(ada.id).invitedAt);
});

test('a double tap on remind now queues one reminder and says the second is already on its way', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor'], opened: true });
  const ada = t.people[0];
  // A slow send keeps the first row in the outbox while the second tap lands.
  t.mailer.delayMs = 200;
  const first = await t.adminPost(`/admin/participants/${ada.id}/remind`);
  const second = await t.adminPost(`/admin/participants/${ada.id}/remind`);
  assert.equal(first.headers.location, `/admin/participants/${ada.id}?done=remind-queued`);
  assert.equal(second.headers.location, `/admin/participants/${ada.id}?done=already-queued`);
  assert.deepEqual(kindsFor(t, ada.id), ['remind-draw']);
  const page = await t.adminGet(second.headers.location);
  assert.ok(page.body.includes(tr('nl', 'admin.person.done.already-queued')));
  const en = await t.adminGet(second.headers.location, { cookie: `${t.adminCookie()}; giftdraw_lang=en` });
  assert.ok(en.body.includes(tr('en', 'admin.person.done.already-queued')));
  await settle(t);
  assert.equal(t.mails.length, 1);
  // Once the first has gone, a new press is a new reminder.
  const later = await t.adminPost(`/admin/participants/${ada.id}/remind`);
  assert.equal(later.headers.location, `/admin/participants/${ada.id}?done=remind-queued`);
});

test('a double tap on resend invite queues one invitation, also from the dashboard', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor'], invited: false });
  const ada = t.people[0];
  t.mailer.delayMs = 200;
  const first = await t.adminPost(`/admin/participants/${ada.id}/resend-invite`);
  const second = await t.adminPost(`/admin/participants/${ada.id}/resend-invite`, { back: 'group' });
  assert.equal(first.headers.location, `/admin/participants/${ada.id}?done=invite-queued`);
  assert.equal(second.headers.location, `/admin/groups/${t.groupId}?done=already-queued`);
  assert.deepEqual(kindsFor(t, ada.id), ['invite']);
  const dashboard = await t.adminGet(second.headers.location);
  assert.ok(dashboard.body.includes(tr('nl', 'admin.person.done.already-queued')));
  await settle(t);
  assert.equal(t.mails.length, 1);
});

test('with email off the mail actions queue nothing', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor'], opened: true, invited: false });
  t.mailer.enabled = false;
  const ada = t.people[0];
  for (const action of ['resend-invite', 'remind', 'resend-failed']) {
    const res = await t.adminPost(`/admin/participants/${ada.id}/${action}`);
    assert.equal(res.statusCode, 303, action);
  }
  assert.deepEqual(outbox(t), []);
  assert.equal(t.ctx.repo.getParticipant(ada.id).invitedAt, null);
});

test('the participant page shows the full link to copy and the actions', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor'] });
  const ada = t.people[0];
  const dashboard = await t.adminGet(`/admin/groups/${t.groupId}`);
  assert.ok(dashboard.body.includes(`href="/admin/participants/${ada.id}"`));
  const res = await t.adminGet(`/admin/participants/${ada.id}`);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes(`value="https://gifts.example.com/p/${ada.token}"`));
  assert.ok(res.body.includes('readonly'));
  assert.ok(res.body.includes('/static/js/copy-link.js'));
  for (const action of ['regenerate-link', 'resend-invite', 'remind']) {
    assert.ok(res.body.includes(`action="/admin/participants/${ada.id}/${action}"`), action);
  }
  assert.ok(res.body.includes(`href="/admin/participants/${ada.id}/remove"`));
  assert.equal(res.body.includes('resend-failed'), false);
  assert.equal((await t.adminGet('/admin/participants/999999')).statusCode, 404);
});

test('editing a participant validates name, email and language and sends nothing', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor'] });
  const ada = t.people[0];
  const url = `/admin/participants/${ada.id}`;
  for (const form of [
    { name: '  ', email: '', language: 'nl' },
    { name: 'Ada', email: 'not-an-email', language: 'nl' },
    { name: 'Ada', email: '', language: 'de' },
  ]) {
    const res = await t.adminPost(url, form);
    assert.equal(res.statusCode, 400, JSON.stringify(form));
  }
  assert.deepEqual(t.ctx.repo.getParticipant(ada.id), ada);

  const res = await t.adminPost(url, { name: ' Ada Jansen ', email: 'Ada.J@Example.com', language: 'en' });
  assert.equal(res.statusCode, 303);
  const saved = t.ctx.repo.getParticipant(ada.id);
  assert.equal(saved.name, 'Ada Jansen');
  assert.equal(saved.email, 'ada.j@example.com');
  assert.equal(saved.language, 'en');
  assert.deepEqual(outbox(t), []);

  const cleared = await t.adminPost(url, { name: 'Ada Jansen', email: '', language: 'en' });
  assert.equal(cleared.statusCode, 303);
  assert.equal(t.ctx.repo.getParticipant(ada.id).email, null);
});

test('editing to an email known elsewhere in the event warns before saving', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor'] });
  const ada = t.people[0];
  const url = `/admin/participants/${ada.id}`;
  const warn = await t.adminPost(url, { name: 'Ada', email: 'ben@example.com', language: 'nl' });
  assert.equal(warn.statusCode, 200);
  assert.ok(warn.body.includes(tr('nl', 'admin.paste.duplicate', { email: 'ben@example.com', group: 'Monday' })));
  assert.equal(t.ctx.repo.getParticipant(ada.id).email, 'ada@example.com');
  const res = await t.adminPost(url, { name: 'Ada', email: 'ben@example.com', language: 'nl', confirmDuplicate: '1' });
  assert.equal(res.statusCode, 303);
  assert.equal(t.ctx.repo.getParticipant(ada.id).email, 'ben@example.com');
});

test('the participant routes need an organiser session', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor'] });
  const ada = t.people[0];
  const remove = await t.post(`/admin/participants/${ada.id}/remove`, { plan: '{}', group: String(t.groupId) });
  const regenerate = await t.post(`/admin/participants/${ada.id}/regenerate-link`, { confirm: '1' });
  const page = await t.app.inject({ url: `/admin/participants/${ada.id}` });
  for (const res of [remove, regenerate, page]) assert.ok([302, 303, 401, 403].includes(res.statusCode), String(res.statusCode));
  assert.equal(page.body.includes(ada.token), false);
  assert.deepEqual(t.ctx.repo.getParticipant(ada.id), ada);
});
