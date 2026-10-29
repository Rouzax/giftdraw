import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEmail } from '../src/mail/templates.js';
import { drawFor, saveWishes } from '../src/people.js';
import { SECTION_IDS } from '../src/questions.js';
import { t as tr } from '../src/i18n/index.js';
import { aboutBody, makeTestApp, seedGroup, textOf } from './helpers.js';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');

async function setup() {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  const seeded = seedGroup(t.ctx, { names: ['Ada', 'Ben', 'Cor'], opened: true });
  const [ada] = seeded.people;
  const receiver = t.ctx.repo.getParticipant(ada.receiverId);
  return { ...t, clock, ...seeded, ada, receiver, eventId: seeded.event.id };
}

const BIRD = 'bird-1a2b';
const PETS = [{ id: 'dog' }, { id: BIRD, label: 'Vogel', detail: true, question: 'Welke soort?' }, { id: 'other', detail: true }];

// Stores the built-in questions with some hidden, some reworded and,
// optionally, an own pet list.
function setForm(t, { hidden = [], headings = {}, pets = null } = {}) {
  const questions = SECTION_IDS.map((id) => {
    const q = { id, type: ['likes', 'pets'].includes(id) ? 'choices' : 'text' };
    if (hidden.includes(id)) q.show = false;
    if (headings[id]) q.text = headings[id];
    if (id === 'pets' && pets) q.choices = pets;
    return q;
  });
  t.ctx.repo.updateEvent(t.eventId, { formConfig: { questions } }, t.ctx.nowIso());
}

const event = (t) => t.ctx.repo.getEvent(t.eventId);

function configure(t) {
  setForm(t, { hidden: ['hobbies'], headings: { likes: 'Lekker en leuk' }, pets: PETS });
  return BIRD;
}

test('the about form leaves out a hidden section and shows the heading override and custom pets', async () => {
  const t = await setup();
  const bird = configure(t);
  for (const url of [`/p/${t.ada.token}/about`, `/admin/participants/${t.ada.id}/about`]) {
    const page = await t.adminGet(url);
    assert.equal(page.statusCode, 200, url);
    assert.equal(page.body.includes('name="q_hobbies"'), false, url);
    assert.ok(page.body.includes('Lekker en leuk'), url);
    assert.ok(page.body.includes(`id="c_pets_${bird}"`), url);
    assert.ok(page.body.includes(`name="d_pets_${bird}"`) && page.body.includes(`data-tick="c_pets_${bird}"`), url);
    assert.ok(page.body.includes('Welke soort?'), url);
    assert.ok(page.body.includes('name="d_pets_other"') && page.body.includes('data-tick="c_pets_other"'), url);
    assert.equal(page.body.includes('id="c_pets_cat"'), false, url);
  }
});

test('an empty heading follows each participant language', async () => {
  const t = await setup();
  configure(t);
  t.ctx.repo.updateParticipant(t.ada.id, { language: 'en' });
  const page = await t.app.inject({ method: 'GET', url: `/p/${t.ada.token}/about` });
  assert.ok(page.body.includes('Pets'));
  assert.ok(page.body.includes('Lekker en leuk'));
});

test('saving the about form while a section is hidden keeps that answer, and showing it again brings it back', async () => {
  const t = await setup();
  saveWishes(t.ctx, t.ada.id, aboutBody({ q_hobbies: 'tuinieren', q_likes: 'tea' }));
  configure(t);
  const res = await t.post(`/p/${t.ada.token}/about`, aboutBody({ q_likes: 'wine', q_avoid: 'noten' }, ['likes', 'pets', 'avoid', 'other']));
  assert.equal(res.statusCode, 303);
  const { answers } = t.ctx.repo.getParticipant(t.ada.id).wishes;
  assert.equal(answers.hobbies, 'tuinieren');
  assert.deepEqual(answers.likes, { ticked: ['wine'], details: {} });
  setForm(t);
  const page = await t.app.inject({ method: 'GET', url: `/p/${t.ada.token}/about` });
  assert.ok(page.body.includes('>tuinieren</textarea>'));
});

