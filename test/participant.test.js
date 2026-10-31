import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t as tr } from '../src/i18n/index.js';
import { tick } from '../src/scheduler.js';
import { aboutBody, makeTestApp, seedGroup, textOf } from './helpers.js';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');
const NL_THEME = 'Dit jaar doen we een regift';

async function setup(names = ['Ada', 'Ben', 'Cor']) {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  const seeded = seedGroup(t.ctx, { names });
  return { ...t, ...seeded, clock, ada: seeded.people[0] };
}

test('first visit shows the welcome screen with theme, date and one button', async () => {
  const { app, ada } = await setup();
  const res = await app.inject(`/p/${ada.token}`);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('<html lang="nl">'));
  assert.ok(res.body.includes('Hallo Ada!'));
  assert.ok(res.body.includes(NL_THEME));
  assert.ok(res.body.includes('vrijdag 18 december'));
  assert.ok(res.body.includes(`href="/p/${ada.token}/about"`));
  assert.ok(textOf(res.body).includes('Vertel iets over jezelf'));
  assert.ok(res.body.includes(`action="/p/${ada.token}/lang"`));
  assert.ok(!res.body.includes('Ben'));
});

test('first visit sets visitedAt and a later visit keeps it', async () => {
  const { app, ctx, ada, clock } = await setup();
  assert.equal(ada.visitedAt, null);
  await app.inject(`/p/${ada.token}`);
  const first = ctx.repo.getParticipant(ada.id).visitedAt;
  assert.equal(first, new Date(T0).toISOString());
  clock.ms += 3_600_000;
  await app.inject(`/p/${ada.token}`);
  assert.equal(ctx.repo.getParticipant(ada.id).visitedAt, first);
});

test('the about form has every wish field, the theme and the date', async () => {
  const { app, ada } = await setup();
  const res = await app.inject(`/p/${ada.token}/about`);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes(`action="/p/${ada.token}/about"`));
  for (const name of ['q_hobbies', 'd_pets_other', 'q_avoid', 'q_other', 'd_likes_chocolate']) {
    assert.ok(res.body.includes(`name="${name}"`), name);
  }
  assert.ok(res.body.includes('name="q_likes" value="tea"'));
  assert.ok(res.body.includes('name="q_pets" value="cat"'));
  assert.ok(res.body.includes('name="questions" value="hobbies likes pets avoid other"'));
  assert.ok(res.body.includes('Thee'));
  assert.ok(res.body.includes(NL_THEME));
  assert.ok(res.body.includes('vrijdag 18 december'));
});

test('the about form shows the organiser question, escaped, and the generic prompt elsewhere', async () => {
  const { app, ctx, ada, group } = await setup();
  ctx.repo.updateEvent(group.eventId, {
    wishOptions: [
      { id: 'books', label: 'Boeken', detail: true, question: 'Welke <b>schrijver</b>?' },
      { id: 'wol-ab12', label: 'Wol', detail: true },
      { id: 'chocolate', label: 'Chocolade', detail: true },
    ],
  });
  const res = await app.inject(`/p/${ada.token}/about`);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('Welke &lt;b&gt;schrijver&lt;/b&gt;?'));
  assert.ok(!res.body.includes('<b>schrijver'));
  assert.ok(res.body.includes('name="d_likes_wol-ab12"'));
  assert.ok(res.body.includes('Iets in het bijzonder?'));
  assert.ok(res.body.includes('Welke smaak?'));
});

