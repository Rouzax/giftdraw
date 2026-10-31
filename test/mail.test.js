import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escape } from '../src/html.js';
import { createMailer } from '../src/mail/mailer.js';
import { KINDS, renderEmail } from '../src/mail/templates.js';

const LINK = 'https://gifts.example.com/p/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
const event = { name: 'Gifts 2026', language: 'nl', themeText: null, wishOptions: null, signupDeadline: '2026-11-20' };
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
    // 09:00 Amsterdam on 13 November: a week before the closing day.
    now: new Date('2026-11-13T08:00:00.000Z'),
    ...overrides,
  });
}

test('every kind is rendered', () => {
  assert.deepEqual(KINDS, [
    'invite', 'draw-open', 'remind-wishes', 'remind-draw', 'wishes-updated', 'reassigned',
    'signup', 'remind-signup', 'signup-nudge',
  ]);
});

// Kinds that ask for an answer carry a button for each; the nudge goes to
// people who said no and only points at their page.
const ANSWER_KINDS = ['signup', 'remind-signup'];
const ANSWERS = {
  nl: { yes: 'Ja, ik doe mee', no: 'Nee, deze keer niet' },
  en: { yes: "Yes, I'm taking part", no: 'No, not this time' },
};
const SIGNUP = {
  nl: {
    signup: 'Doe je mee met Gifts 2026?',
    'remind-signup': 'Nog 7 dagen om te zeggen of je meedoet aan Gifts 2026',
    'signup-nudge': 'Weet je zeker dat je niet meedoet met Gifts 2026?',
    deadline: 'tot en met vrijdag 20 november',
  },
  en: {
    signup: 'Are you taking part in Gifts 2026?',
    'remind-signup': '7 days left to say whether you are taking part in Gifts 2026',
    'signup-nudge': 'Are you sure you are not taking part in Gifts 2026?',
    deadline: 'until the end of Friday 20 November',
  },
};

for (const lang of ['nl', 'en']) {
  for (const kind of ANSWER_KINDS) {
    test(`${kind} in ${lang} names the event and the closing date, with a button for each answer`, () => {
      const mail = render(kind, lang);
      const want = SIGNUP[lang];
      const answers = ANSWERS[lang];
      assert.equal(mail.subject, `${EXPECT[lang].app}: ${want[kind]}`);
      for (const body of [mail.html, mail.text]) assert.ok(body.includes(want.deadline), body);
      assert.ok(mail.html.includes(`href="${LINK}?a=yes"`), 'yes button');
      assert.ok(mail.html.includes(`href="${LINK}?a=no"`), 'no button');
      assert.ok(mail.html.indexOf(escape(answers.yes)) < mail.html.indexOf(escape(answers.no)), 'yes first');
      assert.ok(mail.html.indexOf(escape(answers.yes)) > -1, 'yes label');
      assert.equal(mail.html.match(/<a href=/g).length, 3, 'two buttons and the written-out link');
      assert.ok(mail.text.includes(`${answers.yes}:\n${LINK}?a=yes`), mail.text);
      assert.ok(mail.text.includes(`${answers.no}:\n${LINK}?a=no`), mail.text);
    });
  }

  test(`signup-nudge in ${lang} says the door is open until the deadline, with one button`, () => {
    const mail = render('signup-nudge', lang, { participant: { ...ada, language: lang, signup: 'no' } });
    const want = SIGNUP[lang];
    assert.equal(mail.subject, `${EXPECT[lang].app}: ${want['signup-nudge']}`);
    for (const body of [mail.html, mail.text]) assert.ok(body.includes(want.deadline), body);
    assert.equal(mail.html.match(/<a href=/g).length, 2, 'the button and the written-out link');
    assert.ok(!mail.html.includes('?a='), 'no answer in the link');
  });

  test(`the sign-up reminder the day before closing in ${lang} speaks of one day`, () => {
    const mail = render('remind-signup', lang, { now: new Date('2026-11-19T08:00:00.000Z') });
    const want = lang === 'nl'
      ? 'Nog 1 dag om te zeggen of je meedoet aan Gifts 2026'
      : '1 day left to say whether you are taking part in Gifts 2026';
    assert.equal(mail.subject, `${EXPECT[lang].app}: ${want}`);
  });

  test(`the sign-up reminder on the closing day in ${lang} says today is the last day`, () => {
    const mail = render('remind-signup', lang, { now: new Date('2026-11-20T08:00:00.000Z') });
    const want = lang === 'nl'
      ? { subject: 'Vandaag nog: zeg of je meedoet aan Gifts 2026', body: 'Vandaag is de laatste dag' }
      : { subject: 'Today is the last day to say whether you are taking part in Gifts 2026', body: 'Today is the last day' };
    assert.equal(mail.subject, `${EXPECT[lang].app}: ${want.subject}`);
    for (const body of [mail.html, mail.text]) assert.ok(body.includes(want.body), body);
    assert.ok(mail.html.includes(`href="${LINK}?a=yes"`), 'still a button for each answer');
  });
}

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
      const lines = mail.text.split('\n');
      const links = ANSWER_KINDS.includes(kind) ? [`${LINK}?a=yes`, `${LINK}?a=no`] : [LINK];
      for (const link of links) assert.ok(lines.includes(link), 'link on its own line');
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
    assert.ok(body.includes('Tea'));
  }
});

