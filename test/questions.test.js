import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHOICES_MAX, QUESTIONS_MAX } from '../src/limits.js';
import {
  BUILTIN_QUESTIONS,
  builtinChoiceFor,
  builtinChoiceLabel,
  cleanQuestion,
  detailPrompt,
  formValue,
  isBuiltinLabel,
  isBuiltinText,
  newChoiceId,
  newQuestionId,
  questionText,
  sameForm,
  wishForm,
} from '../src/questions.js';

// An event as v0.3.1 stored it: own like choices, a renamed and a hidden
// section, and an own pet list.
const v031Event = {
  wishOptions: [
    { id: 'tea', label: 'Thee', detail: false },
    { id: 'books', label: 'Boeken', detail: true, question: 'Welke schrijver?' },
    { id: 'wol-ab12', label: 'Wol', detail: true },
  ],
  formConfig: {
    sections: { hobbies: { heading: 'Favoriete auto' }, pets: { show: false } },
    petOptions: [
      { id: 'dog', label: 'Hond', detail: false },
      { id: 'vogel-cd34', label: 'Vogel', detail: true, question: 'Welke soort?' },
      { id: 'other', label: 'Ander dier', detail: true },
    ],
  },
};

const plain = wishForm({});
const byId = (form, id) => form.questions.find((q) => q.id === id);
const shape = (form) => form.questions.map((q) => ({
  id: q.id, type: q.type, text: q.text, show: q.show,
  choices: q.choices.map((c) => ({ id: c.id, own: c.own, detail: c.detail, question: c.question, nl: c.label('nl'), en: c.label('en') })),
}));

test('the limits are 15 questions and 30 choices', () => {
  assert.equal(QUESTIONS_MAX, 15);
  assert.equal(CHOICES_MAX, 30);
});

test('an event without a stored form has the five built-in questions, shown, with built-in wording', () => {
  assert.deepEqual(BUILTIN_QUESTIONS, [
    { id: 'hobbies', type: 'text' },
    { id: 'likes', type: 'choices' },
    { id: 'pets', type: 'choices' },
    { id: 'avoid', type: 'text' },
    { id: 'other', type: 'text' },
  ]);
  assert.deepEqual(plain.questions.map(({ id, type, text, show }) => ({ id, type, text, show })),
    BUILTIN_QUESTIONS.map((q) => ({ ...q, text: null, show: true })));
  assert.deepEqual(byId(plain, 'hobbies').choices, []);
  const likes = byId(plain, 'likes').choices;
  assert.deepEqual(likes.map((c) => c.id), ['chocolate', 'tea', 'coffee', 'bath', 'candles', 'books', 'plants', 'wine']);
  assert.deepEqual(likes.filter((c) => c.detail).map((c) => c.id), ['chocolate']);
  assert.equal(likes[1].own, null);
  assert.equal(likes[1].label('nl'), 'Thee');
  assert.equal(likes[1].label('en'), 'Tea');
  const pets = byId(plain, 'pets').choices;
  assert.deepEqual(pets.map((c) => [c.id, c.detail]), [['dog', false], ['cat', false], ['other', true]]);
});

test('a v0.3.1 event converts to the same questions, wording, show flags and choices', () => {
  const form = wishForm(v031Event);
  assert.deepEqual(form.questions.map((q) => [q.id, q.text, q.show]), [
    ['hobbies', 'Favoriete auto', true],
    ['likes', null, true],
    ['pets', null, false],
    ['avoid', null, true],
    ['other', null, true],
  ]);
  assert.deepEqual(shape(form)[1].choices, [
    { id: 'tea', own: null, detail: false, question: null, nl: 'Thee', en: 'Tea' },
    { id: 'books', own: null, detail: true, question: 'Welke schrijver?', nl: 'Boeken of puzzels', en: 'Books or puzzles' },
    { id: 'wol-ab12', own: 'Wol', detail: true, question: null, nl: 'Wol', en: 'Wol' },
  ]);
  assert.deepEqual(shape(form)[2].choices, [
    { id: 'dog', own: null, detail: false, question: null, nl: 'Hond', en: 'Dog' },
    { id: 'vogel-cd34', own: 'Vogel', detail: true, question: 'Welke soort?', nl: 'Vogel', en: 'Vogel' },
    { id: 'other', own: null, detail: true, question: null, nl: 'Ander dier', en: 'Other' },
  ]);
});

