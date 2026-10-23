import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SafeHtml } from '../src/html.js';
import { t as tr } from '../src/i18n/index.js';
import { icon, iconInline } from '../src/icons.js';
import { saveWishes } from '../src/people.js';
import { makeTestApp, seedGroup } from './helpers.js';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');

async function setup(seed) {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  const seeded = seedGroup(t.ctx, seed);
  return { ...t, clock, ...seeded, groupId: seeded.group.id };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// The icon sits directly before the words it belongs to, which stay as
// text. Spans are dropped first: a label may be wrapped whole, or only its
// first word may share a nowrap box with the icon.
function assertNextTo(body, name, text) {
  const flat = body.replace(/<\/?span[^>]*>/g, '');
  const re = new RegExp(`<svg class="icon icon-${name}"[^>]*>(?:(?!</svg>).)*</svg>${escapeRe(escapeHtml(text))}`);
  assert.match(flat, re, `${name} next to "${text}"`);
}

function assertNoStyle(body) {
  assert.equal(/\sstyle=/.test(body), false, 'no style attribute');
}

test('icon() renders a decorative inline svg', () => {
  const svg = icon('pencil');
  assert.ok(svg instanceof SafeHtml);
  const out = String(svg);
  assert.match(out, /^<svg class="icon icon-pencil" /);
  assert.ok(out.includes('viewBox="0 0 24 24"'));
  assert.ok(out.includes('fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'));
  assert.ok(out.includes('aria-hidden="true" focusable="false"'));
  assert.ok(out.endsWith('</svg>'));
  assert.ok(!out.includes('style='));
});

test('icon() with a label is announced instead of hidden, escaped', () => {
  const out = String(icon('lock', { label: 'Vast "dicht"' }));
  assert.ok(out.includes('role="img" aria-label="Vast &quot;dicht&quot;"'));
  assert.ok(!out.includes('aria-hidden'));
});

test('icon() throws on an unknown name', () => {
  assert.throws(() => icon('pencl'), /unknown icon: pencl/);
});

test('participant screens put icons next to their words', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor'] });
  const [ada, ben] = t.people;
  t.ctx.repo.updateGroup(t.groupId, { exchangeTime: '10:30', exchangePlace: 'De Lotus' }, t.ctx.nowIso());

  const welcome = (await t.app.inject(`/p/${ada.token}`)).body;
  assertNextTo(welcome, 'pencil', tr('nl', 'welcome.button'));
  assert.match(welcome, /<p class="date"><svg class="icon icon-calendar"[^>]*>(?:(?!<\/svg>).)*<\/svg>We geven de cadeautjes op /);
  // The pin shares a nowrap box with the first word, so a line never ends on it.
  assert.match(welcome, /bij <span class="nowrap"><svg class="icon icon-map-pin"[^>]*>(?:(?!<\/svg>).)*<\/svg>De<\/span> Lotus\./);
  assertNoStyle(welcome);

  assertNoStyle((await t.app.inject(`/p/${ada.token}/about`)).body);

  saveWishes(t.ctx, ada.id, { hobbies: 'Lezen' });
  const waiting = (await t.app.inject(`/p/${ada.token}`)).body;
  assertNextTo(waiting, 'mail', tr('nl', 'waiting.thanks'));
  assertNextTo(waiting, 'pencil', tr('nl', 'waiting.edit'));
  assertNoStyle(waiting);

  // Without a place there is no pin, and without email no envelope.
  t.ctx.repo.updateGroup(t.groupId, { exchangePlace: null }, t.ctx.nowIso());
  t.ctx.repo.updateParticipant(ben.id, { email: null });
  saveWishes(t.ctx, ben.id, { hobbies: 'Tuinieren' });
  const plain = (await t.app.inject(`/p/${ben.token}`)).body;
  assert.match(plain, /icon-calendar/);
  assert.equal(plain.includes('icon-map-pin'), false);
  assert.equal(plain.includes('icon-mail'), false);

  t.ctx.repo.markInvitationsSent(t.groupId, t.ctx.nowIso());
  t.ctx.repo.markGroupOpened(t.groupId, t.ctx.nowIso());
  const draw = (await t.app.inject(`/p/${ada.token}`)).body;
  assertNextTo(draw, 'gift', tr('nl', 'draw.button'));
  assertNoStyle(draw);

  const result = (await t.app.inject(`/p/${ada.token}?reveal=1`)).body;
  assert.match(result, /<svg class="icon icon-calendar"/);
  assertNextTo(result, 'pencil', tr('nl', 'result.edit'));
  assertNoStyle(result);

});

