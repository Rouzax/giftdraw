import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasWishes, parseWishesForm, wishLines } from '../src/answers.js';
import {
  cleanHeading, detailPrompt, endsInMark, questionText, sameForm, SECTION_IDS, wishForm,
} from '../src/questions.js';

const plain = wishForm({});
const withConfig = (formConfig) => wishForm({ formConfig });

test('sections come in their fixed order, all shown with the built-in heading by default', () => {
  assert.deepEqual(SECTION_IDS, ['hobbies', 'likes', 'pets', 'avoid', 'other']);
  assert.deepEqual(plain.questions.map((q) => [q.id, q.show, q.text]), SECTION_IDS.map((id) => [id, true, null]));
  assert.equal(questionText(plain.questions[0], 'nl'), "Hobby's en interesses");
  assert.equal(questionText(plain.questions[0], 'en'), 'Hobbies and interests');
});

test('a heading override is shown as typed in every language', () => {
  const form = withConfig({ sections: { pets: { show: true, heading: 'Dieren thuis' } } });
  const pets = form.questions.find((q) => q.id === 'pets');
  assert.equal(questionText(pets, 'nl'), 'Dieren thuis');
  assert.equal(questionText(pets, 'en'), 'Dieren thuis');
});

test('an old form config is read past unknown keys and bad values', () => {
  const form = withConfig({
    sections: { hobbies: { show: false, heading: 'x'.repeat(200) }, colour: { show: false }, likes: { show: 'no', heading: 7 } },
    petOptions: [{ id: 'bird-ab12', label: 'Vogel', detail: true, question: 'Welke?' }, { id: 3 }, 'junk'],
    extra: 1,
  });
  assert.deepEqual(form.questions.map((q) => q.id), SECTION_IDS);
  const [hobbies, likes, pets] = form.questions;
  assert.equal(hobbies.show, false);
  assert.equal(Array.from(hobbies.text).length, 80);
  assert.deepEqual([likes.show, likes.text], [true, null]);
  assert.deepEqual(pets.choices.map((c) => [c.id, c.own, c.detail, c.question]), [['bird-ab12', 'Vogel', true, 'Welke?']]);
  assert.ok(sameForm(withConfig(null), plain));
  assert.ok(sameForm(withConfig('junk'), plain));
});

test('cleanHeading makes one line of at most 80 characters, empty is null', () => {
  assert.equal(cleanHeading('  Wat ik\nleuk vind  '), 'Wat ik leuk vind');
  assert.equal(cleanHeading('   '), null);
  assert.equal(cleanHeading(undefined), null);
  assert.equal(Array.from(cleanHeading(`${'a'.repeat(79)}\u{1F600}bbb`)).length, 80);
});

test('the built-in pet list is dog, cat and other with the which-animal question', () => {
  const pets = plain.questions.find((q) => q.id === 'pets').choices;
  assert.deepEqual(pets.map((o) => o.id), ['dog', 'cat', 'other']);
  assert.deepEqual(pets.map((o) => o.detail), [false, false, true]);
  assert.equal(pets[2].label('nl'), 'Ander dier');
  assert.equal(detailPrompt(pets[2], 'nl'), 'Welk dier?');
  assert.equal(detailPrompt(pets[2], 'en'), 'Which animal?');
});

test('old stored pets and other-pet text read and render as before', () => {
  const stored = { hobbies: '', likes: [], likeDetails: {}, pets: ['dog', 'other'], petsOther: 'konijn', avoid: '', other: '' };
  assert.deepEqual(wishLines(stored, plain, 'nl'), [{ label: 'Huisdieren', value: 'Hond, konijn' }]);
  assert.deepEqual(wishLines({ ...stored, petsOther: '' }, plain, 'en'), [{ label: 'Pets', value: 'Dog, Other' }]);
});