test('the default form is stored as nothing', () => {
  assert.equal(formValue(plain), null);
  assert.equal(formValue(wishForm({ wishOptions: null, formConfig: null })), null);
  assert.equal(formValue(wishForm({ formConfig: formValue(plain) })), null);
});

test('a converted form stored in the new shape reads back the same', () => {
  const form = wishForm(v031Event);
  const stored = formValue(form);
  assert.ok(Array.isArray(stored.questions));
  const back = wishForm({ formConfig: stored });
  assert.ok(sameForm(form, back));
  assert.deepEqual(shape(back), shape(form));
  assert.deepEqual(formValue(back), stored);
});

test('a built-in choice keeps its translations after a round trip', () => {
  const back = wishForm({ formConfig: formValue(wishForm(v031Event)) });
  const tea = byId(back, 'likes').choices.find((c) => c.id === 'tea');
  assert.equal(tea.label('nl'), 'Thee');
  assert.equal(tea.label('en'), 'Tea');
});

test('the stored form wins over wishOptions', () => {
  const formConfig = { questions: [{ id: 'likes', type: 'choices', choices: [{ id: 'wine' }] }] };
  const form = wishForm({ wishOptions: v031Event.wishOptions, formConfig });
  assert.deepEqual(form.questions.map((q) => q.id), ['likes']);
  assert.deepEqual(byId(form, 'likes').choices.map((c) => c.id), ['wine']);
});

test('own text on a built-in choice is shown as typed', () => {
  const formConfig = { questions: [{ id: 'likes', type: 'choices', choices: [{ id: 'tea', label: 'Kruidenthee' }] }] };
  const [tea] = byId(wishForm({ formConfig }), 'likes').choices;
  assert.equal(tea.own, 'Kruidenthee');
  assert.equal(tea.label('en'), 'Kruidenthee');
});

test('a built-in choice question stored without choices gets the built-in ones', () => {
  const form = wishForm({ formConfig: { questions: [{ id: 'pets', type: 'choices' }] } });
  assert.deepEqual(byId(form, 'pets').choices.map((c) => c.id), ['dog', 'cat', 'other']);
});

test('the stored form is read defensively', () => {
  const formConfig = {
    questions: [
      { id: 'hobbies', type: 'choices' },
      { id: 'q-ab12', type: 'text' },
      { id: 'q-cd34', type: 'number', text: 'Hoe oud?' },
      'junk',
      null,
      { id: 'avoid', type: 'text', text: `  ${'x'.repeat(200)}  `, show: 'no' },
      { id: 'avoid', type: 'text', show: false },
      {
        id: 'q-ef56', type: 'choices', text: 'Kleur',
        choices: [{ id: 'rood-1234', label: 'Rood' }, { id: 'tea' }, { id: 'rood-1234', label: 'Ook rood' }, { id: 7 }, 'x'],
      },
    ],
  };
  const form = wishForm({ formConfig });
  assert.deepEqual(form.questions.map((q) => q.id), ['avoid', 'q-ef56']);
  assert.equal(Array.from(byId(form, 'avoid').text).length, 80);
  assert.equal(byId(form, 'avoid').show, true);
  assert.deepEqual(byId(form, 'q-ef56').choices.map((c) => [c.id, c.label('en')]), [['rood-1234', 'Rood']]);
});

test('an empty or unreadable stored list gives the built-in form', () => {
  for (const questions of [[], ['junk'], [{ id: 'q-ab12', type: 'text' }]]) {
    assert.ok(sameForm(wishForm({ formConfig: { questions } }), plain));
  }
  assert.ok(sameForm(wishForm({ formConfig: 'junk' }), plain));
});

