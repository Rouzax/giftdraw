import { test } from 'node:test';
import assert from 'node:assert/strict';
import { field } from '../src/routes/admin-shared.js';
import { normaliseEmail, parsePasteList } from '../src/people.js';
import { clipText } from '../src/text.js';
import { cleanHeading, mergeOptionLabels, parseWishesForm, wishForm } from '../src/wishes.js';
import { makeTestApp, seedGroup } from './helpers.js';

const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}';
const OLDER = '\u{1F9D1}‍\u{1F9B3}';
const FLAG = '\u{1F1F3}\u{1F1F1}';
const THUMB = '\u{1F44D}\u{1F3FD}';
const GIFT = '\u{1F381}';

// Damage a cut can do: half a surrogate pair, a dangling joiner, half a
// flag, or a skin tone left without its emoji.
function assertWhole(text) {
  assert.equal(text.isWellFormed(), true, 'lone surrogate');
  assert.doesNotMatch(text, /‍$/u, 'dangling joiner');
  const indicators = text.match(/\p{Regional_Indicator}/gu) ?? [];
  assert.equal(indicators.length % 2, 0, 'half a flag');
  assert.doesNotMatch(text, /^\p{Emoji_Modifier}/u, 'skin tone without emoji');
}

test('clipText never cuts inside an emoji', () => {
  for (const tail of [FAMILY, OLDER, FLAG, THUMB, GIFT]) {
    const units = clipText(`${'x'.repeat(79)}${tail}`, 80);
    assertWhole(units);
    assert.equal(units, 'x'.repeat(79));
    if (Array.from(tail).length === 1) continue;
    const points = clipText(`${'x'.repeat(79)}${tail}`, 80, 'codepoints');
    assertWhole(points);
    assert.equal(points, 'x'.repeat(79));
  }
});

test('clipText keeps text that fits, emoji included', () => {
  assert.equal(clipText(`Ada ${FAMILY}`, 100), `Ada ${FAMILY}`);
  assert.equal(clipText(`${'x'.repeat(76)}${GIFT}`, 80, 'codepoints'), `${'x'.repeat(76)}${GIFT}`);
  // Exactly at the limit in code units.
  assert.equal(clipText(`${'x'.repeat(98)}${GIFT}`, 100), `${'x'.repeat(98)}${GIFT}`);
});

test('a form field read up to its limit keeps every emoji whole', () => {
  assert.equal(field({ name: `${'x'.repeat(99)}${GIFT}` }, 'name', 100), 'x'.repeat(99));
  assert.equal(field({ name: `${'x'.repeat(97)}${THUMB}` }, 'name', 100), 'x'.repeat(97));
});

test('a heading, a question and wish texts are cut at a whole emoji', () => {
  assertWhole(cleanHeading(`${'a'.repeat(78)}${FAMILY}`));
  assert.equal(cleanHeading(`${'a'.repeat(79)}${FLAG}`), 'a'.repeat(79));
  const [option] = mergeOptionLabels(`Boek? ${'c'.repeat(78)}${THUMB}`, [], 'nl');
  assertWhole(option.question);
  assert.equal(option.question, `${'c'.repeat(78)}?`);
  const wishes = parseWishesForm({ hobbies: `${'x'.repeat(998)}${OLDER}`, avoid: `${'y'.repeat(999)}${FLAG}` }, wishForm({}));
  assert.equal(wishes.hobbies, 'x'.repeat(998));
  assert.equal(wishes.avoid, 'y'.repeat(999));
});

// Names are capped in UTF-16 code units, the way the name fields' maxlength
// counts, so a pasted name always fits the edit form it is shown in.
test('a pasted name is cut to what the name field holds, at a whole emoji', () => {
  const { rows } = parsePasteList(`${'d'.repeat(97)}${THUMB}, d@example.com\nAda ${GIFT}, ada@example.com`);
  assert.equal(rows[0].name, 'd'.repeat(97));
  assert.equal(rows[1].name, `Ada ${GIFT}`);
});

test('an address the browser email field would refuse is refused when pasted', () => {
  const { rows, errors } = parsePasteList(`Ben, b${GIFT}n@example.com\nCor, cor@example.com`);
  assert.deepEqual(rows.map((r) => r.email), ['cor@example.com']);
  assert.deepEqual(errors.map((e) => e.reason), ['invalid-email']);
  assert.equal(normaliseEmail(`b${GIFT}n@example.com`), null);
  assert.equal(normaliseEmail('ada@éxample.com'.replace('é', 'e')), 'ada@example.com');
  assert.equal(normaliseEmail("o'brien+gifts@mail.example.co.uk"), "o'brien+gifts@mail.example.co.uk");
});