// A pasted shop link in a wish is one long word; on a phone it must wrap
// rather than widen the mail past the screen.
test('every text cell of a mail may break a long word', () => {
  const receiver = { ...ben, wishes: { ...ben.wishes, other: `https://shop.example.com/${'p'.repeat(120)}` } };
  for (const kind of KINDS) {
    const { html } = render(kind, 'nl', { receiver });
    for (const [, style] of html.matchAll(/<(?:p|td)[^>]* style="([^"]*font-size[^"]*)"/g)) {
      assert.match(style, /overflow-wrap:anywhere/, `${kind}: ${style.slice(0, 60)}`);
    }
  }
});

// Mail clients show the text part to people who cannot see the button.
test('the plain text of every mail points at the link, never at a button', () => {
  const opened = { ...group, openedAt: '2026-11-01T10:00:00.000Z' };
  for (const lang of ['nl', 'en']) {
    for (const [kind, g] of [...KINDS.map((k) => [k, group]), ['invite', opened]]) {
      const { text } = render(kind, lang, { group: g });
      assert.doesNotMatch(text, /knop|button/i, `${lang} ${kind}`);
      const intro = ANSWER_KINDS.includes(kind) ? ANSWERS[lang].yes : lang === 'nl' ? 'Open deze link' : 'Open this link';
      assert.ok(text.includes(`${intro}:\n${LINK}`), `${lang} ${kind}`);
    }
  }
});

// A newcomer to an open group gets one mail, so it has to say both things.
test('an invitation into an open group says the draw is open', () => {
  const closed = render('invite', 'nl');
  const open = render('invite', 'nl', { group: { ...group, openedAt: '2026-11-01T10:00:00.000Z' } });
  assert.equal(closed.subject, 'Lootjes trekken: Vertel iets over jezelf');
  assert.equal(open.subject, 'Lootjes trekken: Je kunt meteen een naam trekken');
  assert.ok(open.html.includes('Trek een naam'));
  assert.ok(open.text.includes('al begonnen'));
  const en = render('invite', 'en', { group: { ...group, openedAt: '2026-11-01T10:00:00.000Z' } });
  assert.equal(en.subject, 'Gift Draw: You can draw a name straight away');
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

test('mailer close shuts the pool, and is a no-op when mail is off', async () => {
  let closed = 0;
  const factory = () => ({ sendMail: async () => {}, close: () => { closed += 1; } });
  const smtp = { host: 'mail.example.com', port: 587, user: 'u', pass: 'p', from: 'Gifts <gifts@example.com>' };
  await createMailer({ smtp }, factory).close();
  assert.equal(closed, 1);
  await createMailer({ smtp: null }).close();
});
