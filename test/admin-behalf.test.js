import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t as tr, themeText } from '../src/i18n/index.js';
import { commitRemoveParticipant, planRemoveParticipant, saveWishes } from '../src/people.js';
import { makeTestApp, seedGroup } from './helpers.js';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');
const MINUTE = 60_000;

async function setup(seed) {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  const seeded = seedGroup(t.ctx, seed);
  return { ...t, clock, ...seeded, groupId: seeded.group.id };
}

// Ada has no email, as in the first real groups; the others do.
async function withNoEmailAda(seed) {
  const t = await setup(seed);
  t.ctx.repo.updateParticipant(t.people[0].id, { email: null, invitedAt: null });
  return { ...t, ada: t.ctx.repo.getParticipant(t.people[0].id) };
}

const receiverOf = (t, id) => t.ctx.repo.getParticipant(t.ctx.repo.getParticipant(id).receiverId);

test('the participant page links the on-behalf actions, emphasised for someone without email', async () => {
  const t = await withNoEmailAda({ names: ['Ada', 'Ben', 'Cor'], opened: true });
  const page = await t.adminGet(`/admin/participants/${t.ada.id}`);
  assert.equal(page.statusCode, 200);
  assert.ok(page.body.includes(`href="/admin/participants/${t.ada.id}/about"`));
  assert.ok(page.body.includes(`action="/admin/participants/${t.ada.id}/draw"`));
  assert.ok(page.body.includes(`src="/admin/participants/${t.ada.id}/qr"`));
  assert.ok(page.body.includes('class="panel behalf emphasis"'));

  const ben = await t.adminGet(`/admin/participants/${t.people[1].id}`);
  assert.ok(ben.body.includes(`href="/admin/participants/${t.people[1].id}/about"`));
  assert.ok(ben.body.includes('class="panel behalf"'));
});

