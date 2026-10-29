import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { aboutBody, makeTestApp, seedGroup } from './helpers.js';

async function setup() {
  const t = await makeTestApp();
  const seeded = seedGroup(t.ctx, { names: ['Ada', 'Ben', 'Cor'] });
  t.ctx.repo.updateEvent(seeded.group.eventId, {
    wishOptions: [
      { id: 'tea', label: 'Thee', detail: false },
      { id: 'books', label: 'Boeken', detail: true, question: 'Welke schrijver?' },
      { id: 'chocolate', label: 'Chocolade', detail: true },
    ],
  });
  return { ...t, ...seeded, ada: seeded.people[0] };
}

// Every detail field names the box it belongs to, and that box is on the page.
function assertLinked(body, expected = ['d_likes_books', 'd_likes_chocolate', 'd_pets_other']) {
  const links = [...body.matchAll(/<input type="text" id="([^"]+)" name="\1"[^>]*data-tick="([^"]+)"/g)];
  const linked = new Map(links.map(([, name, box]) => [name, box]));
  assert.deepEqual([...linked.keys()].sort(), expected);
  for (const box of linked.values()) {
    assert.match(body, new RegExp(`<input type="checkbox" id="${box}" `), box);
  }
  assert.equal(linked.get('d_likes_chocolate'), 'c_likes_chocolate');
  assert.equal(linked.get('d_pets_other'), 'c_pets_other');
  assert.ok(body.includes('/static/js/wish-form.js'));
}

test('the participant about form links each detail field to its box and loads the script', async () => {
  const t = await setup();
  const res = await t.app.inject(`/p/${t.ada.token}/about`);
  assert.equal(res.statusCode, 200);
  assertLinked(res.body);
});

test('the on-behalf about form links each detail field to its box and loads the script', async () => {
  const t = await setup();
  const res = await t.adminGet(`/admin/participants/${t.ada.id}/about`);
  assert.equal(res.statusCode, 200);
  assertLinked(res.body);
});

test('an added tick list shows its choices with linked detail fields and saves by question', async () => {
  const t = await setup();
  t.ctx.repo.updateEvent(t.group.eventId, { formConfig: { questions: [
    { id: 'likes', type: 'choices' },
    { id: 'pets', type: 'choices' },
    { id: 'q-ab12', type: 'choices', text: 'Welke sport?', choices: [
      { id: 'tennis', label: 'Tennis' },
      { id: 'anders-cd34', label: 'Anders', detail: true, question: 'Welke dan?' },
    ] },
  ] } });
  const page = await t.app.inject(`/p/${t.ada.token}/about`);
  assert.ok(page.body.includes('<legend>Welke sport?</legend>'));
  assert.match(page.body, /<input type="checkbox" id="c_q-ab12_tennis" name="q_q-ab12" value="tennis"> <span>Tennis<\/span>/);
  assert.ok(page.body.includes('Welke dan?'));
  assert.match(page.body, /name="questions" value="likes pets q-ab12"/);
  assertLinked(page.body, ['d_likes_chocolate', 'd_pets_other', 'd_q-ab12_anders-cd34']);
  await t.post(`/p/${t.ada.token}/about`, aboutBody({ 'q_q-ab12': 'tennis', 'd_q-ab12_anders-cd34': 'Zwemmen' }, ['likes', 'pets', 'q-ab12']));
  assert.deepEqual(t.ctx.repo.getParticipant(t.ada.id).wishes, {
    answers: { 'q-ab12': { ticked: ['tennis', 'anders-cd34'], details: { 'anders-cd34': 'Zwemmen' } } },
  });
  const again = await t.app.inject(`/p/${t.ada.token}/about`);
  assert.match(again.body, /id="c_q-ab12_anders-cd34" name="q_q-ab12" value="anders-cd34" checked>/);
  assert.match(again.body, /value="Zwemmen" data-tick="c_q-ab12_anders-cd34"/);
});

