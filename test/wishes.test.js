import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIKE_IDS,
  detailPrompt,
  PET_IDS,
  hasWishes,
  mergeOptionLabels,
  parseWishesForm,
  wishLines,
  wishOptions,
} from '../src/wishes.js';

const defaults = wishOptions({ wishOptions: null });

test('default options are the spec list with detail only on chocolate', () => {
  assert.deepEqual(DEFAULT_LIKE_IDS, ['chocolate', 'tea', 'coffee', 'bath', 'candles', 'books', 'plants', 'wine']);
  assert.deepEqual(PET_IDS, ['dog', 'cat', 'other']);
  assert.deepEqual(defaults.map((o) => o.id), DEFAULT_LIKE_IDS);
  assert.deepEqual(defaults.filter((o) => o.detail).map((o) => o.id), ['chocolate']);
  assert.equal(defaults[1].label('nl'), 'Thee');
  assert.equal(defaults[1].label('en'), 'Tea');
});

test('detailPrompt asks for a flavour on chocolate and a kind elsewhere', () => {
  assert.equal(detailPrompt(defaults[0], 'en'), 'Which flavour?');
  assert.equal(detailPrompt({ id: 'wol-ab12' }, 'nl'), 'Welke soort?');
});

test('stored custom options keep their typed label in both languages', () => {
  const options = wishOptions({
    wishOptions: [
      { id: 'tea', label: 'thee', detail: false },
      { id: 'knitting-ab12', label: 'Breiwol', detail: true },
    ],
  });
  assert.equal(options[0].label('en'), 'Tea');
  assert.equal(options[1].label('en'), 'Breiwol');
  assert.equal(options[1].detail, true);
});

test('parseWishesForm keeps known ids, drops unknown ones and trims', () => {
  const wishes = parseWishesForm(
    {
      hobbies: '  tuinieren ',
      likes: ['tea', 'caviar', 'chocolate', 'tea'],
      detail_chocolate: ' puur ',
      detail_tea: 'groen',
      pets: ['cat', 'snake'],
      pets_other: '',
      avoid: 'noten',
      other: '',
    },
    defaults,
  );
  assert.deepEqual(wishes, {
    hobbies: 'tuinieren',
    likes: ['tea', 'chocolate'],
    likeDetails: { chocolate: 'puur' },
    pets: ['cat'],
    petsOther: '',
    avoid: 'noten',
    other: '',
  });
});

test('parseWishesForm accepts a single checkbox value as a string', () => {
  const wishes = parseWishesForm({ likes: 'wine', pets: 'dog' }, defaults);
  assert.deepEqual(wishes.likes, ['wine']);
  assert.deepEqual(wishes.pets, ['dog']);
  assert.equal(wishes.hobbies, '');
});

test('a filled-in detail or other pet counts as ticked', () => {
  const wishes = parseWishesForm({ detail_chocolate: 'melk', pets_other: 'konijn' }, defaults);
  assert.deepEqual(wishes.likes, ['chocolate']);
  assert.deepEqual(wishes.likeDetails, { chocolate: 'melk' });
  assert.deepEqual(wishes.pets, ['other']);
  assert.equal(wishes.petsOther, 'konijn');
});

test('parseWishesForm caps text at 1000 characters', () => {
  const wishes = parseWishesForm({ hobbies: 'a'.repeat(5000), likes: 'chocolate', detail_chocolate: 'b'.repeat(5000) }, defaults);
  assert.equal(wishes.hobbies.length, 1000);
  assert.equal(wishes.likeDetails.chocolate.length, 1000);
});

test('parseWishesForm keeps markup verbatim for the view to escape', () => {
  assert.equal(parseWishesForm({ other: '<script>' }, defaults).other, '<script>');
});

test('parseWishesForm ignores non-string text values', () => {
  const wishes = parseWishesForm({ hobbies: ['a', 'b'], avoid: { x: 1 }, likes: [{}] }, defaults);
  assert.equal(wishes.hobbies, 'a');
  assert.equal(wishes.avoid, '');
  assert.deepEqual(wishes.likes, []);
});

test('hasWishes', () => {
  assert.equal(hasWishes(null), false);
  assert.equal(hasWishes(parseWishesForm({}, defaults)), false);
  assert.equal(hasWishes(parseWishesForm({ likes: 'tea' }, defaults)), true);
  assert.equal(hasWishes(parseWishesForm({ other: 'x' }, defaults)), true);
});