test('the organiser fills in wishes on behalf and the dashboard shows them filled in', async () => {
  const t = await withNoEmailAda({ names: ['Ada', 'Ben', 'Cor'] });
  const form = await t.adminGet(`/admin/participants/${t.ada.id}/about`);
  assert.equal(form.statusCode, 200);
  assert.ok(form.body.includes(`action="/admin/participants/${t.ada.id}/about"`));
  assert.ok(form.body.includes('name="hobbies"'));
  assert.ok(form.body.includes('/static/css/participant.css'));
  assert.equal(form.body.includes(`/p/${t.ada.token}`), false);
  assert.equal(form.body.includes('name="lang"'), false);

  const before = await t.adminGet(`/admin/groups/${t.groupId}`);
  const res = await t.adminPost(`/admin/participants/${t.ada.id}/about`, { hobbies: 'gardening', likes: ['tea'] });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/admin/participants/${t.ada.id}?done=wishes-saved`);
  const saved = t.ctx.repo.getParticipant(t.ada.id);
  assert.equal(saved.wishes.hobbies, 'gardening');
  assert.deepEqual(saved.wishes.likes, ['tea']);

  const yes = tr('nl', 'admin.status.yes');
  const count = (body) => body.split(`>${yes}<`).length - 1;
  const after = await t.adminGet(`/admin/groups/${t.groupId}`);
  assert.equal(count(after.body), count(before.body) + 1);
  const done = await t.adminGet(res.headers.location);
  assert.ok(done.body.includes(tr('nl', 'admin.person.done.wishes-saved')));
  assert.equal(t.logs.some((line) => line.includes('gardening')), false);
});

test('a wish save on behalf logs the group, not the participant', async () => {
  const t = await withNoEmailAda({ names: ['Ada', 'Ben', 'Cor'] });
  await t.adminPost(`/admin/participants/${t.ada.id}/about`, { hobbies: 'gardening' });
  const line = t.logs.map((l) => JSON.parse(l)).find((l) => l.msg === 'wishes_saved_on_behalf');
  assert.equal(line.group_id, t.groupId);
  assert.ok(!Object.hasOwn(line, 'participant_id'));
});

test('drawing on behalf sets drawnAt and reveals the receiver with the participant reveal', async () => {
  const t = await withNoEmailAda({ names: ['Ada', 'Ben', 'Cor'], opened: true });
  const receiver = receiverOf(t, t.ada.id);
  const res = await t.adminPost(`/admin/participants/${t.ada.id}/draw`);
  assert.equal(res.statusCode, 200);
  assert.ok(t.ctx.repo.getParticipant(t.ada.id).drawnAt);
  assert.ok(res.body.includes(`<span class="slip-name">${receiver.name}</span>`));
  assert.ok(res.body.includes('data-reveal'));
  assert.ok(res.body.includes('/static/js/reveal.js'));
  assert.ok(res.body.includes('/static/css/participant.css'));
  const editWishes = tr('nl', 'admin.behalf.editWishes', { name: 'Ada' });
  const [first, ...rest] = editWishes.split(' ');
  assert.ok(res.body.includes(`href="/admin/participants/${t.ada.id}/about"><span class="nowrap"><svg class="icon icon-pencil"`));
  assert.ok(res.body.includes(`</svg>${first}</span> ${rest.join(' ')}</a>`));
  assert.equal(res.body.includes(tr('nl', 'result.edit')), false);
  assert.equal(res.body.includes(`/p/${t.ada.token}`), false);

  // A second time shows the result without the reveal and keeps the first date.
  const firstDrawn = t.ctx.repo.getParticipant(t.ada.id).drawnAt;
  t.clock.ms += MINUTE;
  const again = await t.adminPost(`/admin/participants/${t.ada.id}/draw`);
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.includes('data-reveal'), false);
  assert.ok(again.body.includes(receiver.name));
  assert.equal(t.ctx.repo.getParticipant(t.ada.id).drawnAt, firstDrawn);
});

test('prefilled textareas get enough rows for their text, within bounds', async () => {
  const t = await withNoEmailAda({ names: ['Ada', 'Ben', 'Cor'] });
  saveWishes(t.ctx, t.ada.id, { hobbies: 'gardening', avoid: 'long text '.repeat(40), other: 'x '.repeat(500) });
  const form = await t.adminGet(`/admin/participants/${t.ada.id}/about`);
  const rows = (name) => Number(new RegExp(`<textarea id="${name}"[^>]* rows="(\\d+)"`).exec(form.body)[1]);
  assert.equal(rows('hobbies'), 3);
  assert.ok(rows('avoid') > 3 && rows('avoid') < 20, String(rows('avoid')));
  assert.equal(rows('other'), 20);
  const own = await t.app.inject({ url: `/p/${t.ada.token}/about` });
  assert.ok(own.body.includes('<textarea id="avoid" name="avoid" rows="' + rows('avoid') + '"'));
});

test('drawing on behalf is refused while the group is closed', async () => {
  const t = await withNoEmailAda({ names: ['Ada', 'Ben', 'Cor'] });
  const res = await t.adminPost(`/admin/participants/${t.ada.id}/draw`);
  assert.equal(res.statusCode, 409);
  assert.equal(t.ctx.repo.getParticipant(t.ada.id).drawnAt, null);
  assert.ok(res.body.includes(tr('nl', 'admin.behalf.notOpen')));
});

test('the QR route returns an SVG of the personal link and logs no link', async () => {
  const t = await withNoEmailAda({ names: ['Ada', 'Ben', 'Cor'] });
  const res = await t.adminGet(`/admin/participants/${t.ada.id}/qr`);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /^image\/svg\+xml/);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.match(res.body, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(res.body.includes('<path d="M'));
  assert.equal(t.logs.some((line) => line.includes(t.ada.token)), false);
  assert.equal((await t.adminGet('/admin/participants/999999/qr')).statusCode, 404);

  const anonymous = await t.app.inject({ method: 'GET', url: `/admin/participants/${t.ada.id}/qr` });
  assert.notEqual(anonymous.statusCode, 200);
});

test('the card shows the receiver, their wishes, the theme and the date, and needs a draw first', async () => {
  const t = await withNoEmailAda({ names: ['Ada', 'Ben', 'Cor'], opened: true });
  const receiver = receiverOf(t, t.ada.id);
  saveWishes(t.ctx, receiver.id, { hobbies: 'knitting', likes: ['chocolate'], detail_chocolate: 'dark' });

  const early = await t.adminGet(`/admin/participants/${t.ada.id}/card`);
  assert.equal(early.statusCode, 409);
  assert.equal((await t.adminPost(`/admin/participants/${t.ada.id}/card/printed`)).statusCode, 409);
  assert.equal(t.ctx.repo.getParticipant(t.ada.id).printedAt, null);

  await t.adminPost(`/admin/participants/${t.ada.id}/draw`);
  const card = await t.adminGet(`/admin/participants/${t.ada.id}/card`);
  assert.equal(card.statusCode, 200);
  assert.ok(card.body.includes(receiver.name));
  assert.ok(card.body.includes('knitting'));
  assert.ok(card.body.includes('chocolade (dark)'));
  assert.ok(card.body.includes(themeText(t.event, 'nl')));
  assert.ok(card.body.includes('vrijdag 18 december'));
  assert.ok(card.body.includes('/static/css/print.css'));
  assert.ok(card.body.includes('/static/js/print.js'));
  assert.ok(card.body.includes(`action="/admin/participants/${t.ada.id}/card/printed"`));
  assert.equal(card.body.includes('class="admin-bar"'), false);
});

test('marking the card printed returns to the print view, and changes afterwards flag it out of date', async () => {
  const t = await withNoEmailAda({ names: ['Ada', 'Ben', 'Cor', 'Dirk', 'Eva'], opened: true });
  await t.adminPost(`/admin/participants/${t.ada.id}/draw`);
  const res = await t.adminPost(`/admin/participants/${t.ada.id}/card/printed`);
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/admin/participants/${t.ada.id}/card?print=1`);
  assert.ok(t.ctx.repo.getParticipant(t.ada.id).printedAt);

  const outOfDate = tr('nl', 'admin.card.outOfDate');
  const dashboard = () => t.adminGet(`/admin/groups/${t.groupId}`);
  assert.equal((await dashboard()).body.includes(outOfDate), false);

  // The receiver changes their wishes after the print.
  t.clock.ms += MINUTE;
  const receiver = receiverOf(t, t.ada.id);
  saveWishes(t.ctx, receiver.id, { hobbies: 'reading' });
  assert.ok((await dashboard()).body.includes(outOfDate));

  // Printing again clears it; a reassignment brings it back.
  t.clock.ms += MINUTE;
  await t.adminPost(`/admin/participants/${t.ada.id}/card/printed`);
  assert.equal((await dashboard()).body.includes(outOfDate), false);
  t.clock.ms += MINUTE;
  const plan = planRemoveParticipant(t.ctx, receiver.id);
  const removed = commitRemoveParticipant(t.ctx, receiver.id, { version: plan.version, map: [...plan.map] });
  assert.equal(removed.error, undefined);
  assert.notEqual(t.ctx.repo.getParticipant(t.ada.id).receiverId, receiver.id);
  assert.ok((await dashboard()).body.includes(outOfDate));
});