// The browser's email field sends an accented domain as punycode; a pasted
// one is stored the same way, so both forms agree on the address.
test('an accented domain is stored as punycode, from the paste and from the person form', async () => {
  assert.equal(normaliseEmail('Ada@Café.nl'), 'ada@xn--caf-dma.nl');
  assert.equal(normaliseEmail('ada@xn--caf-dma.nl'), 'ada@xn--caf-dma.nl');
  assert.equal(normaliseEmail('jé@cafe.nl'), null);
  const { rows } = parsePasteList('Ada, ada@café.nl');
  assert.equal(rows[0].email, 'ada@xn--caf-dma.nl');
  const t = await makeTestApp();
  const { people } = seedGroup(t.ctx, { names: ['Ada', 'Ben', 'Cor'] });
  const res = await t.adminPost(`/admin/participants/${people[0].id}`, { name: 'Ada', email: 'ada@café.nl', language: 'nl' });
  assert.equal(res.statusCode, 303);
  assert.equal(t.ctx.repo.getParticipant(people[0].id).email, 'ada@xn--caf-dma.nl');
});

test('saving the edit form unchanged keeps an emoji name as it was', async () => {
  const t = await makeTestApp();
  const { people } = seedGroup(t.ctx, { names: ['Ada', 'Ben', 'Cor'] });
  const ada = people[0];
  const name = `${'g'.repeat(96)}${THUMB}`;
  t.ctx.repo.updateParticipant(ada.id, { name });
  const res = await t.adminPost(`/admin/participants/${ada.id}`, { name, email: ada.email, language: 'nl' });
  assert.equal(res.statusCode, 303);
  assert.equal(t.ctx.repo.getParticipant(ada.id).name, name);
  const over = await t.adminPost(`/admin/participants/${ada.id}`, { name: `${'g'.repeat(99)}${GIFT}`, email: ada.email, language: 'nl' });
  assert.equal(over.statusCode, 303);
  assert.equal(t.ctx.repo.getParticipant(ada.id).name, 'g'.repeat(99));
});

// A textarea counts a line break as one character against its maxlength but
// sends it as CRLF, two units, so a text typed up to the limit arrives over it.
const lines = (count, width) => Array.from({ length: count }, (_, i) => String(i).padEnd(width, 'x')).join('\n');

test('a theme, an option list and a wish typed up to the limit keep their last line', async () => {
  const t = await makeTestApp();
  const { event, people } = seedGroup(t.ctx, { names: ['Ada', 'Ben', 'Cor'] });
  const theme = lines(40, 49);
  assert.equal(theme.length, 1999);
  const options = lines(400, 9);
  assert.equal(options.length, 3999);
  const crlf = (text) => text.replace(/\n/g, '\r\n');
  const res = await t.adminPost(`/admin/events/${event.id}`, {
    name: event.name, language: 'nl', cleanupWeeks: '4', themeText: crlf(theme), wishOptions: crlf(options),
  });
  assert.equal(res.statusCode, 303);
  const stored = t.ctx.repo.getEvent(event.id);
  assert.equal(stored.themeText, theme);
  assert.equal(stored.wishOptions.length, 400);
  assert.equal(stored.wishOptions.at(-1).label, '399xxxxxx');

  const hobbies = lines(50, 19);
  assert.equal(hobbies.length, 999);
  await t.post(`/p/${people[0].token}/about`, { hobbies: crlf(hobbies) });
  assert.equal(t.ctx.repo.getParticipant(people[0].id).wishes.hobbies, hobbies);
});

// Texts saved before line breaks were normalised are stored with CRLF; the
// same text sent again is no change.
test('saving an old CRLF text unchanged marks nothing as changed', async () => {
  const t = await makeTestApp();
  const { event, people } = seedGroup(t.ctx, { names: ['Ada', 'Ben', 'Cor'] });
  t.ctx.repo.updateEvent(event.id, { themeText: 'Regel een\r\nRegel twee' });
  const themeChangedAt = t.ctx.repo.getEvent(event.id).themeChangedAt;
  await t.adminPost(`/admin/events/${event.id}`, { name: event.name, language: 'nl', cleanupWeeks: '4', themeText: 'Regel een\r\nRegel twee' });
  assert.equal(t.ctx.repo.getEvent(event.id).themeChangedAt, themeChangedAt);

  const ada = people[0];
  const old = { hobbies: 'Breien\r\nLezen', likes: [], likeDetails: {}, pets: [], petsOther: '', avoid: '', other: '' };
  t.ctx.repo.updateParticipant(ada.id, { wishes: old });
  const giver = t.ctx.repo.giverOf(ada.id);
  t.ctx.repo.updateParticipant(giver.id, { drawnAt: t.ctx.nowIso() });
  await t.post(`/p/${ada.token}/about`, { hobbies: 'Breien\r\nLezen' });
  assert.equal(t.ctx.repo.getParticipant(ada.id).notifyGiverDueAt, null);
});