test('dashboard status cells carry an icon and keep their text', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor', 'Dirk'] });
  const [ada, ben, cor] = t.people;
  t.ctx.repo.updateParticipant(cor.id, { email: null, invitedAt: null });
  saveWishes(t.ctx, ada.id, { hobbies: 'Lezen' });
  const row = t.ctx.repo.enqueue(ben.id, 'invite', t.ctx.nowIso());
  t.ctx.repo.claimDue(t.ctx.nowIso(), 10);
  t.ctx.repo.markFailed(row, 'smtp-550', null, t.ctx.nowIso());

  const body = (await t.adminGet(`/admin/groups/${t.groupId}`)).body;
  assertNextTo(body, 'check', tr('nl', 'admin.status.yes'));
  assertNextTo(body, 'hourglass', tr('nl', 'admin.status.no'));
  assertNextTo(body, 'x', tr('nl', 'admin.invite.failed'));
  assertNextTo(body, 'minus', tr('nl', 'admin.status.notApplicable'));
  assert.ok(body.includes(tr('nl', 'admin.col.visitedNote')));
  assertNextTo(body, 'send', tr('nl', 'admin.invite.button'));
  assertNextTo(body, 'door-open', tr('nl', 'admin.draw.openButton'));
  assertNextTo(body, 'rotate-ccw', tr('nl', 'admin.failure.resendAll'));
  assertNextTo(body, 'trash-2', tr('nl', 'admin.group.delete'));
  assertNoStyle(body);
});

test('organiser buttons on the person, arrange, card and event pages carry icons', async () => {
  const t = await setup({ names: ['Ada', 'Ben', 'Cor', 'Dirk', 'Eva'], opened: true });
  const [ada] = t.people;
  await t.adminPost(`/admin/participants/${ada.id}/draw`);

  const person = (await t.adminGet(`/admin/participants/${ada.id}`)).body;
  for (const [name, key, vars] of [
    ['copy', 'admin.person.link.copy'],
    ['refresh-cw', 'admin.person.regenerate.button'],
    ['mail', 'admin.person.mail.resendInvite'],
    ['qr-code', 'admin.person.qr.open'],
    ['pencil', 'admin.behalf.about', { name: 'Ada' }],
    ['gift', 'admin.behalf.drawAgain'],
    ['printer', 'admin.behalf.card'],
    ['trash-2', 'admin.person.remove.link'],
  ]) assertNextTo(person, name, tr('nl', key, vars));
  assertNoStyle(person);

  const arrange = (await t.adminGet(`/admin/groups/${t.groupId}/arrange`)).body;
  assertNextTo(arrange, 'arrow-left-right', tr('nl', 'admin.arrange.swap'));
  assertNextTo(arrange, 'lock', tr('nl', 'admin.arrange.locked'));
  assertNoStyle(arrange);

  const dashboard = (await t.adminGet(`/admin/groups/${t.groupId}`)).body;
  assertNextTo(dashboard, 'arrow-left-right', tr('nl', 'admin.draw.arrange'));

  const card = (await t.adminGet(`/admin/participants/${ada.id}/card`)).body;
  assertNextTo(card, 'printer', tr('nl', 'admin.card.print'));
  assertNoStyle(card);

  const remove = (await t.adminGet(`/admin/participants/${ada.id}/remove`)).body;
  assertNextTo(remove, 'trash-2', tr('nl', 'admin.remove.confirm', { name: 'Ada' }));

  const event = (await t.adminGet(`/admin/events/${t.event.id}`)).body;
  assertNextTo(event, 'trash-2', tr('nl', 'admin.event.delete'));
  assertNoStyle(event);
});

test('iconInline keeps the icon with the first word, but not a long unbroken one', () => {
  assert.match(String(iconInline('pencil', 'Mijn <antwoorden>')),
    /^<span class="nowrap"><svg class="icon icon-pencil"[^>]*>.*<\/svg>Mijn<\/span> &lt;antwoorden&gt;$/);
  const link = `https://example.com/${'x'.repeat(40)}`;
  assert.match(String(iconInline('map-pin', link)), new RegExp(`^<svg[^>]*>.*</svg>${escapeRe(link)}$`));
});
