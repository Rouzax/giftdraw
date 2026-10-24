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
  assert.equal(normaliseEmail('ada@exämple.com'), null);
  assert.equal(normaliseEmail("o'brien+gifts@mail.example.co.uk"), "o'brien+gifts@mail.example.co.uk");
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
