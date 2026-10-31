import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_DIR } from '../src/assets.js';
import { KINDS, renderEmail } from '../src/mail/templates.js';
import { aboutFormView, cardView, resultView, signupView, waitingView, welcomeView } from '../src/views/participant.js';
import { makeTestApp, seedGroup } from './helpers.js';

const TZ = 'Europe/Amsterdam';
const THEME = 'Regel <1> van het thema.\n\nRegel 2 & meer.';
const THEME_HTML = 'Regel &lt;1&gt; van het thema.\n\nRegel 2 &amp; meer.';
const THEME_MAIL = 'Regel &lt;1&gt; van het thema.<br><br>Regel 2 &amp; meer.';
const HOBBIES = 'Tuinieren <b>buiten</b>.\nEn koken.';
const HOBBIES_HTML = 'Tuinieren &lt;b&gt;buiten&lt;/b&gt;.\nEn koken.';
const HOBBIES_MAIL = 'Tuinieren &lt;b&gt;buiten&lt;/b&gt;.<br>En koken.';

const event = { name: 'Gifts 2026', language: 'nl', themeText: THEME, wishOptions: null, signupDeadline: '2026-11-20' };
const group = { name: 'Monday', exchangeDate: '2026-12-18', exchangeTime: null, exchangePlace: null };
const ada = { id: 1, name: 'Ada', email: 'ada@example.com', language: 'nl', wishes: null };
const ben = { id: 2, name: 'Ben', email: 'ben@example.com', language: 'nl', wishes: { answers: { hobbies: HOBBIES } } };

const base = { participant: ada, event, group, lang: 'nl', tz: TZ, editHref: '/x', langAction: '/l' };
const VIEWS = {
  welcome: () => welcomeView(base),
  waiting: () => waitingView(base),
  signup: () => signupView({ ...base, state: 'open', signupAction: '/s', pageHref: '/p' }),
  about: () => aboutFormView({ ...base, wishes: null, formAction: '/x' }),
  result: () => resultView({ ...base, receiver: ben }),
  card: () => cardView({ ...base, receiver: ben }),
};

// The pages keep the stored line breaks in the markup and let CSS show them,
// so this reads the rule a selector gets from the stylesheet.
function rule(file, selector) {
  const css = readFileSync(join(PUBLIC_DIR, 'css', file), 'utf8');
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `${selector} in ${file}`);
  return css.slice(at, css.indexOf('}', at));
}

for (const [name, view] of Object.entries(VIEWS)) {
  test(`the ${name} screen keeps the theme's line breaks, escaped`, () => {
    const body = view().body.toString();
    assert.ok(body.includes(`<p>${THEME_HTML}</p>`), body);
    assert.ok(!body.includes('<1>'));
  });
}

test('the result screen and the card keep the line breaks in a typed wish, escaped', () => {
  for (const view of [VIEWS.result, VIEWS.card]) {
    const body = view().body.toString();
    assert.ok(body.includes(`<dd>${HOBBIES_HTML}</dd>`), body);
    assert.ok(!body.includes('<b>'));
  }
});

test('the participant and print stylesheets show line breaks in the theme and the wishes', () => {
  for (const [file, selector] of [
    ['participant.css', '.theme p'],
    ['participant.css', '.wishes dd'],
    ['print.css', '.card .theme p'],
    ['print.css', '.card .wishes dd'],
  ]) {
    assert.match(rule(file, selector), /white-space: pre-line;/, `${selector} in ${file}`);
  }
});

for (const kind of KINDS) {
  test(`${kind} mail shows the theme's line breaks as <br>, every line escaped`, () => {
    const mail = renderEmail(kind, {
      lang: 'nl', participant: ada, receiver: ben, event, group,
      link: 'https://gifts.example.com/p/x', tz: TZ, now: new Date('2026-11-13T08:00:00.000Z'),
    });
    assert.ok(mail.html.includes(THEME_MAIL), mail.html);
    assert.ok(!mail.html.includes('<1>'));
    assert.ok(mail.text.includes(THEME));
  });
}

test('the wishes-updated mail shows the line breaks in a typed wish as <br>, every line escaped', () => {
  const mail = renderEmail('wishes-updated', {
    lang: 'nl', participant: ada, receiver: ben, event, group, link: 'https://gifts.example.com/p/x', tz: TZ,
  });
  assert.ok(mail.html.includes(HOBBIES_MAIL), mail.html);
  assert.ok(!mail.html.includes('<b>'));
  assert.ok(mail.text.includes(HOBBIES));
});

test('each line of a typed wish counts as a printed row toward the card text size', () => {
  const size = (answer) => {
    const body = cardView({ ...base, event: { ...event, themeText: null }, receiver: { ...ben, wishes: { answers: { hobbies: answer } } } })
      .body.toString();
    return /<article class="([^"]*)"/.exec(body)[1];
  };
  assert.equal(size(Array(15).fill('Rood').join(' ')), 'card');
  assert.equal(size(Array(15).fill('Rood').join('\n')), 'card card-smallest');
});

test('the organiser\'s on-behalf screen keeps the theme\'s line breaks', async () => {
  const t = await makeTestApp({ clock: () => new Date('2026-11-01T10:00:00.000Z') });
  const { event: seeded, people } = seedGroup(t.ctx, { names: ['Ada', 'Ben', 'Cor'] });
  t.ctx.repo.updateEvent(seeded.id, { themeText: THEME });
  const res = await t.adminGet(`/admin/participants/${people[0].id}/about`);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes(`<p>${THEME_HTML}</p>`));
  assert.ok(res.body.includes('/static/css/participant.css'));
});
