import { test } from 'node:test';
import assert from 'node:assert/strict';
import nl from '../src/i18n/nl.js';
import en from '../src/i18n/en.js';
import { LANGS, formatDate, isLang, t, themeText } from '../src/i18n/index.js';

const NL_THEME =
  'Dit jaar doen we een regift: geef iets dat je al hebt en graag aan een ander gunt. Zo hoeft er niets nieuws gekocht te worden. Koop je toch iets, besteed dan maximaal 5 euro.';
const EN_THEME =
  "This year it's a regift: give something you already have and would like to pass on, so nothing new needs to be bought. If you do buy something, spend at most 5 euro.";

test('nl and en catalogues have the same keys', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(nl).sort());
});

test('every catalogue value is a non-empty string without em dashes', () => {
  for (const catalogue of [nl, en]) {
    for (const [key, value] of Object.entries(catalogue)) {
      assert.equal(typeof value, 'string', key);
      assert.notEqual(value.trim(), '', key);
      assert.equal(value.includes('\u2014'), false, key);
    }
  }
});

test('placeholders match between languages', () => {
  const names = (s) => (s.match(/\{\w+\}/g) ?? []).sort();
  for (const key of Object.keys(nl)) assert.deepEqual(names(en[key]), names(nl[key]), key);
});

test('LANGS and isLang', () => {
  assert.deepEqual(LANGS, ['nl', 'en']);
  assert.equal(isLang('nl'), true);
  assert.equal(isLang('en'), true);
  assert.equal(isLang('de'), false);
  assert.equal(isLang(undefined), false);
  assert.equal(isLang(['nl']), false);
});

test('t returns the app name per language', () => {
  assert.equal(t('en', 'app.name'), 'Gift Draw');
  assert.equal(t('nl', 'app.name'), 'Lootjes trekken');
});

test('t falls back to nl for an unknown language', () => {
  assert.equal(t('xx', 'app.name'), 'Lootjes trekken');
  assert.equal(t(undefined, 'app.name'), 'Lootjes trekken');
});

test('t throws on a missing key under the test script', () => {
  assert.throws(() => t('nl', 'no.such.key'), /no\.such\.key/);
  assert.throws(() => t('nl', 'constructor'));
});

test('t returns the key for a missing key outside tests', (ctx) => {
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  ctx.after(() => {
    process.env.NODE_ENV = before;
  });
  assert.equal(t('nl', 'no.such.key'), 'no.such.key');
});

test('t replaces placeholders and leaves unknown ones alone', () => {
  assert.equal(t('en', 'result.givesTo', { name: 'Ada' }), 'You give a present to Ada');
  assert.equal(t('en', 'result.givesTo'), 'You give a present to {name}');
  assert.equal(t('en', 'result.givesTo', { name: '$& {name}' }), 'You give a present to $& {name}');
});

test('the reassignment mail speaks of the slip, naming only the new person', () => {
  assert.equal(t('nl', 'email.reassigned.body', { name: 'Ben' }), 'Je lootje is veranderd. Je geeft nu een cadeautje aan Ben.');
  assert.equal(t('nl', 'email.reassigned.subject'), 'Je lootje is veranderd');
});

test('themeText uses the exact default when the event has none', () => {
  assert.equal(themeText({ themeText: null }, 'nl'), NL_THEME);
  assert.equal(themeText({ themeText: null }, 'en'), EN_THEME);
  assert.equal(themeText({ themeText: '   ' }, 'en'), EN_THEME);
});

test('themeText shows organiser text as typed in both languages', () => {
  const event = { themeText: 'Neem iets lekkers mee.' };
  assert.equal(themeText(event, 'nl'), 'Neem iets lekkers mee.');
  assert.equal(themeText(event, 'en'), 'Neem iets lekkers mee.');
});

test('formatDate gives a weekday and day month', () => {
  assert.equal(formatDate('nl', '2026-12-12', 'Europe/Amsterdam'), 'zaterdag 12 december');
  assert.equal(formatDate('en', '2026-12-12', 'Europe/Amsterdam'), 'Saturday 12 December');
});

test('formatDate keeps the calendar date in a far time zone', () => {
  assert.equal(formatDate('en', '2026-12-12', 'Pacific/Kiritimati'), 'Saturday 12 December');
  assert.equal(formatDate('en', '2026-12-12', 'Pacific/Pago_Pago'), 'Saturday 12 December');
});

test('formatDate uses nl for an unknown language instead of throwing', () => {
  assert.equal(formatDate('<script>', '2026-12-12', 'Europe/Amsterdam'), 'zaterdag 12 december');
});
