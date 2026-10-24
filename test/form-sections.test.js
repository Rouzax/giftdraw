import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEmail } from '../src/mail/templates.js';
import { drawFor, saveWishes } from '../src/people.js';
import { petOptions, SECTION_IDS } from '../src/wishes.js';
import { makeTestApp, seedGroup, textOf } from './helpers.js';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');

async function setup() {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  const seeded = seedGroup(t.ctx, { names: ['Ada', 'Ben', 'Cor'], opened: true });
  const [ada] = seeded.people;
  const receiver = t.ctx.repo.getParticipant(ada.receiverId);
  return { ...t, clock, ...seeded, ada, receiver, eventId: seeded.event.id };
}

const BASE = { name: 'Gifts 2026', language: 'nl', cleanupWeeks: '4', themeText: '', wishOptions: '' };

// The full event form as the browser sends it: the marker says the section
// controls were on the page, so an unticked show box means hidden.
function eventForm({ hidden = [], headings = {}, pets = 'Hond\nKat\nAnder dier?' } = {}) {
  const form = { ...BASE, formSections: '1', petOptions: pets };
  for (const id of SECTION_IDS) {
    if (!hidden.includes(id)) form[`show_${id}`] = '1';
    form[`heading_${id}`] = headings[id] ?? '';
  }
  return form;
}

const event = (t) => t.ctx.repo.getEvent(t.eventId);

