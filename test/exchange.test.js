import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escape } from '../src/html.js';
import { exchangeLine } from '../src/i18n/index.js';
import { KINDS, renderEmail } from '../src/mail/templates.js';
import { aboutFormView, cardView, resultView, waitingView, welcomeView } from '../src/views/participant.js';
import { makeTestApp, seedGroup, textOf } from './helpers.js';

const TZ = 'Europe/Amsterdam';
const DATE = '2026-12-18';
const PLACE = 'Yogastudio <b>De Lotus</b>, Dorpsstraat 1';
const event = { name: 'Gifts 2026', language: 'nl', themeText: null, wishOptions: null };
const group = { name: 'Monday', exchangeDate: DATE, exchangeTime: '10:30', exchangePlace: PLACE };
const ada = { id: 1, name: 'Ada', email: 'ada@example.com', language: 'nl', wishes: null };
const ben = { id: 2, name: 'Ben', email: 'ben@example.com', language: 'nl', wishes: null };

const line = (lang, fields) => exchangeLine(lang, { exchangeDate: DATE, exchangeTime: null, exchangePlace: null, ...fields }, TZ);

test('exchangeLine in nl covers date, time and place', () => {
  assert.equal(line('nl', {}), 'We geven de cadeautjes op vrijdag 18 december.');
  assert.equal(line('nl', { exchangeTime: '10:30' }), 'We geven de cadeautjes op vrijdag 18 december om 10:30.');
  assert.equal(line('nl', { exchangePlace: 'Yogastudio De Lotus' }),
    'We geven de cadeautjes op vrijdag 18 december bij Yogastudio De Lotus.');
  assert.equal(line('nl', { exchangeTime: '10:30', exchangePlace: 'Yogastudio De Lotus, Dorpsstraat 1' }),
    'We geven de cadeautjes op vrijdag 18 december om 10:30 bij Yogastudio De Lotus, Dorpsstraat 1.');
});

test('exchangeLine in en covers date, time and place', () => {
  assert.equal(line('en', {}), 'We give the presents on Friday 18 December.');
  assert.equal(line('en', { exchangeTime: '10:30' }), 'We give the presents on Friday 18 December at 10:30.');
  assert.equal(line('en', { exchangePlace: 'Yoga studio De Lotus' }),
    'We give the presents on Friday 18 December, at Yoga studio De Lotus.');
  assert.equal(line('en', { exchangeTime: '10:30', exchangePlace: 'Yoga studio De Lotus, Main Street 1' }),
    'We give the presents on Friday 18 December at 10:30, at Yoga studio De Lotus, Main Street 1.');
});

test('exchangeLine leaves braces in a place alone', () => {
  assert.equal(line('en', { exchangePlace: '{date} $& {time}' }), 'We give the presents on Friday 18 December, at {date} $& {time}.');
});

const VIEWS = {
  welcome: () => welcomeView({ participant: ada, event, group, lang: 'nl', tz: TZ, editHref: '/x', langAction: '/l' }),
  waiting: () => waitingView({ participant: ada, event, group, lang: 'nl', tz: TZ, editHref: '/x', langAction: '/l' }),
  about: () => aboutFormView({ event, group, wishes: null, lang: 'nl', tz: TZ, formAction: '/x', langAction: '/l' }),
  result: () => resultView({ participant: ada, receiver: ben, event, group, lang: 'nl', tz: TZ, editHref: '/x', langAction: '/l' }),
  card: () => cardView({ participant: ada, receiver: ben, event, group, lang: 'nl', tz: TZ }),
};

for (const [name, view] of Object.entries(VIEWS)) {
  test(`the ${name} screen shows the time and the escaped place`, () => {
    const body = view().body.toString();
    assert.ok(body.includes('om 10:30 bij'), body);
    assert.ok(textOf(body).includes(escape(PLACE)));
    assert.ok(!body.includes('<b>'));
  });
}

for (const kind of KINDS) {
  test(`${kind} mail carries the time and place, escaped in html and plain in text`, () => {
    const mail = renderEmail(kind, { lang: 'en', participant: { ...ada, language: 'en' }, receiver: ben, event, group, link: 'https://gifts.example.com/p/x', tz: TZ });
    const sentence = `We give the presents on Friday 18 December at 10:30, at ${PLACE}.`;
    assert.ok(mail.html.includes(escape(sentence)));
    assert.ok(!mail.html.includes('<b>'));
    assert.ok(mail.text.split('\n').includes(sentence));
    assert.ok(!mail.text.includes('&lt;'));
  });
}

test('a participant page shows the stored place escaped', async () => {
  const t = await makeTestApp({ clock: () => new Date('2026-11-01T10:00:00.000Z') });
  const seeded = seedGroup(t.ctx, { names: ['Ada', 'Ben', 'Cor'] });
  t.ctx.repo.updateGroup(seeded.group.id, { exchangeTime: '10:30', exchangePlace: PLACE });
  const res = await t.app.inject(`/p/${seeded.people[0].token}`);
  assert.equal(res.statusCode, 200);
  const flat = res.body.replace(/<\/?span[^>]*>/g, '').replace(/<svg class="icon icon-map-pin".*?<\/svg>/, '');
  assert.ok(flat.includes(`om 10:30 bij ${escape(PLACE)}.`));
  assert.ok(res.body.includes('bij <span class="nowrap"><svg class="icon icon-map-pin"'));
  assert.ok(!res.body.includes('<b>'));
});

test('the exchange sentence counts toward the card text size, so a long place keeps the card on one sheet', () => {
  const wishes = { hobbies: 'x'.repeat(380), likes: [], likeDetails: {}, pets: [], petsOther: '', avoid: '', other: '' };
  const card = (place) => cardView({
    participant: ada, receiver: { ...ben, wishes }, event, group: { ...group, exchangePlace: place }, lang: 'nl', tz: TZ,
  }).body.toString();
  assert.ok(card(null).includes('<article class="card">'));
  assert.ok(card('p'.repeat(200)).includes('<article class="card card-smaller">'));
});

test('a card with about a thousand characters of wishes uses the smallest type', () => {
  const wishes = { hobbies: 'x'.repeat(900), likes: [], likeDetails: {}, pets: [], petsOther: '', avoid: '', other: '' };
  const body = cardView({ participant: ada, receiver: { ...ben, wishes }, event, group, lang: 'nl', tz: TZ }).body.toString();
  assert.ok(body.includes('<article class="card card-smallest">'));
});