// A list from the old event form can hold more choices than the limit,
// which only saving enforces.
test('the stored form is cut at the question limit, its choices are not', () => {
  const choices = Array.from({ length: 40 }, (_, i) => ({ id: `c-${i}`, label: `Keuze ${i}` }));
  const questions = Array.from({ length: 20 }, (_, i) => ({ id: `q-${i}`, type: 'choices', text: `Vraag ${i}`, choices }));
  const form = wishForm({ formConfig: { questions } });
  assert.equal(form.questions.length, QUESTIONS_MAX);
  assert.equal(form.questions[0].choices.length, 40);
});

test('sameForm sees wording, order, show, choices and follow-ups, not the language', () => {
  const base = { questions: [{ id: 'hobbies', type: 'text' }, { id: 'likes', type: 'choices', choices: [{ id: 'tea' }, { id: 'wine' }] }] };
  const read = (changes) => wishForm({ formConfig: { questions: changes(structuredClone(base.questions)) } });
  const same = read((q) => q);
  assert.ok(sameForm(same, read((q) => q)));
  assert.ok(!sameForm(same, read((q) => q.reverse())));
  assert.ok(!sameForm(same, read((q) => { q[0].text = 'Auto'; return q; })));
  assert.ok(!sameForm(same, read((q) => { q[0].show = false; return q; })));
  assert.ok(!sameForm(same, read((q) => { q[1].choices.reverse(); return q; })));
  assert.ok(!sameForm(same, read((q) => { q[1].choices[0].label = 'Groene thee'; return q; })));
  assert.ok(!sameForm(same, read((q) => { q[1].choices[0].detail = true; return q; })));
  assert.ok(!sameForm(same, read((q) => { Object.assign(q[1].choices[0], { detail: true, question: 'Welke?' }); return q; })));
  assert.ok(!sameForm(same, read((q) => q.slice(1))));
});

test('sameForm treats a stored copy of the old shape as no change', () => {
  assert.ok(sameForm(wishForm(v031Event), wishForm({ ...v031Event, wishOptions: structuredClone(v031Event.wishOptions) })));
  const storedDefaults = { wishOptions: [{ id: 'chocolate', label: 'Chocolate', detail: true }, ...plain.questions[1].choices.slice(1).map((c) => ({ id: c.id, label: c.label('en'), detail: false }))] };
  assert.ok(sameForm(wishForm(storedDefaults), plain));
});

test('questionText uses own wording in every language, else the built-in one', () => {
  const hobbies = byId(plain, 'hobbies');
  assert.equal(questionText(hobbies, 'nl'), "Hobby's en interesses");
  assert.equal(questionText(hobbies, 'en'), 'Hobbies and interests');
  assert.equal(questionText(hobbies, 'nl', 'line'), "Hobby's");
  const car = byId(wishForm(v031Event), 'hobbies');
  assert.equal(questionText(car, 'en'), 'Favoriete auto');
  assert.equal(questionText(car, 'en', 'line'), 'Favoriete auto');
});

test('detailPrompt keeps the built-in prompts and the organiser question', () => {
  const likes = byId(plain, 'likes').choices;
  assert.equal(detailPrompt(likes[0], 'en'), 'Which flavour?');
  assert.equal(detailPrompt(byId(plain, 'pets').choices[2], 'nl'), 'Welk dier?');
  const books = byId(wishForm(v031Event), 'likes').choices[1];
  assert.equal(detailPrompt(books, 'en'), 'Welke schrijver?');
  assert.equal(detailPrompt({ id: 'wol-ab12', question: null }, 'nl'), 'Iets in het bijzonder?');
});

test('newQuestionId is unique in the form', () => {
  const id = newQuestionId(plain);
  assert.match(id, /^q-[0-9a-f]{4}$/);
  const ids = new Set();
  let form = plain;
  for (let i = 0; i < 50; i++) {
    const next = newQuestionId(form);
    assert.ok(!ids.has(next));
    ids.add(next);
    form = { questions: [...form.questions, { id: next }] };
  }
});