test('the event page lists the five sections with show boxes, heading fields and the pet list', async () => {
  const t = await setup();
  const page = await t.adminGet(`/admin/events/${t.eventId}`);
  assert.equal(page.statusCode, 200);
  assert.ok(page.body.includes('name="formSections" value="1"'));
  for (const id of SECTION_IDS) {
    assert.match(page.body, new RegExp(`name="show_${id}" value="1" checked`));
    assert.ok(page.body.includes(`name="heading_${id}"`), id);
  }
  assert.ok(textOf(page.body).includes('Het formulier'));
  assert.ok(page.body.includes('Hond\nKat\nAnder dier?'));
  const order = SECTION_IDS.map((id) => page.body.indexOf(`name="show_${id}"`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(page.body.indexOf('name="wishOptions"') < order[0], 'the block comes under the like choices');
});

test('saving the event stores hidden sections, headings and a custom pet list, and shows them back', async () => {
  const t = await setup();
  const res = await t.adminPost(`/admin/events/${t.eventId}`, eventForm({
    hidden: ['avoid'], headings: { pets: '  Dieren\nthuis ', hobbies: "Hobby's en interesses" }, pets: 'Hond\nVogel? Welke soort?',
  }));
  assert.equal(res.statusCode, 303);
  const config = event(t).formConfig;
  assert.deepEqual(config.sections, { pets: { heading: 'Dieren thuis' }, avoid: { show: false } });
  assert.equal(config.petOptions[0].id, 'dog');
  assert.equal(config.petOptions[1].question, 'Welke soort?');
  const page = await t.adminGet(`/admin/events/${t.eventId}`);
  assert.ok(page.body.includes('value="Dieren thuis"'));
  assert.ok(page.body.includes('name="show_avoid" value="1">'));
  assert.ok(page.body.includes('Hond\nVogel? Welke soort?'));
});

test('an all-default form stores nothing, and an event post without the section controls keeps the config', async () => {
  const t = await setup();
  await t.adminPost(`/admin/events/${t.eventId}`, eventForm());
  assert.equal(event(t).formConfig, null);
  await t.adminPost(`/admin/events/${t.eventId}`, eventForm({ hidden: ['pets'] }));
  await t.adminPost(`/admin/events/${t.eventId}`, BASE);
  assert.deepEqual(event(t).formConfig, { sections: { pets: { show: false } } });
  await t.adminPost(`/admin/events/${t.eventId}`, eventForm({ pets: '' }));
  assert.equal(event(t).formConfig, null, 'an empty pet list is the built-in list');
});

async function configure(t) {
  await t.adminPost(`/admin/events/${t.eventId}`, eventForm({
    hidden: ['hobbies'], headings: { likes: 'Lekker en leuk' }, pets: 'Hond\nVogel? Welke soort?\nAnder dier?',
  }));
  return petOptions(event(t))[1].id;
}

test('the about form leaves out a hidden section and shows the heading override and custom pets', async () => {
  const t = await setup();
  const bird = await configure(t);
  for (const url of [`/p/${t.ada.token}/about`, `/admin/participants/${t.ada.id}/about`]) {
    const page = await t.adminGet(url);
    assert.equal(page.statusCode, 200, url);
    assert.equal(page.body.includes('name="hobbies"'), false, url);
    assert.ok(page.body.includes('Lekker en leuk'), url);
    assert.ok(page.body.includes(`id="pet-${bird}"`), url);
    assert.ok(page.body.includes(`name="pet_detail_${bird}"`) && page.body.includes(`data-tick="pet-${bird}"`), url);
    assert.ok(page.body.includes('Welke soort?'), url);
    assert.ok(page.body.includes('name="pets_other"') && page.body.includes('data-tick="pet-other"'), url);
    assert.equal(page.body.includes('id="pet-cat"'), false, url);
  }
});

test('an empty heading follows each participant language', async () => {
  const t = await setup();
  await configure(t);
  t.ctx.repo.updateParticipant(t.ada.id, { language: 'en' });
  const page = await t.app.inject({ method: 'GET', url: `/p/${t.ada.token}/about` });
  assert.ok(page.body.includes('Pets'));
  assert.ok(page.body.includes('Lekker en leuk'));
});

test('saving the about form while a section is hidden keeps that answer, and showing it again brings it back', async () => {
  const t = await setup();
  saveWishes(t.ctx, t.ada.id, { hobbies: 'tuinieren', likes: 'tea' });
  await configure(t);
  const res = await t.post(`/p/${t.ada.token}/about`, { likes: 'wine', avoid: 'noten' });
  assert.equal(res.statusCode, 303);
  const wishes = t.ctx.repo.getParticipant(t.ada.id).wishes;
  assert.equal(wishes.hobbies, 'tuinieren');
  assert.deepEqual(wishes.likes, ['wine']);
  await t.adminPost(`/admin/events/${t.eventId}`, eventForm());
  const page = await t.app.inject({ method: 'GET', url: `/p/${t.ada.token}/about` });
  assert.ok(page.body.includes('>tuinieren</textarea>'));
});

test('the giver sees no hidden section on the result page, the card or the email, and the heading override everywhere', async () => {
  const t = await setup();
  saveWishes(t.ctx, t.receiver.id, { hobbies: 'tuinieren', likes: 'tea', pets: 'dog' });
  await configure(t);
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
    assert.ok(body.includes('thee'), where);
    assert.ok(body.includes('hond'), where);
  }
});

test('with every section hidden the form still saves and the giver page says nothing about wishes', async () => {
  const t = await setup();
  saveWishes(t.ctx, t.receiver.id, { hobbies: 'tuinieren' });
  await t.adminPost(`/admin/events/${t.eventId}`, eventForm({ hidden: SECTION_IDS }));
  const form = await t.app.inject({ method: 'GET', url: `/p/${t.ada.token}/about` });
  assert.equal(form.statusCode, 200);
  assert.equal(/<fieldset|<textarea/.test(form.body), false);
  assert.ok(form.body.includes('type="submit" class="button"'));
  assert.equal((await t.post(`/p/${t.ada.token}/about`, {})).statusCode, 303);
  drawFor(t.ctx, t.ada.id);
  const result = await t.app.inject({ method: 'GET', url: `/p/${t.ada.token}` });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.includes('tuinieren'), false);
});

test('a printed card goes out of date when the form changes, not on an unchanged save', async () => {
  const t = await setup();
  drawFor(t.ctx, t.ada.id);
  const outOfDate = async () => (await t.adminGet(`/admin/groups/${t.group.id}`)).body.includes('Opnieuw printen');
  const print = () => {
    t.clock.ms += 60_000;
    t.ctx.repo.updateParticipant(t.ada.id, { printedAt: t.ctx.nowIso() });
    t.clock.ms += 60_000;
  };
  const changes = [{ hidden: ['other'] }, { hidden: ['other'], headings: { avoid: 'Nee' } }, { hidden: ['other'], headings: { avoid: 'Nee' }, pets: 'Hond' }];
  for (const change of changes) {
    print();
    await t.adminPost(`/admin/events/${t.eventId}`, eventForm(change));
    assert.equal(await outOfDate(), true, JSON.stringify(change));
    print();
    await t.adminPost(`/admin/events/${t.eventId}`, eventForm(change));
    assert.equal(await outOfDate(), false, `same again: ${JSON.stringify(change)}`);
  }
});