test('a detail filled in without a tick is saved as a like and comes back ticked', async () => {
  const t = await setup();
  const res = await t.post(`/p/${t.ada.token}/about`, aboutBody({ d_likes_books: 'Annie M.G. Schmidt' }));
  assert.equal(res.statusCode, 303);
  const stored = t.ctx.repo.getParticipant(t.ada.id).wishes;
  assert.deepEqual(stored.answers.likes, { ticked: ['books'], details: { books: 'Annie M.G. Schmidt' } });
  const form = await t.app.inject(`/p/${t.ada.token}/about`);
  assert.match(form.body, /<input type="checkbox" id="c_likes_books" name="q_likes" value="books" checked>/);
  assert.match(form.body, /value="Annie M\.G\. Schmidt" data-tick="c_likes_books"/);
  assert.doesNotMatch(form.body, /value="chocolate" checked/);
});

// Without script the detail keeps its text when the box is unticked, so the
// untick alone has to count.
test('without script, unticking a box whose detail is unchanged drops the like and its detail', async () => {
  const t = await setup();
  await t.post(`/p/${t.ada.token}/about`, aboutBody({
    q_likes: ['books', 'tea'], d_likes_books: 'Annie M.G. Schmidt', q_pets: 'other', d_pets_other: 'konijn',
  }));
  // The same detail texts come back with the boxes unticked.
  await t.post(`/p/${t.ada.token}/about`, aboutBody({ q_likes: 'tea', d_likes_books: 'Annie M.G. Schmidt', d_pets_other: 'konijn' }));
  const stored = t.ctx.repo.getParticipant(t.ada.id).wishes;
  assert.deepEqual(stored.answers, { likes: { ticked: ['tea'], details: {} } });
});

test('a changed detail next to an unticked box still ticks it', async () => {
  const t = await setup();
  await t.post(`/p/${t.ada.token}/about`, aboutBody({ q_likes: 'books', d_likes_books: 'Annie M.G. Schmidt' }));
  await t.post(`/p/${t.ada.token}/about`, aboutBody({ d_likes_books: 'Paul Biegel' }));
  const stored = t.ctx.repo.getParticipant(t.ada.id).wishes;
  assert.deepEqual(stored.answers.likes, { ticked: ['books'], details: { books: 'Paul Biegel' } });
});

function element(props = {}) {
  const handlers = {};
  return {
    ...props,
    handlers,
    addEventListener: (type, fn) => { handlers[type] = fn; },
    getAttribute: (name) => props.attrs?.[name] ?? null,
  };
}

// Runs the shipped script against one detail field and its box.
function runWishForm() {
  const box = element({ id: 'like-chocolate', checked: false });
  const input = element({ value: '', attrs: { 'data-tick': 'like-chocolate' } });
  const document = {
    querySelectorAll: (selector) => (selector === '[data-tick]' ? [input] : []),
    getElementById: (id) => (id === box.id ? box : null),
  };
  const source = readFileSync(new URL('../public/js/wish-form.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { document });
  return { box, input };
}

test('wish-form.js ticks the box when its detail gets text', () => {
  const { box, input } = runWishForm();
  input.value = 'puur';
  input.handlers.input();
  assert.equal(box.checked, true);
});

test('wish-form.js leaves the box alone for an empty or blank detail', () => {
  const { box, input } = runWishForm();
  input.value = '  ';
  input.handlers.input();
  assert.equal(box.checked, false);
});

test('wish-form.js clears the detail when its box is unticked', () => {
  const { box, input } = runWishForm();
  input.value = 'puur';
  input.handlers.input();
  box.checked = false;
  box.handlers.change();
  assert.equal(input.value, '');
});

test('wish-form.js keeps the detail when its box is ticked', () => {
  const { box, input } = runWishForm();
  input.value = 'puur';
  box.checked = true;
  box.handlers.change();
  assert.equal(input.value, 'puur');
});

test('wish-form.js brings the cleared detail back when the box is ticked again', () => {
  const { box, input } = runWishForm();
  input.value = 'puur';
  input.handlers.input();
  box.checked = false;
  box.handlers.change();
  box.checked = true;
  box.handlers.change();
  assert.equal(input.value, 'puur');
});

test('wish-form.js sends no detail for a box left unticked, and new typing replaces the kept text', () => {
  const { box, input } = runWishForm();
  input.value = 'puur';
  input.handlers.input();
  box.checked = false;
  box.handlers.change();
  assert.equal(input.value, '', 'the field the form submits is empty');
  input.value = 'melk';
  input.handlers.input();
  assert.equal(box.checked, true);
  box.checked = false;
  box.handlers.change();
  box.checked = true;
  box.handlers.change();
  assert.equal(input.value, 'melk');
});