test('newChoiceId makes a slug of the label with a unique suffix', () => {
  assert.match(newChoiceId('Crème brûlée', new Set()), /^creme-brulee-[0-9a-f]{4}$/);
  assert.match(newChoiceId('!!!', new Set()), /^option-[0-9a-f]{4}$/);
  const taken = new Set();
  for (let i = 0; i < 50; i++) {
    const id = newChoiceId('Wol', taken);
    assert.ok(!taken.has(id));
    taken.add(id);
  }
});

test('cleanQuestion makes one line ending in one question mark, clipped to 80 code points', () => {
  assert.equal(cleanQuestion('  Welke\n  schrijver?? '), 'Welke schrijver?');
  assert.equal(cleanQuestion('???'), null);
  assert.equal(cleanQuestion(''), null);
  assert.equal(cleanQuestion(undefined), null);
  assert.equal(cleanQuestion('x'.repeat(100)), `${'x'.repeat(79)}?`);
});

test('builtinChoiceLabel gives the shipped label of a built-in choice only', () => {
  assert.equal(builtinChoiceLabel('likes', 'tea', 'nl'), 'Thee');
  assert.equal(builtinChoiceLabel('likes', 'tea', 'en'), 'Tea');
  assert.equal(builtinChoiceLabel('pets', 'tea', 'nl'), null);
  assert.equal(builtinChoiceLabel('likes', 'socks-1a2b', 'nl'), null);
});

test('built-in wording and labels are recognised in every language, exactly as shipped', () => {
  assert.equal(isBuiltinText('hobbies', 'Hobbies and interests'), true);
  assert.equal(isBuiltinText('hobbies', "Hobby's en interesses"), true);
  assert.equal(isBuiltinText('hobbies', 'hobbies and interests'), false);
  assert.equal(isBuiltinText('avoid', 'Hobbies and interests'), false);
  assert.equal(isBuiltinLabel('likes', 'tea', 'Thee'), true);
  assert.equal(isBuiltinLabel('likes', 'tea', 'Tea'), true);
  assert.equal(isBuiltinLabel('likes', 'tea', 'tea'), false);
  assert.equal(isBuiltinLabel('likes', 'wol-ab12', 'Wol'), false);
});

test('builtinChoiceFor finds a built-in choice by label in any language and case, once', () => {
  assert.equal(builtinChoiceFor('likes', '  thee ', new Set()), 'tea');
  assert.equal(builtinChoiceFor('likes', 'Tea', new Set()), 'tea');
  assert.equal(builtinChoiceFor('likes', 'Tea', new Set(['tea'])), null);
  assert.equal(builtinChoiceFor('pets', 'Thee', new Set()), null);
  assert.equal(builtinChoiceFor('pets', 'Other', new Set()), 'other');
  assert.equal(builtinChoiceFor('q-1a2b', 'Thee', new Set()), null);
});

test('a stored form is read cleaned as the edit page would save it', () => {
  const form = wishForm({ formConfig: { questions: [
    { id: 'hobbies', type: 'text', text: 'Hobbies and interests' },
    { id: 'likes', type: 'choices', choices: [
      { id: 'tea', label: 'Thee' },
      { id: 'chocolate', detail: true, question: 'Which flavour' },
      { id: 'mix-1a2b', label: '  Boeken  of\npuzzels ', detail: false, question: 'Welke?' },
      { id: 'blank-3c4d', label: '   ' },
    ] },
  ] } });
  const [hobbies, likes] = form.questions;
  assert.equal(hobbies.text, null);
  assert.deepEqual(likes.choices.map((c) => [c.id, c.own, c.detail, c.question]), [
    ['tea', null, false, null],
    ['chocolate', null, true, null],
    ['mix-1a2b', 'Boeken of puzzels', false, null],
  ]);
});