test('saving wishes in a closed group leads to the waiting screen', async () => {
  const { app, ctx, post, ada, clock } = await setup();
  clock.ms += 60_000;
  const res = await post(`/p/${ada.token}/about`, aboutBody({
    q_hobbies: 'Gardening',
    q_likes: ['tea', 'chocolate'],
    d_likes_chocolate: 'dark',
    q_pets: 'cat',
  }));
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/p/${ada.token}`);
  const stored = ctx.repo.getParticipant(ada.id);
  assert.deepEqual(stored.wishes, { answers: {
    hobbies: 'Gardening',
    likes: { ticked: ['tea', 'chocolate'], details: { chocolate: 'dark' } },
    pets: { ticked: ['cat'], details: {} },
  } });
  assert.equal(stored.wishesUpdatedAt, new Date(clock.ms).toISOString());

  const page = await app.inject(`/p/${ada.token}`);
  assert.ok(page.body.includes('Het trekken begint binnenkort, je krijgt een e-mail.'));
  assert.ok(page.body.includes(`href="/p/${ada.token}/about"`));
  assert.ok(page.body.includes(NL_THEME));
  assert.ok(page.body.includes('vrijdag 18 december'));

  const form = await app.inject(`/p/${ada.token}/about`);
  assert.ok(form.body.includes('value="Gardening"') || form.body.includes('>Gardening</textarea>'));
  assert.match(form.body, /name="q_likes" value="tea" checked/);
  assert.match(form.body, /name="q_pets" value="cat" checked/);
  assert.doesNotMatch(form.body, /name="q_likes" value="wine" checked/);
});

// Fifteen minutes later the wish-update lines say something about this
// person's giver, so the save itself names only the group.
test('a wish save logs the group, not the participant', async () => {
  const { post, ada, group, logs } = await setup();
  await post(`/p/${ada.token}/about`, aboutBody({ q_hobbies: 'reading' }));
  const line = logs.map((l) => JSON.parse(l)).find((l) => l.msg === 'wishes_saved');
  assert.equal(line.group_id, group.id);
  assert.ok(!Object.hasOwn(line, 'participant_id'));
});

test('saved HTML comes back escaped', async () => {
  const { app, post, ada } = await setup();
  await post(`/p/${ada.token}/about`, aboutBody({ q_hobbies: '<script>alert(1)</script>', d_pets_other: '"><b>x' }));
  const form = await app.inject(`/p/${ada.token}/about`);
  assert.ok(form.body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!form.body.includes('<script>alert(1)'));
  assert.ok(!form.body.includes('"><b>x'));
});

test('a 5000 character field is stored as 1000', async () => {
  const { ctx, post, ada } = await setup();
  const res = await post(`/p/${ada.token}/about`, aboutBody({ q_other: 'x'.repeat(5000) }));
  assert.equal(res.statusCode, 303);
  assert.equal(ctx.repo.getParticipant(ada.id).wishes.answers.other.length, 1000);
});

test('an unknown token gets the HTML 404 page', async () => {
  const { app } = await setup();
  for (const url of ['/p/unknown-token', '/p/unknown-token/about']) {
    const res = await app.inject(url);
    assert.equal(res.statusCode, 404);
    assert.match(res.headers['content-type'], /^text\/html/);
    assert.ok(res.body.includes('Deze pagina bestaat niet.'));
  }
});

test('the language switch stores a known language and goes back', async () => {
  const { app, ctx, post, ada } = await setup();
  const res = await post(`/p/${ada.token}/lang`, { lang: 'en' });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/p/${ada.token}`);
  assert.equal(ctx.repo.getParticipant(ada.id).language, 'en');
  const page = await app.inject(`/p/${ada.token}`);
  assert.ok(page.body.includes('<html lang="en">'));
  assert.ok(page.body.includes('Hello Ada!'));
  assert.ok(page.body.includes('This year it&#39;s a regift'));

  const fromAbout = await post(`/p/${ada.token}/lang`, { lang: 'nl', from: 'about' });
  assert.equal(fromAbout.headers.location, `/p/${ada.token}/about`);
  const elsewhere = await post(`/p/${ada.token}/lang`, { lang: 'nl', from: 'https://evil.example' });
  assert.equal(elsewhere.headers.location, `/p/${ada.token}`);
});

