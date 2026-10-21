import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escape } from '../src/html.js';
import { createMailer } from '../src/mail/mailer.js';
import { KINDS, renderEmail } from '../src/mail/templates.js';

const LINK = 'https://gifts.example.com/p/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
const event = { name: 'Gifts 2026', language: 'nl', themeText: null, wishOptions: null };
const group = { name: 'Monday', exchangeDate: '2026-12-18' };
const ada = { id: 1, name: 'Ada', email: 'ada@example.com', language: 'nl' };
const ben = {
  id: 2,
  name: 'Ben',
  email: 'ben@example.com',
  language: 'nl',
  wishes: { hobbies: 'gardening', likes: ['tea'], likeDetails: {}, pets: [], petsOther: '', avoid: '', other: '' },
};

const EXPECT = {
  nl: { app: 'Lootjes trekken', theme: 'Dit jaar doen we een regift', date: 'vrijdag 18 december' },
  en: { app: 'Gift Draw', theme: "This year it's a regift", date: 'Friday 18 December' },
};

function render(kind, lang, overrides = {}) {
  return renderEmail(kind, {
    lang,
    participant: { ...ada, language: lang },
    receiver: ben,
    event,
    group,
    link: LINK,
    tz: 'Europe/Amsterdam',
    ...overrides,
  });
}

test('every kind is rendered', () => {
  assert.deepEqual(KINDS, ['invite', 'draw-open', 'remind-wishes', 'remind-draw', 'wishes-updated', 'reassigned']);
});

for (const kind of KINDS) {
  for (const lang of ['nl', 'en']) {
    test(`${kind} in ${lang} has link, theme and exchange date in html and text`, () => {
      const mail = render(kind, lang);
      const want = EXPECT[lang];
      assert.ok(mail.subject.startsWith(`${want.app}: `), mail.subject);
      for (const [body, encode] of [[mail.html, escape], [mail.text, String]]) {
        assert.ok(body.includes(encode(LINK)), 'link');
        assert.ok(body.includes(encode(want.theme)), 'theme');
        assert.ok(body.includes(encode(want.date)), 'date');
      }
      assert.ok(mail.html.includes(`href="${LINK}"`));
      assert.ok(mail.text.split('\n').includes(LINK), 'link on its own line');
      assert.ok(mail.html.includes('max-width:600px'));
      assert.ok(!/<img|url\(/i.test(mail.html), 'no images');
      for (const body of [mail.subject, mail.html, mail.text]) assert.ok(!body.includes('\u2014'), 'no em dash');
    });
  }
}

test('body text is at least 18px', () => {
  const { html } = render('invite', 'nl');
  const sizes = [...html.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length > 0);
  assert.ok(sizes.every((size) => size >= 18), sizes.join(','));
});

test('names and custom theme text are escaped', () => {
  const mail = render('reassigned', 'nl', {
    participant: { ...ada, name: '<b>Ada</b>' },
    receiver: { ...ben, name: '<i>Ben</i>' },
    event: { ...event, themeText: 'Bring <script>x</script>' },
  });
  assert.ok(!mail.html.includes('<b>Ada</b>'));
  assert.ok(mail.html.includes('&lt;b&gt;Ada&lt;/b&gt;'));
  assert.ok(!mail.html.includes('<i>Ben</i>'));
  assert.ok(!mail.html.includes('<script>'));
  assert.ok(mail.text.includes('<b>Ada</b>'), 'plain text is not escaped');
});

test('reassigned names only the new receiver', () => {
  const mail = render('reassigned', 'nl', { participant: { ...ada, name: 'Eva' }, receiver: { ...ben, name: 'Dirk' } });
  assert.equal(mail.subject, 'Lootjes trekken: Je lootje is veranderd');
  for (const body of [mail.html, mail.text]) {
    assert.ok(body.includes('Dirk'));
    for (const other of ['Ada', 'Ben', 'Cor']) assert.ok(!body.includes(other), other);
  }
});

test('draw-open never names the receiver', () => {
  const mail = render('draw-open', 'nl');
  for (const body of [mail.subject, mail.html, mail.text]) assert.ok(!body.includes('Ben'));
});

test('wishes-updated lists the receiver\'s current wishes', () => {
  const mail = render('wishes-updated', 'en');
  assert.equal(mail.subject, 'Gift Draw: Ben has changed their wishes');
  for (const body of [mail.html, mail.text]) {
    assert.ok(body.includes('gardening'));
    assert.ok(body.includes('tea'));
  }
});

test('an unknown kind throws', () => {
  assert.throws(() => render('nope', 'nl'), /unknown email kind/);
});

test('mailer is disabled without smtp and send rejects', async () => {
  const mailer = createMailer({ smtp: null });
  assert.equal(mailer.enabled, false);
  await assert.rejects(mailer.send({ to: 'ada@example.com', subject: 's', html: 'h', text: 't' }));
});

test('mailer uses a small pool, timeouts and STARTTLS on 587', async () => {
  const seen = [];
  const factory = (options) => {
    seen.push(options);
    return { sendMail: async (message) => seen.push(message) };
  };
  const smtp = { host: 'mail.example.com', port: 587, user: 'u', pass: 'p', from: 'Gifts <gifts@example.com>' };
  const mailer = createMailer({ smtp }, factory);
  assert.equal(mailer.enabled, true);
  assert.deepEqual(seen[0], {
    host: 'mail.example.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: 'u', pass: 'p' },
    pool: true,
    maxConnections: 2,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });
  await mailer.send({ to: 'ada@example.com', subject: 's', html: 'h', text: 't' });
  assert.deepEqual(seen[1], { from: 'Gifts <gifts@example.com>', to: 'ada@example.com', subject: 's', html: 'h', text: 't' });
});

test('mailer uses implicit TLS on 465 and no auth without a user', () => {
  const seen = [];
  createMailer({ smtp: { host: 'mail.example.com', port: 465, user: null, pass: null, from: 'gifts@example.com' } }, (o) => {
    seen.push(o);
    return {};
  });
  assert.equal(seen[0].secure, true);
  assert.equal(seen[0].requireTLS, false);
  assert.equal(seen[0].auth, undefined);
});