test('the giver sees no hidden section on the result page, the card or the email, and the heading override everywhere', async () => {
  const t = await setup();
  saveWishes(t.ctx, t.receiver.id, aboutBody({ q_hobbies: 'tuinieren', q_likes: 'tea', q_pets: 'dog' }));
  configure(t);
  drawFor(t.ctx, t.ada.id);
  const result = await t.app.inject({ method: 'GET', url: `/p/${t.ada.token}` });
  const card = await t.adminGet(`/admin/participants/${t.ada.id}/card`);
  const receiver = t.ctx.repo.getParticipant(t.receiver.id);
  const mail = renderEmail('wishes-updated', {
    lang: 'nl', participant: t.ada, receiver, event: event(t), group: t.group, link: 'https://gifts.example.com/p/x', tz: 'Europe/Amsterdam',
  });
  for (const [where, body] of [['result', result.body], ['card', card.body], ['mail html', mail.html], ['mail text', mail.text]]) {
    assert.equal(body.includes('tuinieren'), false, where);
    assert.ok(body.includes('Lekker en leuk'), where);
    assert.ok(body.includes('Thee'), where);
    assert.ok(body.includes('Hond'), where);
  }
});

test('an added text question is asked on the form and shown to the giver, in the mail and on the card', async () => {
  const t = await setup();
  const builtIn = SECTION_IDS.map((id) => ({ id, type: ['likes', 'pets'].includes(id) ? 'choices' : 'text' }));
  t.ctx.repo.updateEvent(t.eventId, { formConfig: { questions: [...builtIn, { id: 'q-ab12', type: 'text', text: 'Favoriete auto' }] } });
  const receiverToken = t.ctx.repo.getParticipant(t.receiver.id).token;
  const form = await t.app.inject({ method: 'GET', url: `/p/${receiverToken}/about` });
  assert.match(form.body, /<label class="field-label" for="q_q-ab12">Favoriete auto<\/label>\s*<textarea id="q_q-ab12" name="q_q-ab12"/);
  assert.ok(form.body.includes(`name="questions" value="${[...SECTION_IDS, 'q-ab12'].join(' ')}"`));
  await t.post(`/p/${receiverToken}/about`, aboutBody({ q_likes: 'tea', 'q_q-ab12': 'Mini' }, [...SECTION_IDS, 'q-ab12']));
  assert.equal(t.ctx.repo.getParticipant(t.receiver.id).wishes.answers['q-ab12'], 'Mini');
  drawFor(t.ctx, t.ada.id);
  const result = await t.app.inject({ method: 'GET', url: `/p/${t.ada.token}` });
  const card = await t.adminGet(`/admin/participants/${t.ada.id}/card`);
  const mail = renderEmail('wishes-updated', {
    lang: 'nl', participant: t.ada, receiver: t.ctx.repo.getParticipant(t.receiver.id), event: event(t), group: t.group,
    link: 'https://gifts.example.com/p/x', tz: 'Europe/Amsterdam',
  });
  for (const [where, body] of [['result', result.body], ['card', card.body], ['mail html', mail.html]]) {
    assert.ok(body.includes('Favoriete auto'), where);
    assert.ok(body.indexOf('Thee') < body.indexOf('Mini'), `${where}: in form order`);
  }
  assert.ok(mail.text.includes('- Favoriete auto: Mini'));
});

test('with every section hidden the form still saves and the giver page says nothing about wishes', async () => {
  const t = await setup();
  saveWishes(t.ctx, t.receiver.id, aboutBody({ q_hobbies: 'tuinieren' }));
  setForm(t, { hidden: SECTION_IDS });
  const form = await t.app.inject({ method: 'GET', url: `/p/${t.ada.token}/about` });
  assert.equal(form.statusCode, 200);
  assert.equal(/<fieldset|<textarea/.test(form.body), false);
  assert.ok(form.body.includes('type="submit" class="button"'));
  assert.equal((await t.post(`/p/${t.ada.token}/about`, aboutBody({}, []))).statusCode, 303);
  drawFor(t.ctx, t.ada.id);
  const result = await t.app.inject({ method: 'GET', url: `/p/${t.ada.token}` });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.includes('tuinieren'), false);
});

const questionsPosted = (body) => /name="questions" value="([^"]*)"/.exec(body)?.[1];

