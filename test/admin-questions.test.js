import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t as tr } from '../src/i18n/index.js';
import { drawFor, saveWishes } from '../src/people.js';
import { SECTION_IDS, wishForm } from '../src/questions.js';
import { aboutBody, makeTestApp, seedGroup, textOf } from './helpers.js';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');

async function setup() {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  const seeded = seedGroup(t.ctx, { names: ['Ada', 'Ben', 'Cor'], opened: true });
  const [ada] = seeded.people;
  return { ...t, clock, ...seeded, ada, eventId: seeded.event.id };
}

const event = (t) => t.ctx.repo.getEvent(t.eventId);
const ids = (t) => wishForm(event(t)).questions.map((q) => q.id);
const question = (t, id) => wishForm(event(t)).questions.find((q) => q.id === id);
const answers = (t, p) => t.ctx.repo.getParticipant(p.id).wishes?.answers ?? {};
const outbox = (t) => t.db.prepare('SELECT count(*) AS n FROM outbox').get().n;
const editUrl = (t, id) => `/admin/events/${t.eventId}/questions/${id}`;

function unescapeHtml(value) {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const attr = (attrs, name) => {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(attrs);
  return match ? unescapeHtml(match[1]) : null;
};

// The fields the form posting to `action` sends as the browser shows it,
// buttons left out: what a press on Save sends without typing anything.
function shownFields(body, action) {
  const form = new RegExp(`<form[^>]*action="${escapeRe(action)}"[^>]*>([\\s\\S]*?)</form>`).exec(body);
  assert.ok(form, `page has a form posting to ${action}`);
  const fields = {};
  for (const [, attrs] of form[1].matchAll(/<input([^>]*)>/g)) {
    const type = attr(attrs, 'type');
    if (type === 'checkbox' && !/\schecked/.test(attrs)) continue;
    fields[attr(attrs, 'name')] = attr(attrs, 'value') ?? '';
  }
  for (const [, name, options] of form[1].matchAll(/<select[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const chosen = /<option value="([^"]*)" selected>/.exec(options) ?? /<option value="([^"]*)"/.exec(options);
    fields[name] = unescapeHtml(chosen[1]);
  }
  return fields;
}

const shownRows = (fields) => Array.from({ length: Number(fields.choiceCount) }, (_, i) => ({
  id: fields[`choice_${i}_id`], label: fields[`choice_${i}_label`],
}));

async function editPage(t, id) {
  const page = await t.adminGet(editUrl(t, id));
  assert.equal(page.statusCode, 200, page.body);
  return { page, fields: shownFields(page.body, editUrl(t, id)) };
}

async function saveShown(t, id, change = {}) {
  const { fields } = await editPage(t, id);
  return t.adminPost(editUrl(t, id), { ...fields, ...change, action: 'save' });
}

async function addQuestion(t, type, fields) {
  const page = await t.adminGet(`/admin/events/${t.eventId}/questions/new?type=${type}`);
  assert.equal(page.statusCode, 200, page.body);
  const shown = shownFields(page.body, `/admin/events/${t.eventId}/questions/new`);
  return t.adminPost(`/admin/events/${t.eventId}/questions/new`, { ...shown, ...fields, action: 'save' });
}

function setQuestions(t, questions) {
  t.ctx.repo.updateEvent(t.eventId, { formConfig: { questions } }, t.ctx.nowIso());
}

const builtIns = () => SECTION_IDS.map((id) => ({ id, type: ['likes', 'pets'].includes(id) ? 'choices' : 'text' }));

test('the event page lists the five built-in questions with their kind and the add buttons', async () => {
  const t = await setup();
  const page = await t.adminGet(`/admin/events/${t.eventId}`);
  assert.equal(page.statusCode, 200);
  const text = unescapeHtml(textOf(page.body));
  assert.ok(page.body.includes('id="form"'));
  assert.ok(text.includes('Het formulier'));
  const positions = SECTION_IDS.map((id) => page.body.indexOf(`href="${editUrl(t, id)}"`));
  assert.ok(positions.every((p) => p > 0), 'an edit link per question');
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'in form order');
  for (const id of SECTION_IDS) assert.ok(text.includes(tr('nl', `wish.${id}`)), id);
  assert.equal(text.split('Tekstvak').length - 1, 3);
  assert.ok(text.includes('Aanvinklijst, 8 keuzes'));
  assert.ok(text.includes('Aanvinklijst, 3 keuzes'));
  assert.equal(text.includes('Verborgen'), false);
  assert.ok(text.includes('Vraag met tekstvak toevoegen'));
  assert.ok(text.includes('Vraag met aanvinklijst toevoegen'));
  const moves = [...page.body.matchAll(/<button type="submit" name="dir" value="(up|down)"([^>]*)>/g)];
  assert.equal(moves.length, 10);
  assert.ok(/disabled/.test(moves[0][2]), 'first question cannot go up');
  assert.ok(/disabled/.test(moves[9][2]), 'last question cannot go down');
  assert.equal(moves.filter((m) => /disabled/.test(m[2])).length, 2);
});

test('the settings form no longer holds the choice lists or section controls', async () => {
  const t = await setup();
  const page = await t.adminGet(`/admin/events/${t.eventId}`);
  for (const name of ['wishOptions', 'petOptions', 'formSections', 'heading_hobbies', 'show_hobbies']) {
    assert.equal(page.body.includes(`name="${name}"`), false, name);
  }
});

test('an added text question is stored last and asked on the participant form', async () => {
  const t = await setup();
  const res = await addQuestion(t, 'text', { text: '  Favoriete\nauto ' });
  assert.equal(res.statusCode, 303, res.body);
  assert.equal(res.headers.location, `/admin/events/${t.eventId}?done=question-added#form`);
  const form = wishForm(event(t));
  const added = form.questions.at(-1);
  assert.deepEqual(form.questions.slice(0, 5).map((q) => q.id), SECTION_IDS);
  assert.equal(added.type, 'text');
  assert.equal(added.text, 'Favoriete auto');
  assert.equal(added.show, true);
  assert.ok(event(t).themeChangedAt, 'printed cards go out of date');
  assert.equal(event(t).wishOptions, null);
  const about = await t.app.inject({ method: 'GET', url: `/p/${t.ada.token}/about` });
  assert.ok(about.body.includes(`name="q_${added.id}"`));
  assert.ok(about.body.includes('Favoriete auto'));
  const done = await t.adminGet(res.headers.location);
  assert.ok(textOf(done.body).includes(tr('nl', 'admin.person.done.question-added')));
});

test('an added question without wording gives a field error and stores nothing', async () => {
  const t = await setup();
  for (const type of ['text', 'choices']) {
    const res = await addQuestion(t, type, { text: '  ', choice_0_label: 'Voetbal' });
    assert.equal(res.statusCode, 400, type);
    assert.ok(textOf(res.body).includes(tr('nl', 'admin.question.error.text')), type);
    assert.ok(res.body.includes('aria-invalid="true"'), type);
  }
  assert.equal(event(t).formConfig, null);
});

test('an added tick list stores its choices with follow-up questions', async () => {
  const t = await setup();
  const res = await addQuestion(t, 'choices', {
    text: 'Sport',
    choiceCount: '3',
    choice_0_label: 'Voetbal', choice_0_follow: 'none', choice_0_question: '',
    choice_1_label: 'Tennis', choice_1_follow: 'own', choice_1_question: ' Welk niveau?? ',
    choice_2_label: 'Iets anders', choice_2_follow: 'general', choice_2_question: '',
  });
  assert.equal(res.statusCode, 303, res.body);
  const added = wishForm(event(t)).questions.at(-1);
  assert.equal(added.type, 'choices');
  assert.deepEqual(added.choices.map((c) => [c.own, c.detail, c.question]), [
    ['Voetbal', false, null], ['Tennis', true, 'Welk niveau?'], ['Iets anders', true, null],
  ]);
  assert.equal(new Set(added.choices.map((c) => c.id)).size, 3);
});

test('a tick list needs at least one choice, and an own choice needs its text', async () => {
  const t = await setup();
  let res = await addQuestion(t, 'choices', { text: 'Sport', choiceCount: '0' });
  assert.equal(res.statusCode, 400);
  assert.ok(textOf(res.body).includes(tr('nl', 'admin.question.error.noChoices')));
  res = await addQuestion(t, 'choices', {
    text: 'Sport', choiceCount: '2', choice_0_label: 'Voetbal', choice_1_label: ' ', choice_1_follow: 'none',
  });
  assert.equal(res.statusCode, 400);
  assert.ok(textOf(res.body).includes(tr('nl', 'admin.question.error.label')));
  assert.ok(res.body.includes('value="Voetbal"'), 'the typed rows stay');
  assert.equal(event(t).formConfig, null);
});

test('a sixteenth question and a thirty-first choice are refused', async () => {
  const t = await setup();
  const extra = Array.from({ length: 10 }, (_, i) => ({ id: `q-${i}`, type: 'text', text: `Vraag ${i}` }));
  setQuestions(t, [...builtIns(), ...extra]);
  const before = event(t).formConfig;
  const page = await t.adminGet(`/admin/events/${t.eventId}`);
  assert.equal(textOf(page.body).includes('Vraag met tekstvak toevoegen'), false);
  assert.ok(textOf(page.body).includes(tr('nl', 'admin.form.full', { max: 15 })));
  const res = await t.adminPost(`/admin/events/${t.eventId}/questions/new`, { type: 'text', text: 'Nog een', action: 'save' });
  assert.equal(res.statusCode, 400);
  assert.ok(textOf(res.body).includes(tr('nl', 'admin.form.full', { max: 15 })));
  assert.deepEqual(event(t).formConfig, before);

  const many = Array.from({ length: 30 }, (_, i) => ({ id: `c-${i}`, label: `Keuze ${i}` }));
  setQuestions(t, [{ id: 'likes', type: 'choices', choices: many }]);
  const stored = event(t).formConfig;
  const { fields } = await editPage(t, 'likes');
  const add = await t.adminPost(editUrl(t, 'likes'), { ...fields, action: 'add-choice' });
  assert.equal(add.statusCode, 400);
  assert.ok(textOf(add.body).includes(tr('nl', 'admin.question.error.tooManyChoices', { max: 30 })));
  assert.equal(shownFields(add.body, editUrl(t, 'likes')).choiceCount, '30');
  const save = await t.adminPost(editUrl(t, 'likes'), {
    ...fields, choiceCount: '31', choice_30_id: '', choice_30_label: 'Te veel', choice_30_follow: 'none', action: 'save',
  });
  assert.equal(save.statusCode, 400);
  assert.deepEqual(event(t).formConfig, stored);
});

test('a stored list past a thousand choices is read in full when a row is removed', async () => {
  const t = await setup();
  const many = Array.from({ length: 1000 }, (_, i) => ({ id: `c-${i}`, label: String(i) }));
  setQuestions(t, [{ id: 'likes', type: 'choices', choices: many }]);
  const stored = event(t).formConfig;
  const { fields } = await editPage(t, 'likes');
  assert.equal(fields.choiceCount, '1000');
  const res = await t.adminPost(editUrl(t, 'likes'), { ...fields, action: 'remove:999' });
  assert.equal(res.statusCode, 200);
  const shown = shownFields(res.body, editUrl(t, 'likes'));
  assert.equal(shown.choiceCount, '999');
  assert.deepEqual(shownRows(shown).map((r) => r.id), many.slice(0, 999).map((c) => c.id));
  assert.deepEqual(event(t).formConfig, stored);
});

test('moving a question reorders the form and marks printed cards out of date', async () => {
  const t = await setup();
  const move = async (id, dir) => {
    const page = await t.adminGet(`/admin/events/${t.eventId}`);
    const fields = shownFields(page.body, `${editUrl(t, id)}/move`);
    return t.adminPost(`${editUrl(t, id)}/move`, { ...fields, dir });
  };
  assert.equal(event(t).themeChangedAt, null);
  const res = await move('likes', 'up');
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/admin/events/${t.eventId}#form`);
  assert.deepEqual(ids(t), ['likes', 'hobbies', 'pets', 'avoid', 'other']);
  const first = event(t).themeChangedAt;
  assert.ok(first);
  t.clock.ms += 60_000;
  await move('likes', 'down');
  assert.deepEqual(ids(t), SECTION_IDS);
  assert.notEqual(event(t).themeChangedAt, first);
  assert.equal(event(t).formConfig, null, 'back to the built-in form');
  const changed = event(t).themeChangedAt;
  t.clock.ms += 60_000;
  await move('hobbies', 'up');
  assert.deepEqual(ids(t), SECTION_IDS, 'the first question stays first');
  assert.equal(event(t).themeChangedAt, changed);
});

test('a double-clicked move moves once', async () => {
  const t = await setup();
  const page = await t.adminGet(`/admin/events/${t.eventId}`);
  const action = `${editUrl(t, 'other')}/move`;
  const fields = { ...shownFields(page.body, action), dir: 'up' };
  await t.adminPost(action, fields);
  const second = await t.adminPost(action, fields);
  assert.equal(second.statusCode, 303);
  assert.deepEqual(ids(t), ['hobbies', 'likes', 'pets', 'other', 'avoid']);
});

test('the edit page of a tick list shows a row per choice with built-in labels as placeholders', async () => {
  const t = await setup();
  const { page, fields } = await editPage(t, 'likes');
  assert.equal(fields.choiceCount, '8');
  assert.equal(fields.show, '1');
  assert.equal(fields.text, '');
  assert.match(page.body, /name="text"[^>]*placeholder="Ik houd van..."/);
  assert.deepEqual(shownRows(fields).map((r) => r.id), ['chocolate', 'tea', 'coffee', 'bath', 'candles', 'books', 'plants', 'wine']);
  assert.match(page.body, /name="choice_1_label"[^>]*placeholder="Thee"/);
  assert.equal(fields.choice_0_follow, 'general');
  assert.equal(fields.choice_1_follow, 'none');
  assert.ok(textOf(page.body).includes('Welke smaak?'), 'the general question of chocolate is named');
  assert.ok(textOf(page.body).includes('Keuze toevoegen'));
  assert.equal(page.body.includes('name="type"'), false, 'the kind cannot be changed');
  assert.ok(textOf(page.body).includes(tr('nl', 'admin.question.delete')));
});

test('row buttons change the draft and keep what was typed, storing nothing', async () => {
  const t = await setup();
  const { fields } = await editPage(t, 'likes');
  const typed = { ...fields, text: 'Waar word je blij van?', choice_1_label: 'Groene thee', choice_1_follow: 'own', choice_1_question: 'Welke smaak' };
  let res = await t.adminPost(editUrl(t, 'likes'), { ...typed, action: 'up:1' });
  assert.equal(res.statusCode, 200);
  let shown = shownFields(res.body, editUrl(t, 'likes'));
  assert.deepEqual(shownRows(shown).slice(0, 2), [{ id: 'tea', label: 'Groene thee' }, { id: 'chocolate', label: '' }]);
  assert.equal(shown.choice_0_follow, 'own');
  assert.equal(shown.choice_0_question, 'Welke smaak');
  assert.equal(shown.text, 'Waar word je blij van?');

  res = await t.adminPost(editUrl(t, 'likes'), { ...shown, action: 'add-choice' });
  shown = shownFields(res.body, editUrl(t, 'likes'));
  assert.equal(shown.choiceCount, '9');
  assert.equal(shown.choice_8_id, '');
  res = await t.adminPost(editUrl(t, 'likes'), { ...shown, action: 'remove:2' });
  shown = shownFields(res.body, editUrl(t, 'likes'));
  assert.equal(shown.choiceCount, '8');
  assert.equal(shownRows(shown).some((r) => r.id === 'coffee'), false);
  res = await t.adminPost(editUrl(t, 'likes'), { ...shown, action: 'down:0' });
  shown = shownFields(res.body, editUrl(t, 'likes'));
  assert.deepEqual(shownRows(shown).slice(0, 2).map((r) => r.id), ['chocolate', 'tea']);
  assert.equal(event(t).formConfig, null);
  assert.equal(event(t).themeChangedAt, null);
});

test('renaming a choice keeps its id and what people ticked', async () => {
  const t = await setup();
  saveWishes(t.ctx, t.ada.id, aboutBody({ q_likes: ['tea', 'books'] }));
  const res = await saveShown(t, 'likes', { choice_1_label: 'Groene thee' });
  assert.equal(res.statusCode, 303, res.body);
  const tea = question(t, 'likes').choices.find((c) => c.id === 'tea');
  assert.equal(tea.own, 'Groene thee');
  assert.equal(question(t, 'likes').choices.find((c) => c.id === 'books').own, null, 'untouched rows keep their translations');
  assert.deepEqual(answers(t, t.ada).likes.ticked, ['tea', 'books']);
  const about = await t.app.inject({ method: 'GET', url: `/p/${t.ada.token}/about` });
  assert.match(about.body, /value="tea" checked[^>]*>[\s\S]{0,80}Groene thee/);
});

test('changing the follow-up or the order of choices keeps their ids and answers', async () => {
  const t = await setup();
  saveWishes(t.ctx, t.ada.id, aboutBody({ q_likes: ['chocolate', 'wine'], d_likes_chocolate: 'Puur' }));
  const { fields } = await editPage(t, 'likes');
  const moved = await t.adminPost(editUrl(t, 'likes'), {
    ...fields, choice_0_follow: 'own', choice_0_question: 'Welk merk', action: 'up:7',
  });
  const res = await t.adminPost(editUrl(t, 'likes'), { ...shownFields(moved.body, editUrl(t, 'likes')), action: 'save' });
  assert.equal(res.statusCode, 303, res.body);
  const likes = question(t, 'likes');
  assert.deepEqual(likes.choices.map((c) => c.id).slice(5), ['books', 'wine', 'plants']);
  assert.equal(likes.choices[0].question, 'Welk merk?');
  assert.deepEqual(answers(t, t.ada).likes, { ticked: ['chocolate', 'wine'], details: { chocolate: 'Puur' } });
});

test('a stored copy of the built-in likes saved unchanged changes nothing', async () => {
  const t = await setup();
  const copy = ['chocolate', 'tea', 'coffee', 'bath', 'candles', 'books', 'plants', 'wine']
    .map((id) => ({ id, label: tr('nl', `wish.like.${id}`), detail: id === 'chocolate' }));
  t.db.prepare('UPDATE events SET wish_options = ? WHERE id = ?').run(JSON.stringify(copy), t.eventId);
  const res = await saveShown(t, 'likes');
  assert.equal(res.statusCode, 303);
  assert.deepEqual(event(t).wishOptions, copy);
  assert.equal(event(t).themeChangedAt, null);
});

test('typing a built-in label or wording keeps it built in', async () => {
  const t = await setup();
  const res = await saveShown(t, 'likes', { text: 'Ik houd van...', choice_1_label: 'Tea' });
  assert.equal(res.statusCode, 303);
  assert.equal(event(t).formConfig, null);
});

test('removing a ticked choice asks first, then drops the ticks without telling the giver', async () => {
  const t = await setup();
  const giver = t.people.find((p) => p.receiverId === t.ada.id);
  drawFor(t.ctx, giver.id);
  saveWishes(t.ctx, t.ada.id, aboutBody({ q_likes: ['tea', 'wine'], q_hobbies: 'Lezen' }));
  t.ctx.repo.updateParticipant(t.ada.id, { notifyGiverDueAt: null });
  const before = t.ctx.repo.getParticipant(t.ada.id);
  const mails = outbox(t);
  t.clock.ms += 60_000;

  const { fields } = await editPage(t, 'likes');
  const removed = await t.adminPost(editUrl(t, 'likes'), { ...fields, action: 'remove:7' });
  const draft = shownFields(removed.body, editUrl(t, 'likes'));
  let res = await t.adminPost(editUrl(t, 'likes'), { ...draft, action: 'save' });
  assert.equal(res.statusCode, 200);
  const text = textOf(res.body);
  assert.ok(text.includes('Wijn'), 'names the choice');
  assert.ok(text.includes(tr('nl', 'admin.question.dropBodyOne', { choices: 'Wijn' })));
  assert.ok(res.body.includes('name="confirmDrop"'));
  // The page opens at the top, so the confirmation with its own save button
  // comes before the fields, and nothing there says the answers stay.
  const block = /<div class="notice warn drop-confirm"[\s\S]*?<\/div>/.exec(res.body);
  assert.ok(block, 'confirmation block');
  assert.ok(res.body.indexOf(block[0]) < res.body.indexOf('id="question-show"'), 'confirmation above the fields');
  assert.ok(textOf(block[0]).includes(tr('nl', 'admin.question.dropNotSaved')));
  assert.match(block[0], /name="confirmDrop"[\s\S]*<button type="submit" name="action" value="save"/);
  assert.ok(!text.includes(tr('nl', 'admin.question.answeredOne')));
  assert.equal(event(t).formConfig, null, 'nothing stored yet');
  assert.deepEqual(answers(t, t.ada).likes.ticked, ['tea', 'wine']);

  res = await t.adminPost(editUrl(t, 'likes'), { ...draft, confirmDrop: '1', action: 'save' });
  assert.equal(res.statusCode, 303, res.body);
  assert.equal(question(t, 'likes').choices.some((c) => c.id === 'wine'), false);
  const after = t.ctx.repo.getParticipant(t.ada.id);
  assert.deepEqual(after.wishes.answers.likes, { ticked: ['tea'], details: {} });
  assert.equal(after.wishes.answers.hobbies, 'Lezen');
  assert.equal(after.wishesUpdatedAt, before.wishesUpdatedAt);
  assert.equal(after.notifyGiverDueAt, null);
  assert.equal(outbox(t), mails);
});

test('removing an unticked choice needs no confirmation', async () => {
  const t = await setup();
  saveWishes(t.ctx, t.ada.id, aboutBody({ q_likes: ['tea'] }));
  const { fields } = await editPage(t, 'likes');
  const removed = await t.adminPost(editUrl(t, 'likes'), { ...fields, action: 'remove:7' });
  const res = await t.adminPost(editUrl(t, 'likes'), { ...shownFields(removed.body, editUrl(t, 'likes')), action: 'save' });
  assert.equal(res.statusCode, 303);
  assert.equal(question(t, 'likes').choices.length, 7);
});

test('the edit page says how many answered, and deleting the question removes those answers', async () => {
  const t = await setup();
  const [, ben] = t.people;
  saveWishes(t.ctx, t.ada.id, aboutBody({ q_hobbies: 'Lezen', q_avoid: 'Noten' }));
  const { page } = await editPage(t, 'hobbies');
  assert.ok(textOf(page.body).includes(tr('nl', 'admin.question.answeredOne')));
  assert.ok(textOf(page.body).includes(tr('nl', 'admin.question.deleteAnswersOne')));
  saveWishes(t.ctx, ben.id, aboutBody({ q_hobbies: 'Fietsen' }));
  const two = await t.adminGet(editUrl(t, 'hobbies'));
  assert.ok(textOf(two.body).includes(tr('nl', 'admin.question.answered', { count: 2 })));

  const refused = await t.adminPost(`${editUrl(t, 'hobbies')}/delete`, {});
  assert.equal(refused.statusCode, 400);
  assert.deepEqual(ids(t), SECTION_IDS);
  const res = await t.adminPost(`${editUrl(t, 'hobbies')}/delete`, { confirm: '1' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/admin/events/${t.eventId}?done=question-removed#form`);
  assert.deepEqual(ids(t), ['likes', 'pets', 'avoid', 'other']);
  assert.deepEqual(answers(t, t.ada), { avoid: 'Noten' });
  assert.deepEqual(answers(t, ben), {});
  const gone = await t.adminGet(editUrl(t, 'hobbies'));
  assert.equal(gone.statusCode, 404);
});

test('deleting a question twice with the same form, as after a double click, deletes it once', async () => {
  const t = await setup();
  const { page } = await editPage(t, 'hobbies');
  const form = new RegExp(`<form[^>]*action="${escapeRe(`${editUrl(t, 'hobbies')}/delete`)}"[^>]*>([\\s\\S]*?)</form>`).exec(page.body);
  const token = /name="formToken" value="([^"]+)"/.exec(form?.[1] ?? '');
  assert.ok(token, 'the delete form carries a form token');
  const post = { confirm: '1', formToken: token[1] };
  const first = await t.adminPost(`${editUrl(t, 'hobbies')}/delete`, post);
  const again = await t.adminPost(`${editUrl(t, 'hobbies')}/delete`, post);
  assert.equal(first.statusCode, 303);
  assert.equal(again.statusCode, 303);
  assert.equal(again.headers.location, first.headers.location);
  assert.deepEqual(ids(t), ['likes', 'pets', 'avoid', 'other']);
});

test('a follow-up typed as the built-in one stays built in, so it follows the reader', async () => {
  const t = await setup();
  const { fields } = await editPage(t, 'likes');
  const rows = shownRows(fields);
  const at = (id) => rows.findIndex((r) => r.id === id);
  const res = await t.adminPost(editUrl(t, 'likes'), {
    ...fields,
    [`choice_${at('chocolate')}_follow`]: 'own', [`choice_${at('chocolate')}_question`]: 'which flavour',
    [`choice_${at('wine')}_follow`]: 'own', [`choice_${at('wine')}_question`]: 'Iets in het bijzonder??',
    [`choice_${at('tea')}_follow`]: 'own', [`choice_${at('tea')}_question`]: 'Welke smaak?',
    action: 'save',
  });
  assert.equal(res.statusCode, 303);
  const choice = (id) => question(t, 'likes').choices.find((c) => c.id === id);
  assert.deepEqual([choice('chocolate').detail, choice('chocolate').question], [true, null]);
  assert.deepEqual([choice('wine').detail, choice('wine').question], [true, null]);
  assert.deepEqual([choice('tea').detail, choice('tea').question], [true, 'Welke smaak?'], 'another choice\'s prompt is own text');
  const again = await editPage(t, 'likes');
  assert.equal(again.fields[`choice_${at('chocolate')}_follow`], 'general');
});

test('the only question left cannot be deleted', async () => {
  const t = await setup();
  setQuestions(t, [{ id: 'other', type: 'text' }]);
  const { page } = await editPage(t, 'other');
  assert.ok(textOf(page.body).includes(tr('nl', 'admin.question.deleteLast')));
  assert.equal(page.body.includes(`action="${editUrl(t, 'other')}/delete"`), false);
  const res = await t.adminPost(`${editUrl(t, 'other')}/delete`, { confirm: '1' });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(ids(t), ['other']);
});

test('hiding a question keeps its answers and shows it as hidden in the list', async () => {
  const t = await setup();
  saveWishes(t.ctx, t.ada.id, aboutBody({ q_avoid: 'Noten' }));
  const { fields } = await editPage(t, 'avoid');
  delete fields.show;
  const res = await t.adminPost(editUrl(t, 'avoid'), { ...fields, action: 'save' });
  assert.equal(res.statusCode, 303);
  assert.equal(question(t, 'avoid').show, false);
  assert.equal(answers(t, t.ada).avoid, 'Noten');
  const page = await t.adminGet(`/admin/events/${t.eventId}`);
  assert.ok(textOf(page.body).includes('Verborgen'));
});

// A v0.3.1 event: own likes with a question, a renamed and a hidden section,
// and its own pet list.
function storeV031(t) {
  const likes = [
    { id: 'tea', label: 'Thee', detail: false },
    { id: 'books-1a2b', label: 'Boeken', detail: true, question: 'Welke schrijver?' },
    // The built-in follow-up stored as typed, a label past HEADING_MAX and
    // doubled spaces: the edit page saves each of them cleaned.
    { id: 'chocolate', label: 'Chocolade', detail: true, question: 'Welke smaak?' },
    { id: 'long-3c4d', label: 'L'.repeat(120), detail: false },
    { id: 'puzzles-5e6f', label: 'Boeken  of  puzzels', detail: false },
  ];
  const config = {
    sections: { hobbies: { heading: 'Favoriete auto' }, pets: { show: false } },
    petOptions: [{ id: 'dog', label: 'Hond', detail: false }, { id: 'bird-77aa', label: 'Vogel', detail: true }],
  };
  t.db.prepare('UPDATE events SET wish_options = ?, form_config = ?, theme_changed_at = ? WHERE id = ?')
    .run(JSON.stringify(likes), JSON.stringify(config), '2026-10-01T10:00:00.000Z', t.eventId);
}

test('saving every edit page and the settings form unchanged on a v0.3.1 event changes nothing', async () => {
  const t = await setup();
  storeV031(t);
  const stored = event(t);
  for (const id of SECTION_IDS) {
    const res = await saveShown(t, id);
    assert.equal(res.statusCode, 303, `${id}: ${res.body}`);
  }
  const page = await t.adminGet(`/admin/events/${t.eventId}`);
  const settings = shownFields(page.body, `/admin/events/${t.eventId}`);
  settings.themeText = unescapeHtml(/name="themeText"[^>]*>([^<]*)<\/textarea>/.exec(page.body)[1]);
  assert.equal((await t.adminPost(`/admin/events/${t.eventId}`, settings)).statusCode, 303);
  const after = event(t);
  assert.deepEqual(after.formConfig, stored.formConfig);
  assert.deepEqual(after.wishOptions, stored.wishOptions);
  assert.equal(after.themeChangedAt, '2026-10-01T10:00:00.000Z');
});

test('the first real change to a v0.3.1 event stores the new shape and keeps the rest of the form', async () => {
  const t = await setup();
  storeV031(t);
  const before = wishForm(event(t));
  const res = await saveShown(t, 'avoid', { text: 'Liever niet' });
  assert.equal(res.statusCode, 303);
  const after = event(t);
  assert.equal(after.wishOptions, null);
  assert.ok(Array.isArray(after.formConfig.questions));
  const form = wishForm(after);
  assert.equal(form.questions.find((q) => q.id === 'avoid').text, 'Liever niet');
  for (const id of ['hobbies', 'likes', 'pets', 'other']) {
    const [a, b] = [before, form].map((f) => f.questions.find((q) => q.id === id));
    assert.deepEqual([b.text, b.show, b.choices.map((c) => [c.id, c.own, c.detail, c.question])],
      [a.text, a.show, a.choices.map((c) => [c.id, c.own, c.detail, c.question])], id);
  }
});

test('a double-submitted new question is added once', async () => {
  const t = await setup();
  const page = await t.adminGet(`/admin/events/${t.eventId}/questions/new?type=text`);
  const fields = { ...shownFields(page.body, `/admin/events/${t.eventId}/questions/new`), text: 'Favoriete auto', action: 'save' };
  const first = await t.adminPost(`/admin/events/${t.eventId}/questions/new`, fields);
  const second = await t.adminPost(`/admin/events/${t.eventId}/questions/new`, fields);
  assert.equal(first.statusCode, 303);
  assert.equal(second.statusCode, 303);
  assert.equal(second.headers.location, first.headers.location);
  assert.equal(ids(t).length, 6);
});

test('posting a type does not change the kind of a question', async () => {
  const t = await setup();
  const { fields } = await editPage(t, 'hobbies');
  let res = await t.adminPost(editUrl(t, 'hobbies'), {
    ...fields, type: 'choices', choiceCount: '1', choice_0_label: 'Lezen', action: 'save',
  });
  assert.equal(res.statusCode, 303);
  assert.equal(question(t, 'hobbies').type, 'text');
  res = await saveShown(t, 'likes', { type: 'text' });
  assert.equal(res.statusCode, 303);
  assert.equal(question(t, 'likes').type, 'choices');
  const bad = await t.adminGet(`/admin/events/${t.eventId}/questions/new?type=date`);
  assert.equal(bad.statusCode, 400);
});

test('unknown questions give the not-found page', async () => {
  const t = await setup();
  for (const url of [editUrl(t, 'nope'), `/admin/events/999/questions/hobbies`]) {
    assert.equal((await t.adminGet(url)).statusCode, 404, url);
  }
  assert.equal((await t.adminPost(`${editUrl(t, 'nope')}/move`, { dir: 'up' })).statusCode, 404);
  assert.equal((await t.adminPost(`${editUrl(t, 'nope')}/delete`, { confirm: '1' })).statusCode, 404);
});

test('question changes are logged with the event and question', async () => {
  const t = await setup();
  await addQuestion(t, 'text', { text: 'Favoriete auto' });
  const added = ids(t).at(-1);
  await saveShown(t, added, { text: 'Favoriete fiets' });
  const page = await t.adminGet(`/admin/events/${t.eventId}`);
  await t.adminPost(`${editUrl(t, added)}/move`, { ...shownFields(page.body, `${editUrl(t, added)}/move`), dir: 'up' });
  await t.adminPost(`${editUrl(t, added)}/delete`, { confirm: '1' });
  const lines = t.logs.map((l) => JSON.parse(l));
  for (const msg of ['question_added', 'question_saved', 'question_moved', 'question_removed']) {
    const line = lines.find((l) => l.msg === msg);
    assert.ok(line, msg);
    assert.equal(line.event_id, t.eventId, msg);
    assert.equal(line.question_id, added, msg);
  }
  assert.equal(lines.find((l) => l.msg === 'question_removed').answers_dropped, 0);
  assert.equal(t.logs.join('').includes('Favoriete'), false, 'no typed text in the log');
});

function cardWatch(t) {
  drawFor(t.ctx, t.ada.id);
  return {
    outOfDate: async () => (await t.adminGet(`/admin/groups/${t.group.id}`)).body.includes('Opnieuw printen'),
    print() {
      t.clock.ms += 60_000;
      t.ctx.repo.updateParticipant(t.ada.id, { printedAt: t.ctx.nowIso() });
      t.clock.ms += 60_000;
    },
  };
}

test('a printed card goes out of date when a question changes, not on an unchanged save', async () => {
  const t = await setup();
  const card = cardWatch(t);
  const hide = (fields) => {
    const out = { ...fields };
    delete out.show;
    return out;
  };
  for (const [what, id, change] of [
    ['hidden', 'other', hide], ['wording', 'avoid', (f) => ({ ...f, text: 'Nee' })],
    ['renamed choice', 'likes', (f) => ({ ...f, choice_1_label: 'Zeep' })],
  ]) {
    card.print();
    const { fields } = await editPage(t, id);
    await t.adminPost(editUrl(t, id), { ...change(fields), action: 'save' });
    assert.equal(await card.outOfDate(), true, what);
    card.print();
    await saveShown(t, id);
    assert.equal(await card.outOfDate(), false, `${what}, saved again`);
  }
});

test('changing the event language changes nothing on the form, and saving it again is no change', async () => {
  const t = await setup();
  const card = cardWatch(t);
  await saveShown(t, 'likes', { choice_1_label: 'Zeep' });
  const page = await t.adminGet(`/admin/events/${t.eventId}`);
  const settings = { ...shownFields(page.body, `/admin/events/${t.eventId}`), language: 'en', themeText: '' };
  await t.adminPost(`/admin/events/${t.eventId}`, settings);
  card.print();
  const { page: edit } = await editPage(t, 'likes');
  assert.match(edit.body, /name="choice_0_label"[^>]*placeholder="Chocolade"/, 'placeholders follow the organiser');
  await saveShown(t, 'likes');
  assert.equal(await card.outOfDate(), false);
});

test('the English edit page and list speak English', async () => {
  const t = await setup();
  const cookie = `${t.adminCookie()}; giftdraw_lang=en`;
  const page = await t.adminGet(`/admin/events/${t.eventId}`, { cookie });
  assert.ok(textOf(page.body).includes('The form'));
  assert.ok(textOf(page.body).includes('Tick list, 8 choices'));
  const edit = await t.adminGet(editUrl(t, 'likes'), { cookie });
  assert.match(edit.body, /name="choice_1_label"[^>]*placeholder="Tea"/);
});

test('switching the organiser language on an edit page comes back to it', async () => {
  const t = await setup();
  const back = (path) => t.adminPost('/admin/lang', { lang: 'en' }, { referer: `https://gifts.example.com${path}` });
  assert.equal((await back(editUrl(t, 'likes'))).headers.location, editUrl(t, 'likes'));
  assert.equal((await back(`${editUrl(t, 'likes')}/move`)).headers.location, editUrl(t, 'likes'));
  assert.equal((await back(`/admin/events/${t.eventId}/questions/new`)).headers.location, `/admin/events/${t.eventId}`);
});

test('a follow-up switched to none is not shown or counted, and comes back when switched on again', async () => {
  const t = await setup();
  const giver = t.people.find((p) => p.receiverId === t.ada.id);
  drawFor(t.ctx, giver.id);
  saveWishes(t.ctx, t.ada.id, aboutBody({ q_likes: ['chocolate', 'tea'], d_likes_chocolate: 'Puur' }));
  t.ctx.repo.updateParticipant(t.ada.id, { notifyGiverDueAt: null });
  const before = t.ctx.repo.getParticipant(t.ada.id);
  const giverPage = async () => textOf((await t.app.inject({ method: 'GET', url: `/p/${giver.token}` })).body);
  assert.ok((await giverPage()).includes('Puur'));

  assert.equal((await saveShown(t, 'likes', { choice_0_follow: 'none' })).statusCode, 303);
  assert.equal((await giverPage()).includes('Puur'), false, 'the giver no longer sees it');
  const card = await t.adminGet(`/admin/participants/${giver.id}/card`);
  assert.equal(card.body.includes('Puur'), false, 'nor on the card');

  t.clock.ms += 60_000;
  await t.post(`/p/${t.ada.token}/about`, aboutBody({ q_likes: ['chocolate', 'tea'] }));
  let after = t.ctx.repo.getParticipant(t.ada.id);
  assert.equal(after.wishesUpdatedAt, before.wishesUpdatedAt, 'an unchanged save is no change');
  assert.equal(after.notifyGiverDueAt, null);
  await t.post(`/p/${t.ada.token}/about`, aboutBody({ q_likes: ['chocolate', 'tea'], q_hobbies: 'Lezen' }));
  after = t.ctx.repo.getParticipant(t.ada.id);
  assert.deepEqual(after.wishes.answers.likes.details, { chocolate: 'Puur' }, 'the text is kept');

  await saveShown(t, 'likes', { choice_0_follow: 'general' });
  assert.ok((await giverPage()).includes('Puur'), 'switched on again, it is back');
});

test('an own follow-up without its question gives a field error and stores nothing', async () => {
  const t = await setup();
  const res = await saveShown(t, 'likes', { choice_1_follow: 'own', choice_1_question: ' ?? ' });
  assert.equal(res.statusCode, 400);
  assert.ok(textOf(res.body).includes(tr('nl', 'admin.question.error.ownQuestion')));
  assert.match(res.body, /id="choice-1-question"[^>]*aria-invalid="true"/);
  assert.equal(event(t).formConfig, null);
});

test('an own follow-up as long as the field allows is stored whole', async () => {
  const t = await setup();
  const { page } = await editPage(t, 'likes');
  const max = Number(/id="choice-0-question"[^>]*maxlength="(\d+)"/.exec(page.body)[1]);
  const typed = 'x'.repeat(max);
  await saveShown(t, 'likes', { choice_1_follow: 'own', choice_1_question: typed });
  const stored = question(t, 'likes').choices.find((c) => c.id === 'tea').question;
  assert.equal(stored, `${typed}?`);
  assert.equal(Array.from(stored).length, 80);
});

test('removing a choice counts a follow-up typed without its tick', async () => {
  const t = await setup();
  t.ctx.repo.updateParticipant(t.ada.id, { wishes: { answers: { likes: { ticked: [], details: { chocolate: 'Puur' } } } } });
  const { fields } = await editPage(t, 'likes');
  const removed = await t.adminPost(editUrl(t, 'likes'), { ...fields, action: 'remove:0' });
  const res = await t.adminPost(editUrl(t, 'likes'), { ...shownFields(removed.body, editUrl(t, 'likes')), action: 'save' });
  assert.equal(res.statusCode, 200);
  assert.ok(textOf(res.body).includes(tr('nl', 'admin.question.dropBodyOne', { choices: 'Chocolade' })));
  assert.equal(event(t).formConfig, null);
});

// The old event form limited a tick list only by its total text, so a
// v0.3.1 list can hold more choices than the edit page lets anyone add.
function storeLongV031(t) {
  const likes = Array.from({ length: 35 }, (_, i) => ({ id: `keuze-${i + 1}-aa00`, label: `Keuze ${i + 1}`, detail: false }));
  t.db.prepare('UPDATE events SET wish_options = ?, theme_changed_at = ? WHERE id = ?')
    .run(JSON.stringify(likes), '2026-10-01T10:00:00.000Z', t.eventId);
}

async function tickedLongChoice(t) {
  storeLongV031(t);
  const giver = t.people.find((p) => p.receiverId === t.ada.id);
  drawFor(t.ctx, giver.id);
  saveWishes(t.ctx, t.ada.id, aboutBody({ q_likes: ['keuze-33-aa00'] }));
  t.ctx.repo.updateParticipant(t.ada.id, { notifyGiverDueAt: null });
  return async () => textOf((await t.app.inject({ method: 'GET', url: `/p/${giver.token}` })).body);
}

test('an old tick list past the choice limit keeps every choice when another question is saved', async () => {
  const t = await setup();
  const giverPage = await tickedLongChoice(t);
  assert.ok((await giverPage()).includes('Keuze 33'));

  assert.equal((await saveShown(t, 'avoid', { text: 'Liever niet' })).statusCode, 303);
  assert.ok(Array.isArray(event(t).formConfig.questions), 'stored in the new shape');
  assert.equal(question(t, 'likes').choices.length, 35);
  assert.deepEqual(answers(t, t.ada).likes.ticked, ['keuze-33-aa00']);
  assert.ok((await giverPage()).includes('Keuze 33'), 'the giver still sees the tick');

  // Saved again unchanged, the new shape reads the same and stores nothing.
  const stored = event(t);
  assert.equal((await saveShown(t, 'avoid')).statusCode, 303);
  assert.deepEqual(event(t).formConfig, stored.formConfig);
  assert.equal(event(t).themeChangedAt, stored.themeChangedAt);
});

test('the edit page shows every choice of an old long list and saves once at most the limit remain', async () => {
  const t = await setup();
  await tickedLongChoice(t);
  let { page, fields } = await editPage(t, 'likes');
  assert.equal(shownRows(fields).length, 35);
  assert.ok(textOf(page.body).includes('Keuze 35'));

  let res = await t.adminPost(editUrl(t, 'likes'), { ...fields, action: 'save' });
  assert.equal(res.statusCode, 400);
  assert.ok(textOf(res.body).includes(tr('nl', 'admin.question.error.tooManyChoices', { max: 30 })));
  assert.equal(event(t).formConfig, null, 'nothing stored');
  assert.equal(event(t).themeChangedAt, '2026-10-01T10:00:00.000Z');

  // The last five rows go one press at a time, the ticked 33rd among them.
  for (let i = 0; i < 5; i += 1) {
    res = await t.adminPost(editUrl(t, 'likes'), { ...fields, action: 'remove:30' });
    assert.equal(res.statusCode, 200);
    fields = shownFields(res.body, editUrl(t, 'likes'));
    assert.equal(shownRows(fields).length, 34 - i);
  }
  assert.deepEqual(shownRows(fields).map((r) => r.label), Array.from({ length: 30 }, (_, i) => `Keuze ${i + 1}`));
  res = await t.adminPost(editUrl(t, 'likes'), { ...fields, action: 'save' });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('name="confirmDrop"'), 'the ticked choice asks first');
  res = await t.adminPost(editUrl(t, 'likes'), { ...fields, confirmDrop: '1', action: 'save' });
  assert.equal(res.statusCode, 303, res.body);
  assert.equal(question(t, 'likes').choices.length, 30);
  assert.deepEqual(answers(t, t.ada).likes?.ticked ?? [], []);
});
