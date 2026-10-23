import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { makeTestApp, seedGroup } from './helpers.js';

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
function assertLinked(body) {
  const links = [...body.matchAll(/<input type="text" id="([^"]+)" name="\1"[^>]*data-tick="([^"]+)"/g)];
  const linked = new Map(links.map(([, name, box]) => [name, box]));
  assert.deepEqual([...linked.keys()].sort(), ['detail_books', 'detail_chocolate', 'pets_other']);
  for (const box of linked.values()) {
    assert.match(body, new RegExp(`<input type="checkbox" id="${box}" `), box);
  }
  assert.equal(linked.get('detail_chocolate'), 'like-chocolate');
  assert.equal(linked.get('pets_other'), 'pet-other');
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

test('a detail filled in without a tick is saved as a like and comes back ticked', async () => {
  const t = await setup();
  const res = await t.post(`/p/${t.ada.token}/about`, { detail_books: 'Annie M.G. Schmidt' });
  assert.equal(res.statusCode, 303);
  const stored = t.ctx.repo.getParticipant(t.ada.id).wishes;
  assert.deepEqual(stored.likes, ['books']);
  assert.deepEqual(stored.likeDetails, { books: 'Annie M.G. Schmidt' });
  const form = await t.app.inject(`/p/${t.ada.token}/about`);
  assert.match(form.body, /<input type="checkbox" id="like-books" name="likes" value="books" checked>/);
  assert.match(form.body, /value="Annie M\.G\. Schmidt" data-tick="like-books"/);
  assert.doesNotMatch(form.body, /value="chocolate" checked/);
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