// The switch sits under the form, close to Save; answers typed but not yet
// saved must survive the reload into the other language.
test('switching language on the about form keeps what was typed', async () => {
  const { app, ctx, post, ada } = await setup();
  const form = await app.inject(`/p/${ada.token}/about`);
  assert.match(form.body, /<form class="about" id="about-form" method="post"/);
  assert.match(form.body, new RegExp(`<button type="submit" name="lang" value="en" lang="en" form="about-form" formaction="/p/${ada.token}/lang">`));

  const res = await post(`/p/${ada.token}/lang`, {
    lang: 'en', from: 'about', ...aboutBody({ q_hobbies: 'Yoga en wandelen', q_likes: 'tea' }),
  });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/p/${ada.token}/about`);
  const stored = ctx.repo.getParticipant(ada.id);
  assert.equal(stored.language, 'en');
  assert.equal(stored.wishes.answers.hobbies, 'Yoga en wandelen');
  assert.deepEqual(stored.wishes.answers.likes, { ticked: ['tea'], details: {} });
  const again = await app.inject(`/p/${ada.token}/about`);
  assert.ok(again.body.includes('Yoga en wandelen'));
});

test('switching language with the answers unchanged tells the giver nothing', async () => {
  const { ctx, post, ada } = await setup();
  await post(`/p/${ada.token}/about`, aboutBody({ q_hobbies: 'Breien', q_likes: 'tea' }));
  const giver = ctx.repo.giverOf(ada.id);
  ctx.repo.updateParticipant(giver.id, { drawnAt: ctx.nowIso() });
  const before = ctx.repo.getParticipant(ada.id);
  await post(`/p/${ada.token}/lang`, { lang: 'en', from: 'about', ...aboutBody({ q_hobbies: 'Breien', q_likes: 'tea' }) });
  const after = ctx.repo.getParticipant(ada.id);
  assert.equal(after.language, 'en');
  assert.equal(after.notifyGiverDueAt, null);
  assert.equal(after.wishesUpdatedAt, before.wishesUpdatedAt);
});

test('the language switch keeps answers of questions the posted form did not show', async () => {
  const { ctx, post, ada, event } = await setup();
  await post(`/p/${ada.token}/about`, aboutBody({ q_hobbies: 'Breien', q_avoid: 'Noten', q_other: 'Graag iets kleins' }));
  // A form loaded before the organiser showed "avoid" again lists only hobbies.
  await post(`/p/${ada.token}/lang`, { lang: 'en', from: 'about', ...aboutBody({ q_hobbies: 'Breien en lezen', q_avoid: '' }, ['hobbies']) });
  let answers = ctx.repo.getParticipant(ada.id).wishes.answers;
  assert.equal(answers.hobbies, 'Breien en lezen');
  assert.equal(answers.avoid, 'Noten');
  // A question the organiser hid keeps its answer through the switch too.
  ctx.repo.updateEvent(event.id, { formConfig: { sections: { other: { show: false } } } });
  await post(`/p/${ada.token}/lang`, {
    lang: 'nl', from: 'about', ...aboutBody({ q_hobbies: 'Breien en lezen', q_avoid: 'Noten', q_other: '' }, ['hobbies', 'likes', 'pets', 'avoid']),
  });
  answers = ctx.repo.getParticipant(ada.id).wishes.answers;
  assert.equal(answers.other, 'Graag iets kleins');
});

// A page loaded before forms were lists of questions posts fields this
// version cannot read; storing its post would empty every answer.
test('a post from an outdated about page stores nothing and shows the form again with a notice', async () => {
  const { app, ctx, post, adminPost, ada, clock } = await setup();
  await post(`/p/${ada.token}/about`, aboutBody({ q_hobbies: 'Breien', q_likes: 'tea' }));
  const giver = ctx.repo.giverOf(ada.id);
  ctx.repo.updateParticipant(giver.id, { drawnAt: ctx.nowIso() });
  ctx.repo.updateParticipant(ada.id, { notifyGiverDueAt: null });
  const before = ctx.repo.getParticipant(ada.id);
  clock.ms += 60_000;
  const outdated = { sections: 'hobbies likes', hobbies: 'Nieuw', likes: 'wine' };
  for (const send of [
    () => post(`/p/${ada.token}/about`, outdated),
    () => adminPost(`/admin/participants/${ada.id}/about`, outdated),
  ]) {
    const res = await send();
    assert.equal(res.statusCode, 200);
    assert.ok(textOf(res.body).includes('Deze pagina was verouderd, dus er is niets opgeslagen.'));
    assert.ok(res.body.includes('>Breien</textarea>'));
    assert.match(res.body, /name="q_likes" value="tea" checked/);
  }
  const after = ctx.repo.getParticipant(ada.id);
  assert.deepEqual(after.wishes, before.wishes);
  assert.equal(after.wishesUpdatedAt, before.wishesUpdatedAt);
  assert.equal(after.notifyGiverDueAt, null);

  const switched = await post(`/p/${ada.token}/lang`, { lang: 'en', from: 'about', ...outdated });
  assert.equal(switched.statusCode, 200);
  assert.ok(textOf(switched.body).includes('This page was out of date, so nothing was saved.'));
  assert.equal(ctx.repo.getParticipant(ada.id).language, 'en');
  assert.deepEqual(ctx.repo.getParticipant(ada.id).wishes, before.wishes);
  const fresh = await app.inject(`/p/${ada.token}/about`);
  assert.equal(textOf(fresh.body).includes('out of date'), false);
});

// The hidden fields an about page posts back, as a browser sends them.
function hiddenFields(body) {
  const fields = {};
  for (const [, name, value] of body.matchAll(/<input type="hidden" name="([^"]*)" value="([^"]*)">/g)) fields[name] = value;
  return fields;
}

async function openAbout(app, url) {
  const res = await app.inject(url);
  assert.equal(res.statusCode, 200);
  return hiddenFields(res.body);
}

const typedBlock = (body) => /<section class="typed"[\s\S]*?<\/section>/.exec(body)?.[0] ?? '';

// A page left open while the same person saved on another page: storing its
// post would put the older answers back and mail the giver about it.
test('an about page opened before a newer save stores nothing and shows the saved answers next to what was typed', async () => {
  const { app, ctx, post, ada, clock } = await setup();
  const giver = ctx.repo.giverOf(ada.id);
  ctx.repo.updateParticipant(giver.id, { drawnAt: ctx.nowIso() });
  const old = await openAbout(app, `/p/${ada.token}/about`);
  clock.ms += 86_400_000;
  const fresh = await openAbout(app, `/p/${ada.token}/about`);
  const saved = await post(`/p/${ada.token}/about`, { ...fresh, q_likes: ['candles'], q_other: 'Ik heb een kat.' });
  assert.equal(saved.statusCode, 303);
  ctx.repo.updateParticipant(ada.id, { notifyGiverDueAt: null });
  const before = ctx.repo.getParticipant(ada.id);
  clock.ms += 3_600_000;

  const res = await post(`/p/${ada.token}/about`, { ...old, q_avoid: 'Geen parfum.' });
  assert.equal(res.statusCode, 200);
  const text = textOf(res.body);
  assert.ok(text.includes(tr('nl', 'about.stale')));
  assert.ok(text.includes(tr('nl', 'about.staleForm')));
  // The form holds what is saved now; what was typed is listed beside it.
  assert.match(res.body, /name="q_likes" value="candles" checked/);
  assert.ok(res.body.includes('>Ik heb een kat.</textarea>'));
  assert.equal(res.body.includes('>Geen parfum.</textarea>'), false);
  const typed = typedBlock(res.body);
  assert.ok(textOf(typed).includes(tr('nl', 'about.typedTitle')));
  assert.ok(textOf(typed).includes('Liever niet'));
  assert.ok(textOf(typed).includes('Geen parfum.'));
  const after = ctx.repo.getParticipant(ada.id);
  assert.deepEqual(after.wishes, before.wishes);
  assert.equal(after.wishesUpdatedAt, before.wishesUpdatedAt);
  assert.equal(after.notifyGiverDueAt, null);

  // The page it came back with is current: saving it stores what it holds.
  const again = await post(`/p/${ada.token}/about`, {
    ...hiddenFields(res.body), q_likes: ['candles'], q_other: 'Ik heb een kat.', q_avoid: 'Geen parfum.',
  });
  assert.equal(again.statusCode, 303);
  assert.deepEqual(ctx.repo.getParticipant(ada.id).wishes.answers, {
    likes: { ticked: ['candles'], details: {} }, avoid: 'Geen parfum.', other: 'Ik heb een kat.',
  });
});

test('a refused about post logs the group and mails nobody', async () => {
  const { app, ctx, post, ada, logs, drain, mails, clock } = await setup();
  const giver = ctx.repo.giverOf(ada.id);
  ctx.repo.updateParticipant(giver.id, { drawnAt: ctx.nowIso() });
  const old = await openAbout(app, `/p/${ada.token}/about`);
  await post(`/p/${ada.token}/about`, { ...(await openAbout(app, `/p/${ada.token}/about`)), q_hobbies: 'Breien' });
  const updated = () => mails.filter((m) => m.to === giver.email).length;
  clock.ms += 20 * 60_000;
  await tick(ctx);
  await drain();
  assert.equal(updated(), 1, 'the newer save mails the giver');
  await post(`/p/${ada.token}/about`, { ...old, q_hobbies: 'Lezen' });
  assert.equal(ctx.repo.getParticipant(ada.id).notifyGiverDueAt, null);
  clock.ms += 20 * 60_000;
  await tick(ctx);
  await drain();
  assert.equal(updated(), 1);
  const line = logs.map((l) => JSON.parse(l)).find((l) => l.msg === 'wishes_form_stale');
  assert.ok(line, 'stale line logged');
  assert.equal(line.group_id, ada.groupId);
  assert.equal(line.participant_id, undefined);
});

// X7: the organiser's confirmation counted only saved answers, so a page
// open during a question change must not drop what it held either.
test('an about page opened before the organiser changed the questions stores nothing and keeps every typed text visible', async () => {
  const { app, ctx, post, adminPost, ada, group } = await setup();
  const old = await openAbout(app, `/p/${ada.token}/about`);
  const questions = [
    { id: 'hobbies', type: 'text', text: 'Waar word je blij van?' },
    { id: 'likes', type: 'choices', choices: ['chocolate', 'tea', 'coffee', 'bath', 'books', 'plants', 'wine'].map((id) => ({ id })) },
    { id: 'pets', type: 'choices', show: false, choices: ['cat', 'dog', 'other'].map((id) => ({ id, ...(id === 'other' ? { detail: true } : {}) })) },
    { id: 'avoid', type: 'text' },
    { id: 'other', type: 'text' },
  ];
  ctx.repo.updateEvent(group.eventId, { formConfig: { questions } }, ctx.nowIso());
  const removed = await adminPost(`/admin/events/${group.eventId}/questions/other/delete`, { confirm: '1' });
  assert.equal(removed.statusCode, 303);

  const res = await post(`/p/${ada.token}/about`, {
    ...old, q_hobbies: 'Wandelen.', q_likes: ['tea', 'candles'], q_pets: ['cat'], q_other: 'Ik heb een kat.',
  });
  assert.equal(res.statusCode, 200);
  assert.ok(textOf(res.body).includes(tr('nl', 'about.stale')));
  assert.equal(ctx.repo.getParticipant(ada.id).wishes, null);
  assert.equal(ctx.repo.getParticipant(ada.id).wishesUpdatedAt, null);
  const typed = textOf(typedBlock(res.body));
  assert.ok(typed.includes('Waar word je blij van?'));
  assert.ok(typed.includes('Wandelen.'));
  assert.ok(typed.includes('Thee'));
  assert.ok(typed.includes('Huisdieren'));
  assert.ok(typed.includes(tr('nl', 'about.typedGone')));
  assert.ok(typed.includes('Ik heb een kat.'));
  // The current form, renamed question and all, with nothing filled in.
  assert.ok(textOf(res.body).includes('Waar word je blij van?'));
  assert.equal(res.body.includes('name="q_other"'), false);
  assert.equal(res.body.includes('name="q_likes" value="candles"'), false);
});

test('switching language on an about page opened before a newer save stores nothing and shows it in the new language', async () => {
  const { app, ctx, post, ada } = await setup();
  const old = await openAbout(app, `/p/${ada.token}/about`);
  await post(`/p/${ada.token}/about`, { ...(await openAbout(app, `/p/${ada.token}/about`)), q_hobbies: 'Breien' });
  const before = ctx.repo.getParticipant(ada.id);
  const res = await post(`/p/${ada.token}/lang`, { lang: 'en', from: 'about', ...old, q_hobbies: 'Lezen' });
  assert.equal(res.statusCode, 200);
  assert.ok(textOf(res.body).includes(tr('en', 'about.stale')));
  assert.ok(res.body.includes('>Breien</textarea>'));
  assert.ok(textOf(typedBlock(res.body)).includes('Lezen'));
  const after = ctx.repo.getParticipant(ada.id);
  assert.equal(after.language, 'en');
  assert.deepEqual(after.wishes, before.wishes);
  assert.equal(after.wishesUpdatedAt, before.wishesUpdatedAt);
});

test('a current about page saves as before, and saved unchanged is no change', async () => {
  const { app, ctx, post, ada, clock } = await setup();
  const page = await app.inject(`/p/${ada.token}/about`);
  assert.match(page.body, /<input type="hidden" name="version" value="[0-9a-f]{16}">/);
  const res = await post(`/p/${ada.token}/about`, { ...hiddenFields(page.body), q_hobbies: 'Breien' });
  assert.equal(res.statusCode, 303);
  const saved = ctx.repo.getParticipant(ada.id);
  assert.equal(saved.wishes.answers.hobbies, 'Breien');
  clock.ms += 60_000;
  const same = await post(`/p/${ada.token}/about`, { ...(await openAbout(app, `/p/${ada.token}/about`)), q_hobbies: 'Breien' });
  assert.equal(same.statusCode, 303);
  assert.equal(ctx.repo.getParticipant(ada.id).wishesUpdatedAt, saved.wishesUpdatedAt);
  // The version follows the stored answers and the form, nothing else.
  assert.deepEqual(await openAbout(app, `/p/${ada.token}/about`), await openAbout(app, `/p/${ada.token}/about`));
});

// Rows saved by v0.3.1 keep their own shape until an answer changes.
test('saving unchanged answers on a v0.3.1 row is no change', async () => {
  const { ctx, post, ada } = await setup();
  const old = {
    hobbies: 'Breien', likes: ['chocolate', 'tea'], likeDetails: { chocolate: 'puur' }, pets: ['other'], petsOther: 'konijn', avoid: '', other: '',
  };
  ctx.repo.updateParticipant(ada.id, { wishes: old, wishesUpdatedAt: '2026-10-01T10:00:00.000Z' });
  const giver = ctx.repo.giverOf(ada.id);
  ctx.repo.updateParticipant(giver.id, { drawnAt: ctx.nowIso() });
  await post(`/p/${ada.token}/about`, aboutBody({
    q_hobbies: 'Breien', q_likes: ['tea', 'chocolate'], d_likes_chocolate: 'puur', q_pets: 'other', d_pets_other: 'konijn', q_avoid: '',
  }));
  const after = ctx.repo.getParticipant(ada.id);
  assert.equal(after.wishesUpdatedAt, '2026-10-01T10:00:00.000Z');
  assert.equal(after.notifyGiverDueAt, null);
  await post(`/p/${ada.token}/about`, aboutBody({ q_hobbies: 'Breien en lezen' }));
  assert.notEqual(ctx.repo.getParticipant(ada.id).wishesUpdatedAt, '2026-10-01T10:00:00.000Z');
});

// A v0.3.1 row can still tick a choice the organiser removed later; the
// form no longer shows it, so a save cannot keep it and that is no change.
test('saving unchanged answers on a v0.3.1 row ticking a removed choice is no change', async () => {
  const { ctx, post, ada } = await setup();
  const eventId = ctx.repo.getGroup(ada.groupId).eventId;
  ctx.repo.updateEvent(eventId, { wishOptions: [{ id: 'tea', label: 'Thee', detail: false }] });
  const old = { hobbies: 'Breien', likes: ['tea', 'socks-1a2b'], likeDetails: { 'socks-1a2b': '42' }, pets: [], avoid: '', other: '' };
  ctx.repo.updateParticipant(ada.id, { wishes: old, wishesUpdatedAt: '2026-10-01T10:00:00.000Z' });
  const giver = ctx.repo.giverOf(ada.id);
  ctx.repo.updateParticipant(giver.id, { drawnAt: ctx.nowIso() });
  await post(`/p/${ada.token}/about`, aboutBody({ q_hobbies: 'Breien', q_likes: 'tea' }));
  const after = ctx.repo.getParticipant(ada.id);
  assert.equal(after.wishesUpdatedAt, '2026-10-01T10:00:00.000Z');
  assert.equal(after.notifyGiverDueAt, null);
});

test('the on-behalf wish form has no language switch', async () => {
  const { adminGet, ada } = await setup();
  const res = await adminGet(`/admin/participants/${ada.id}/about`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.includes('class="lang-switch"'), false);
  assert.equal(res.body.includes('formaction='), false);
});

test('switching language away from the form leaves the wishes alone', async () => {
  const { ctx, post, ada } = await setup();
  await post(`/p/${ada.token}/about`, aboutBody({ q_hobbies: 'Breien' }));
  await post(`/p/${ada.token}/lang`, { lang: 'en', ...aboutBody({ q_hobbies: 'Nooit' }) });
  await post(`/p/${ada.token}/lang`, { lang: 'nl', from: 'about' });
  assert.equal(ctx.repo.getParticipant(ada.id).wishes.answers.hobbies, 'Breien');
});

test('a junk language is refused and the stored language is unchanged', async () => {
  const { ctx, post, ada } = await setup();
  const res = await post(`/p/${ada.token}/lang`, { lang: '!!' });
  assert.equal(res.statusCode, 400);
  assert.match(res.headers['content-type'], /^text\/html/);
  assert.ok(res.body.includes('Dit verzoek klopt niet, ga terug'));
  assert.equal(ctx.repo.getParticipant(ada.id).language, 'nl');
  const missing = await post(`/p/${ada.token}/lang`, {});
  assert.equal(missing.statusCode, 400);
});

test('25 participants behind one IP each get through a whole visit in a minute', async () => {
  const names = Array.from({ length: 25 }, (_, i) => `Eva${i}`);
  const { app, post, people } = await setup(names);
  for (const p of people) {
    assert.equal((await app.inject(`/p/${p.token}`)).statusCode, 200);
    assert.equal((await app.inject(`/p/${p.token}/about`)).statusCode, 200);
    assert.equal((await post(`/p/${p.token}/about`, aboutBody({ q_hobbies: 'Yoga' }))).statusCode, 303);
  }
});

test('21 unknown tokens from one IP block every participant page until the window passes', async () => {
  const { app, ada, clock } = await setup();
  for (let i = 0; i < 20; i += 1) {
    assert.equal((await app.inject(`/p/guess-${i}`)).statusCode, 404);
  }
  const blocked = await app.inject('/p/guess-20');
  assert.equal(blocked.statusCode, 429);
  assert.match(blocked.headers['content-type'], /^text\/html/);
  assert.ok(blocked.body.includes('Even te veel tegelijk.'));

  assert.equal((await app.inject(`/p/${ada.token}`)).statusCode, 429);
  assert.equal((await app.inject(`/p/${ada.token}/about`)).statusCode, 429);
  assert.equal((await app.inject({ url: `/p/${ada.token}`, remoteAddress: '192.0.2.7' })).statusCode, 200);

  clock.ms += 60_000;
  assert.equal((await app.inject(`/p/${ada.token}`)).statusCode, 200);
});

test('valid-token traffic from one IP has a ceiling', async () => {
  const { app, ada } = await setup();
  for (let i = 0; i < 600; i += 1) {
    assert.equal((await app.inject(`/p/${ada.token}/about`)).statusCode, 200);
  }
  assert.equal((await app.inject(`/p/${ada.token}/about`)).statusCode, 429);
});

test('the waiting screen does not promise an email to someone without one', async () => {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  const { people } = seedGroup(t.ctx, { names: ['Ada', 'Ben', 'Cor'], withEmail: false });
  await t.post(`/p/${people[0].token}/about`, aboutBody({ q_hobbies: 'Yoga' }));
  const page = await t.app.inject(`/p/${people[0].token}`);
  assert.ok(page.body.includes('De organisator laat je weten'));
  assert.ok(!page.body.includes('e-mail'));
});

test('with email off the waiting screen does not promise an email, even to someone with an address', async () => {
  const t = await setup();
  t.mailer.enabled = false;
  await t.post(`/p/${t.ada.token}/about`, aboutBody({ q_hobbies: 'Yoga' }));
  const page = await t.app.inject(`/p/${t.ada.token}`);
  assert.ok(page.body.includes('De organisator laat je weten'));
  assert.ok(!page.body.includes('e-mail'));
});

test('a HEAD request does not count as a visit', async () => {
  const { app, ctx, ada } = await setup();
  const res = await app.inject({ method: 'HEAD', url: `/p/${ada.token}` });
  assert.equal(res.statusCode, 200);
  assert.equal(ctx.repo.getParticipant(ada.id).visitedAt, null);
});

test('a blocked IP gets no participant page through odd spellings of the path', async () => {
  const { app, ada } = await setup();
  for (let i = 0; i < 20; i += 1) await app.inject(`/p/guess-${i}`);
  for (const url of [`//p/${ada.token}`, `/%70/${ada.token}`, `/./p/${ada.token}`, `/x/../p/${ada.token}/about`]) {
    const res = await app.inject(url);
    assert.ok([404, 429].includes(res.statusCode), `${url.replace(ada.token, ':token')} ${res.statusCode}`);
    assert.ok(!res.body.includes('Ada'));
  }
});
