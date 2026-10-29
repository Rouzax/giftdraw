import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countAnswers,
  dropAnswers,
  hasWishes,
  parseWishesForm,
  readAnswers,
  wishLines,
} from '../src/answers.js';
import { formValue, wishForm } from '../src/questions.js';
import * as old from '../src/wishes.js';

const v031Event = {
  wishOptions: [
    { id: 'tea', label: 'Thee', detail: false },
    { id: 'books', label: 'Boeken', detail: true, question: 'Welke schrijver?' },
    { id: 'wol-ab12', label: 'Wol', detail: true },
  ],
  formConfig: {
    sections: { hobbies: { heading: 'Favoriete auto' }, avoid: { show: false } },
    petOptions: [
      { id: 'dog', label: 'Hond', detail: false },
      { id: 'vogel-cd34', label: 'Vogel', detail: true, question: 'Welke soort?' },
      { id: 'other', label: 'Ander dier', detail: true },
    ],
  },
};

// A wishes row as v0.3.1 stored it.
const v031Wishes = {
  hobbies: 'Mini',
  likes: ['books', 'tea', 'wol-ab12'],
  likeDetails: { books: 'Tolkien', 'wol-ab12': 'blauw' },
  pets: ['vogel-cd34', 'other'],
  petsOther: 'konijn',
  petDetails: { 'vogel-cd34': 'parkiet' },
  avoid: 'noten',
  other: '',
};

const v031Answers = {
  hobbies: 'Mini',
  likes: { ticked: ['books', 'tea', 'wol-ab12'], details: { books: 'Tolkien', 'wol-ab12': 'blauw' } },
  pets: { ticked: ['vogel-cd34', 'other'], details: { 'vogel-cd34': 'parkiet', other: 'konijn' } },
  avoid: 'noten',
};

const form = wishForm(v031Event);
const plain = wishForm({});
const shown = (f) => f.questions.filter((q) => q.show).map((q) => q.id).join(' ');

test('readAnswers converts a v0.3.1 row to answers by question id', () => {
  assert.deepEqual(readAnswers(v031Wishes), v031Answers);
  assert.deepEqual(readAnswers({ answers: v031Answers }), v031Answers);
});

test('readAnswers reads empty and malformed rows as no answers', () => {
  assert.deepEqual(readAnswers(null), {});
  assert.deepEqual(readAnswers('junk'), {});
  assert.deepEqual(readAnswers({ hobbies: '', likes: [], likeDetails: {}, pets: [], petsOther: '', avoid: '', other: '' }), {});
  assert.deepEqual(readAnswers({ answers: { a: '', b: 7, c: { ticked: 'x' }, d: { ticked: ['x', 3], details: { x: 'y', z: 4 } } } }),
    { d: { ticked: ['x'], details: { x: 'y' } } });
});

test('a v0.3.1 row gives the same giver lines in both shapes as v0.3.1 did', () => {
  const stored = wishForm({ formConfig: formValue(form) });
  for (const lang of ['nl', 'en']) {
    const before = old.wishLines(v031Wishes, old.wishForm(v031Event), lang);
    assert.ok(before.length > 0);
    assert.deepEqual(wishLines(v031Wishes, form, lang), before);
    assert.deepEqual(wishLines({ answers: readAnswers(v031Wishes) }, form, lang), before);
    assert.deepEqual(wishLines({ answers: readAnswers(v031Wishes) }, stored, lang), before);
  }
});

test('wishLines labels lines by wording in form order and skips hidden and removed choices', () => {
  const wishes = { answers: { q: 'Rood', likes: { ticked: ['wine', 'gone-1234'], details: {} }, hobbies: 'Lezen' } };
  const custom = wishForm({ formConfig: { questions: [
    { id: 'likes', type: 'choices', choices: [{ id: 'wine' }] },
    { id: 'q', type: 'text', text: 'Lievelingskleur?' },
    { id: 'hobbies', type: 'text', show: false },
  ] } });
  assert.deepEqual(wishLines(wishes, custom, 'en'), [
    { label: 'Likes', value: 'Wine' },
    { label: 'Lievelingskleur?', value: 'Rood' },
  ]);
  assert.deepEqual(wishLines(null, custom, 'en'), []);
});

test('the typed animal replaces the label only on the built-in pets question', () => {
  const custom = wishForm({ formConfig: { questions: [
    { id: 'pets', type: 'choices' },
    { id: 'q-ab12', type: 'choices', text: 'Dieren', choices: [{ id: 'other', label: 'Anders', detail: true }] },
  ] } });
  const wishes = { answers: {
    pets: { ticked: ['dog', 'other'], details: { other: 'konijn' } },
    'q-ab12': { ticked: ['other'], details: { other: 'konijn' } },
  } };
  assert.deepEqual(wishLines(wishes, custom, 'nl'), [
    { label: 'Huisdieren', value: 'Hond, konijn' },
    { label: 'Dieren', value: 'Anders (konijn)' },
  ]);
});