test('the other-pet field names the animal, a custom pet detail follows its label', () => {
  const bird = 'vogel-ab12';
  const pets = [
    { id: 'dog', label: 'Hond', detail: false }, { id: bird, label: 'Vogel', detail: true, question: 'Welke soort?' },
    { id: 'other', label: 'Ander dier', detail: true },
  ];
  const form = withConfig({ petOptions: pets });
  const wishes = parseWishesForm({ questions: 'pets', d_pets_other: 'konijn', [`d_pets_${bird}`]: 'parkiet' }, form);
  assert.deepEqual(wishes.answers.pets, { ticked: [bird, 'other'], details: { [bird]: 'parkiet', other: 'konijn' } });
  assert.deepEqual(wishLines(wishes, form, 'nl'), [{ label: 'Huisdieren', value: 'Vogel (parkiet), konijn' }]);
});

test('a hidden section is left out of the lines and its heading override is used', () => {
  const wishes = { answers: { hobbies: 'tuinieren', likes: { ticked: ['tea'], details: {} }, avoid: 'noten' } };
  const form = withConfig({ sections: { hobbies: { show: false }, likes: { show: true, heading: 'Lekker' } } });
  assert.deepEqual(wishLines(wishes, form, 'en'), [
    { label: 'Lekker', value: 'Tea' },
    { label: 'Rather not', value: 'noten' },
  ]);
  const none = withConfig({ sections: Object.fromEntries(SECTION_IDS.map((id) => [id, { show: false }])) });
  assert.deepEqual(wishLines(wishes, none, 'nl'), []);
});

test('a heading that ends in a question mark or other mark gets no extra colon', async () => {
  assert.equal(endsInMark('Waar word je blij van?'), true);
  assert.equal(endsInMark('Lekker...'), true);
  assert.equal(endsInMark('Houdt van'), false);
  const { renderEmail } = await import('../src/mail/templates.js');
  const mail = renderEmail('wishes-updated', {
    lang: 'nl',
    participant: { name: 'Ada' },
    receiver: { name: 'Ben', wishes: { likes: ['tea'] } },
    event: { language: 'nl', formConfig: { sections: { likes: { heading: 'Waar word je blij van?' } } } },
    group: { exchangeDate: '2026-12-18' },
    link: 'https://gifts.example.com/p/x',
    tz: 'Europe/Amsterdam',
  });
  assert.ok(mail.text.includes('- Waar word je blij van? Thee'));
  assert.ok(mail.html.includes('<strong>Waar word je blij van?</strong> Thee'));
  const { cardView, resultView } = await import('../src/views/participant.js');
  const data = {
    participant: { name: 'Ada', wishes: null }, receiver: { name: 'Ben', wishes: { likes: ['tea'] } },
    event: { language: 'nl', formConfig: { sections: { likes: { heading: 'Waar word je blij van?' } } } },
    group: { exchangeDate: '2026-12-18' }, lang: 'nl', tz: 'Europe/Amsterdam', editHref: '/x',
  };
  for (const view of [cardView(data), resultView({ ...data, reveal: false })]) {
    assert.ok(String(view.body).includes('<dt class="ends-in-mark">Waar word je blij van?</dt>'));
  }
});

test('hasWishes counts only answers in shown sections', () => {
  const wishes = { hobbies: 'tuinieren', pets: ['dog'] };
  assert.equal(hasWishes(wishes), true);
  assert.equal(hasWishes(wishes, plain), true);
  assert.equal(hasWishes(wishes, withConfig({ sections: { hobbies: { show: false }, pets: { show: false } } })), false);
  assert.equal(hasWishes(wishes, withConfig({ sections: { hobbies: { show: false } } })), true);
});

test('no wish reminder when no section is shown, and one when only hidden sections are filled in', async () => {
  const { reminderKind } = await import('../src/reminders.js');
  const person = { wishes: parseWishesForm({ questions: 'hobbies', q_hobbies: 'tuinieren' }, plain), drawnAt: null };
  const closed = { openedAt: null };
  const allHidden = withConfig({ sections: Object.fromEntries(SECTION_IDS.map((id) => [id, { show: false }])) });
  assert.equal(reminderKind({ ...person, wishes: null }, closed, allHidden), null);
  assert.equal(reminderKind(person, closed, withConfig({ sections: { hobbies: { show: false } } })), 'remind-wishes');
  assert.equal(reminderKind(person, closed, plain), null);
  assert.equal(reminderKind(person, { openedAt: '2026-11-20T15:00:00.000Z' }, allHidden), 'remind-draw');
});