test('wishLines renders labelled lines in English', () => {
  const wishes = parseWishesForm(
    { hobbies: 'gardening', likes: ['tea', 'chocolate'], detail_chocolate: 'dark', pets: 'cat' },
    defaults,
  );
  assert.deepEqual(wishLines(wishes, defaults, 'en'), [
    { label: 'Hobbies', value: 'gardening' },
    { label: 'Likes', value: 'tea, chocolate (dark)' },
    { label: 'Pets', value: 'cat' },
  ]);
});

test('wishLines keeps section order and uses the other-pet text', () => {
  const wishes = parseWishesForm(
    { other: 'Graag iets kleins', avoid: 'noten', pets: ['dog', 'other'], pets_other: 'konijn' },
    defaults,
  );
  assert.deepEqual(wishLines(wishes, defaults, 'nl'), [
    { label: 'Huisdieren', value: 'hond, konijn' },
    { label: 'Liever niet', value: 'noten' },
    { label: 'Verder', value: 'Graag iets kleins' },
  ]);
});

test('wishLines returns nothing for empty or missing wishes', () => {
  assert.deepEqual(wishLines(null, defaults, 'en'), []);
  assert.deepEqual(wishLines(parseWishesForm({}, defaults), defaults, 'en'), []);
});

test('wishLines skips a stored like whose option was removed', () => {
  const wishes = parseWishesForm({ likes: ['tea', 'wine'] }, defaults);
  const withoutWine = defaults.filter((o) => o.id !== 'wine');
  assert.deepEqual(wishLines(wishes, withoutWine, 'en'), [{ label: 'Likes', value: 'tea' }]);
  const onlyWine = parseWishesForm({ likes: 'wine' }, defaults);
  assert.deepEqual(wishLines(onlyWine, withoutWine, 'en'), []);
});

test('wishLines shows custom option labels as typed', () => {
  const options = wishOptions({ wishOptions: [{ id: 'lego-ab12', label: 'Lego', detail: false }] });
  const wishes = parseWishesForm({ likes: 'lego-ab12' }, options);
  assert.deepEqual(wishLines(wishes, options, 'en'), [{ label: 'Likes', value: 'Lego' }]);
});

test('mergeOptionLabels keeps ids when lines are reordered', () => {
  const text = 'Wijn\nThee\nChocolade?\nKoffie\nBad- of doucheproducten\nKaarsen\nBoeken of puzzels\nPlanten of bloemen';
  const merged = mergeOptionLabels(text, defaults, 'nl');
  assert.deepEqual(merged.map((o) => o.id), ['wine', 'tea', 'chocolate', 'coffee', 'bath', 'candles', 'books', 'plants']);
  assert.deepEqual(merged[2], { id: 'chocolate', label: 'Chocolade', detail: true });
  assert.equal(merged[0].detail, false);
});

test('mergeOptionLabels matches case-insensitively and maps Thee to tea', () => {
  const merged = mergeOptionLabels('  thee  \n\nWOL?', [], 'nl');
  assert.deepEqual(merged[0], { id: 'tea', label: 'thee', detail: false });
  assert.match(merged[1].id, /^wol-[0-9a-f]{4}$/);
  assert.deepEqual({ ...merged[1], id: null }, { id: null, label: 'WOL', detail: true });
});

test('mergeOptionLabels keeps a custom id and makes new slugs', () => {
  const current = wishOptions({ wishOptions: [{ id: 'lego-ab12', label: 'Lego', detail: false }] });
  const merged = mergeOptionLabels('Puzzels met 1000 stukjes\nlego\nCrème brûlée', current, 'nl');
  assert.match(merged[0].id, /^puzzels-met-1000-stukjes-[0-9a-f]{4}$/);
  assert.equal(merged[1].id, 'lego-ab12');
  assert.match(merged[2].id, /^creme-brulee-[0-9a-f]{4}$/);
});

test('mergeOptionLabels gives a repeated line its own id', () => {
  const merged = mergeOptionLabels('Thee\nThee\n?\n!!!', defaults, 'nl');
  assert.equal(merged.length, 3);
  assert.equal(merged[0].id, 'tea');
  assert.notEqual(merged[1].id, 'tea');
  assert.match(merged[2].id, /^option-[0-9a-f]{4}$/);
  assert.equal(new Set(merged.map((o) => o.id)).size, 3);
});