test('hasWishes counts shown answered questions, every answer without a form', () => {
  assert.equal(hasWishes(null), false);
  assert.equal(hasWishes({ answers: {} }), false);
  assert.equal(hasWishes({ avoid: 'noten' }), true);
  assert.equal(hasWishes({ avoid: 'noten' }, form), false);
  assert.equal(hasWishes({ answers: { avoid: 'noten' } }, plain), true);
  assert.equal(hasWishes({ answers: { likes: { ticked: ['tea'], details: {} } } }, form), true);
});

const body = (fields, f = form) => ({ questions: shown(f), ...fields });

test('parseWishesForm returns null for a page rendered before questions existed', () => {
  assert.equal(parseWishesForm({ hobbies: 'x' }, form, null), null);
  assert.equal(parseWishesForm({ q_hobbies: 'x', questions: ['a'] }, form, null), null);
});

test('parseWishesForm reads text and ticks by question id', () => {
  const parsed = parseWishesForm(body({
    q_hobbies: '  Mini ',
    q_likes: ['tea', 'caviar', 'books', 'tea'],
    d_likes_books: ' Tolkien ',
    d_likes_tea: 'groen',
    q_pets: 'dog',
    q_other: '',
  }), form, null);
  assert.deepEqual(parsed, { answers: {
    hobbies: 'Mini',
    likes: { ticked: ['tea', 'books'], details: { books: 'Tolkien' } },
    pets: { ticked: ['dog'], details: {} },
  } });
});

test('parseWishesForm caps text at 1000 characters', () => {
  const { answers } = parseWishesForm(body({ q_hobbies: 'a'.repeat(5000), d_likes_books: 'b'.repeat(5000) }), form, null);
  assert.equal(answers.hobbies.length, 1000);
  assert.equal(answers.likes.details.books.length, 1000);
});

test('a filled-in follow-up ticks its box, unless it was unticked with the detail unchanged', () => {
  const ticked = parseWishesForm(body({ d_pets_other: 'konijn' }), form, null);
  assert.deepEqual(ticked.answers.pets, { ticked: ['other'], details: { other: 'konijn' } });
  const unticked = parseWishesForm(body({ d_pets_other: 'konijn', d_likes_books: 'Tolkien' }), form, v031Wishes);
  assert.equal(unticked.answers.pets, undefined);
  assert.equal(unticked.answers.likes, undefined);
  const changed = parseWishesForm(body({ d_likes_books: 'Pratchett' }), form, v031Wishes);
  assert.deepEqual(changed.answers.likes, { ticked: ['books'], details: { books: 'Pratchett' } });
});

test('parseWishesForm keeps the answer of a hidden question', () => {
  const { answers } = parseWishesForm(body({ q_avoid: '', q_hobbies: '' }), form, v031Wishes);
  assert.equal(answers.avoid, 'noten');
  assert.equal(answers.hobbies, undefined);
});

test('parseWishesForm keeps the answer of a question the page did not show', () => {
  const { answers } = parseWishesForm({ questions: 'likes pets', q_likes: 'tea' }, form, { answers: v031Answers });
  assert.equal(answers.hobbies, 'Mini');
  assert.deepEqual(answers.likes, { ticked: ['tea'], details: {} });
  assert.equal(answers.pets, undefined);
});

test('parseWishesForm drops answers to questions no longer in the form', () => {
  const { answers } = parseWishesForm({ questions: 'hobbies', q_hobbies: 'Mini' }, plain, { answers: { 'q-gone': 'x' } });
  assert.deepEqual(answers, { hobbies: 'Mini' });
});

const participants = [
  { wishes: v031Wishes },
  { wishes: { answers: { likes: { ticked: ['tea'], details: {} }, hobbies: 'Lezen' } } },
  { wishes: { answers: { likes: { ticked: [], details: {} } } } },
  { wishes: null },
  { wishes: { hobbies: '', likes: ['wine'] } },
];

test('countAnswers counts old and new rows by question and by ticked choice', () => {
  assert.equal(countAnswers(participants, 'hobbies'), 2);
  assert.equal(countAnswers(participants, 'likes'), 3);
  assert.equal(countAnswers(participants, 'likes', ['tea']), 2);
  assert.equal(countAnswers(participants, 'likes', ['wine', 'wol-ab12']), 2);
  assert.equal(countAnswers(participants, 'likes', ['coffee']), 0);
  assert.equal(countAnswers(participants, 'q-none'), 0);
});

test('dropAnswers removes a whole question', () => {
  const rest = structuredClone(v031Answers);
  delete rest.hobbies;
  assert.deepEqual(dropAnswers(v031Wishes, 'hobbies'), { answers: rest });
  assert.equal(dropAnswers(v031Wishes, 'other'), null);
  assert.equal(dropAnswers(null, 'hobbies'), null);
});

test('dropAnswers removes ticks with their follow-ups and the answer once empty', () => {
  assert.deepEqual(dropAnswers({ answers: v031Answers }, 'likes', ['books', 'coffee']).answers.likes,
    { ticked: ['tea', 'wol-ab12'], details: { 'wol-ab12': 'blauw' } });
  assert.equal(dropAnswers(v031Wishes, 'likes', ['coffee']), null);
  assert.equal(dropAnswers(v031Wishes, 'hobbies', ['coffee']), null);
  const gone = dropAnswers(v031Wishes, 'pets', ['vogel-cd34', 'other']);
  assert.ok(!Object.hasOwn(gone.answers, 'pets'));
});