test('on-behalf routes answer 404 for unknown participants', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor'], opened: true });
  assert.equal((await t.adminGet('/admin/participants/999999/about')).statusCode, 404);
  assert.equal((await t.adminGet('/admin/participants/999999/card')).statusCode, 404);
  assert.equal((await t.adminPost('/admin/participants/999999/draw')).statusCode, 404);
  assert.equal((await t.adminPost('/admin/participants/999999/about')).statusCode, 404);
});

// The organiser draws for Ada with Ada beside her, so the page she starts
// from must not name the receiver before the reveal.
test('the participant page keeps the receiver hidden until drawn, then behind a disclosure', async () => {
  const t = await withNoEmailAda({ names: ['Ada', 'Ben', 'Cor', 'Dirk'], opened: true });
  const receiver = receiverOf(t, t.ada.id);
  const before = await t.adminGet(`/admin/participants/${t.ada.id}`);
  assert.equal(before.statusCode, 200);
  assert.ok(!before.body.includes(receiver.name), 'no receiver name before the draw');
  assert.ok(before.body.includes(tr('nl', 'admin.person.paired')));
  assert.ok(!before.body.includes('<details'));

  await t.adminPost(`/admin/participants/${t.ada.id}/draw`);
  const after = await t.adminGet(`/admin/participants/${t.ada.id}`);
  const disclosure = /<details[^>]*>\s*<summary>([^<]*)<\/summary>([\s\S]*?)<\/details>/.exec(after.body);
  assert.ok(disclosure, 'a disclosure holds the receiver');
  assert.equal(disclosure[1], tr('nl', 'admin.person.showReceiver', { name: 'Ada' }));
  assert.ok(disclosure[2].includes(tr('nl', 'admin.person.givesTo', { name: receiver.name })));
  assert.equal(after.body.split(receiver.name).length - 1, 1, 'the name appears only inside the disclosure');
});