for (const [who, formUrl, postUrl, send] of [
  ['participant', (t) => `/p/${t.ada.token}/about`, (t) => `/p/${t.ada.token}/about`, (t) => t.post],
  ['on behalf', (t) => `/admin/participants/${t.ada.id}/about`, (t) => `/admin/participants/${t.ada.id}/about`, (t) => t.adminPost],
]) {
  test(`${who}: a question shown after the form was loaded keeps its hidden answer`, async () => {
    const t = await setup();
    saveWishes(t.ctx, t.ada.id, aboutBody({ q_hobbies: 'tuinieren', q_likes: 'tea' }));
    setForm(t, { hidden: ['hobbies'] });
    const form = await t.adminGet(formUrl(t));
    const questions = questionsPosted(form.body);
    assert.equal(questions, 'likes pets avoid other');
    setForm(t);
    const res = await send(t)(postUrl(t), { questions, q_likes: 'wine' });
    assert.equal(res.statusCode, 303);
    const { answers } = t.ctx.repo.getParticipant(t.ada.id).wishes;
    assert.equal(answers.hobbies, 'tuinieren');
    assert.deepEqual(answers.likes, { ticked: ['wine'], details: {} });
  });

  test(`${who}: a question hidden after the form was loaded keeps its answer`, async () => {
    const t = await setup();
    saveWishes(t.ctx, t.ada.id, aboutBody({ q_hobbies: 'tuinieren', q_pets: 'other', d_pets_other: 'konijn' }));
    const form = await t.adminGet(formUrl(t));
    const questions = questionsPosted(form.body);
    assert.equal(questions, SECTION_IDS.join(' '));
    setForm(t, { hidden: ['hobbies', 'pets'] });
    await send(t)(postUrl(t), { questions, q_hobbies: '', q_avoid: 'noten' });
    const { answers } = t.ctx.repo.getParticipant(t.ada.id).wishes;
    assert.equal(answers.hobbies, 'tuinieren');
    assert.deepEqual(answers.pets, { ticked: ['other'], details: { other: 'konijn' } });
    assert.equal(answers.avoid, 'noten');
  });
}

test('on behalf: saving with a hidden question keeps that answer', async () => {
  const t = await setup();
  saveWishes(t.ctx, t.ada.id, aboutBody({ q_hobbies: 'tuinieren' }));
  setForm(t, { hidden: ['hobbies'] });
  await t.adminPost(`/admin/participants/${t.ada.id}/about`, aboutBody({ q_likes: 'tea' }));
  assert.equal(t.ctx.repo.getParticipant(t.ada.id).wishes.answers.hobbies, 'tuinieren');
});

test('an unchanged save with a hidden pets section holding details does not notify the giver', async () => {
  const t = await setup();
  const bird = configure(t);
  const giver = t.people.find((p) => p.receiverId === t.ada.id);
  drawFor(t.ctx, giver.id);
  saveWishes(t.ctx, t.ada.id, aboutBody({ q_likes: 'tea', q_pets: ['other'], d_pets_other: 'konijn', [`d_pets_${bird}`]: 'parkiet' }));
  t.ctx.repo.updateParticipant(t.ada.id, { notifyGiverDueAt: null });
  setForm(t, { hidden: ['hobbies', 'pets'], headings: { likes: 'Lekker en leuk' }, pets: PETS });
  const form = await t.app.inject({ method: 'GET', url: `/p/${t.ada.token}/about` });
  await t.post(`/p/${t.ada.token}/about`, { questions: questionsPosted(form.body), q_likes: 'tea' });
  const after = t.ctx.repo.getParticipant(t.ada.id);
  assert.equal(after.notifyGiverDueAt, null);
  assert.deepEqual(after.wishes.answers.pets.details, { other: 'konijn', [bird]: 'parkiet' });
});

test('answers only in hidden sections count as nothing filled in', async () => {
  const t = await setup();
  saveWishes(t.ctx, t.receiver.id, aboutBody({ q_hobbies: 'tuinieren' }));
  saveWishes(t.ctx, t.ada.id, aboutBody({ q_hobbies: 'lezen' }));
  setForm(t, { hidden: ['hobbies'] });
  drawFor(t.ctx, t.ada.id);
  const result = await t.app.inject({ method: 'GET', url: `/p/${t.ada.token}` });
  assert.ok(textOf(result.body).includes(tr('nl', 'result.noWishes', { name: t.receiver.name })));
  assert.ok(textOf(result.body).includes(tr('nl', 'result.fillIn')), 'the drawer is asked to fill in, not to change');
  const dashboard = await t.adminGet(`/admin/groups/${t.group.id}`);
  assert.ok(textOf(dashboard.body).includes(tr('nl', 'admin.summary.wishes', { count: 0, total: 3 })));
});
