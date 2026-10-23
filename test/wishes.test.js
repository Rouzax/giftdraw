import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIKE_IDS,
  detailPrompt,
  optionLines,
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

test('detailPrompt asks for a flavour on chocolate and something particular elsewhere', () => {
  assert.equal(detailPrompt(defaults[0], 'en'), 'Which flavour?');
  assert.equal(detailPrompt(defaults[0], 'nl'), 'Welke smaak?');
  assert.equal(detailPrompt({ id: 'wol-ab12' }, 'nl'), 'Iets in het bijzonder?');
  assert.equal(detailPrompt({ id: 'wol-ab12' }, 'en'), 'Anything in particular?');
});

test('detailPrompt uses the organiser question in every language, also on chocolate', () => {
  assert.equal(detailPrompt({ id: 'books', question: 'Welke schrijver?' }, 'en'), 'Welke schrijver?');
  assert.equal(detailPrompt({ id: 'chocolate', question: 'Welke soort chocola?' }, 'nl'), 'Welke soort chocola?');
});

test('stored options without a question still load, with the generic prompt', () => {
  const [option] = wishOptions({ wishOptions: [{ id: 'wol-ab12', label: 'Wol', detail: true }] });
  assert.equal(option.question, null);
  assert.equal(detailPrompt(option, 'nl'), 'Iets in het bijzonder?');
});

test('a stored question comes back on the option', () => {
  const [option] = wishOptions({ wishOptions: [{ id: 'wol-ab12', label: 'Wol', detail: true, question: 'Welke kleur?' }] });
  assert.equal(option.question, 'Welke kleur?');
  assert.equal(detailPrompt(option, 'en'), 'Welke kleur?');
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

test('parseWishesForm does not split an emoji at the limit', () => {
  const hobbies = parseWishesForm({ hobbies: `${'a'.repeat(999)}\u{1F600}b` }, defaults).hobbies;
  assert.equal(hobbies, `${'a'.repeat(999)}\u{1F600}`);
  assert.equal(Array.from(hobbies).length, 1000);
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

test('mergeOptionLabels matches a default option in any language and input shape', () => {
  const stored = [{ id: 'tea', label: 'Thee', detail: false }];
  for (const current of [defaults, stored, wishOptions({ wishOptions: stored })]) {
    assert.equal(mergeOptionLabels('Thee', current, 'en')[0].id, 'tea');
    assert.equal(mergeOptionLabels('Tea', current, 'nl')[0].id, 'tea');
    assert.equal(mergeOptionLabels('thee', current, 'nl')[0].id, 'tea');
  }
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

const parseOne = (line, current = defaults) => {
  const [option] = mergeOptionLabels(line, current, 'nl');
  return { label: option.label, detail: option.detail, question: option.question ?? null };
};

test('mergeOptionLabels reads the question after the first question mark', () => {
  assert.deepEqual(parseOne('Boeken? Welke schrijver?'), { label: 'Boeken', detail: true, question: 'Welke schrijver?' });
  assert.deepEqual(parseOne('Boeken? welke schrijver'), { label: 'Boeken', detail: true, question: 'welke schrijver?' });
  assert.deepEqual(parseOne('Boeken?'), { label: 'Boeken', detail: true, question: null });
  assert.deepEqual(parseOne('Boeken?   '), { label: 'Boeken', detail: true, question: null });
  assert.deepEqual(parseOne('Boeken'), { label: 'Boeken', detail: false, question: null });
  assert.deepEqual(parseOne('Boeken? Welke schrijver? Of genre?'), {
    label: 'Boeken', detail: true, question: 'Welke schrijver? Of genre?',
  });
});

test('mergeOptionLabels stores no question key when there is none', () => {
  const [plain, generic] = mergeOptionLabels('Boeken\nWol?', [], 'nl');
  assert.ok(!Object.hasOwn(plain, 'question'));
  assert.ok(!Object.hasOwn(generic, 'question'));
});

test('chocolate keeps its flavour prompt unless the organiser asks her own question', () => {
  const [plain] = mergeOptionLabels('Chocolade?', defaults, 'nl');
  assert.equal(plain.id, 'chocolate');
  assert.equal(detailPrompt(wishOptions({ wishOptions: [plain] })[0], 'nl'), 'Welke smaak?');
  const [custom] = mergeOptionLabels('Chocolade? Welke soort chocola?', defaults, 'nl');
  assert.equal(custom.id, 'chocolate');
  assert.equal(detailPrompt(wishOptions({ wishOptions: [custom] })[0], 'en'), 'Welke soort chocola?');
});

test('mergeOptionLabels caps a question at 80 characters and keeps its question mark', () => {
  const [option] = mergeOptionLabels(`Boeken? ${'x'.repeat(200)}`, [], 'nl');
  assert.equal(Array.from(option.question).length, 80);
  assert.ok(option.question.endsWith('?'));
});

test('optionLines writes the options back so a re-save changes nothing', () => {
  const text = 'Boeken? Welke schrijver?\nChocolade?\nThee\nWol?';
  const first = mergeOptionLabels(text, defaults, 'nl');
  const options = wishOptions({ wishOptions: first });
  const shown = optionLines(options, 'nl');
  assert.equal(shown, text);
  assert.deepEqual(mergeOptionLabels(shown, options, 'nl'), first);
});

test('optionLines shows the default list with chocolate as a plain detail', () => {
  assert.equal(optionLines(defaults, 'en').split('\n')[0], 'Chocolate?');
  assert.equal(optionLines(defaults, 'nl').split('\n')[1], 'Thee');
});
