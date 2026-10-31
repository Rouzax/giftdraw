import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateAssignment } from '../src/draw/cycle.js';
import {
  eventFile, eventFileName, FILE_KEYS, FILE_VERSION, IMPORT_TEXT_MAX, readEventFile,
} from '../src/event-file.js';
import { t as tr } from '../src/i18n/index.js';
import { assistantPrompt } from '../src/import-prompt.js';
import { CHOICES_MAX, QUESTIONS_MAX } from '../src/limits.js';
import { detailPrompt, isBuiltinChoice, isBuiltinQuestion, sameForm, SECTION_IDS, wishForm } from '../src/questions.js';
import { makeTestApp, textOf } from './helpers.js';

const T0 = Date.parse('2026-11-01T10:00:00.000Z');
const TODAY = '2026-11-01';
const EXAMPLE = readFileSync(new URL('../docs/import/example.json', import.meta.url), 'utf8');
const GUIDE = readFileSync(new URL('../docs/guide/import.md', import.meta.url), 'utf8');
const SCHEMA = JSON.parse(readFileSync(new URL('../docs/import/event.schema.json', import.meta.url), 'utf8'));

const read = (value, options = {}) =>
  readEventFile(typeof value === 'string' ? value : JSON.stringify(value), { today: TODAY, ...options });

function file(overrides = {}) {
  return {
    version: 1,
    event: { name: 'Kerst', ...overrides.event },
    groups: overrides.groups ?? [{ name: 'Maandag', exchangeDate: '2026-12-14', participants: ['Ada', 'Ben', 'Cor'] }],
  };
}

const codes = (list) => list.map((p) => p.code);

// Own questions and choices get a fresh id on every import, so two imports
// of one file are compared with those ids numbered by position.
function byPosition(form) {
  return {
    questions: form.questions.map((q, i) => ({
      ...q,
      id: isBuiltinQuestion(q.id) ? q.id : `q${i}`,
      choices: q.choices.map((c, j) => ({ ...c, id: isBuiltinChoice(q.id, c.id) ? c.id : `c${j}` })),
    })),
  };
}
const sameShape = (a, b) => sameForm(byPosition(a), byPosition(b));

// The documented version 1 example, from before forms were lists of
// questions. Version 1 files are still read.
const EXAMPLE_V1 = JSON.stringify({
  version: 1,
  event: {
    name: 'Kerstcadeautjes 2026',
    language: 'nl',
    theme: 'Neem een cadeautje mee dat je zelf hebt gekregen en niet gebruikt.',
    wishOptions: ['Chocolade', 'Thee', { label: 'Boeken', question: 'Welke schrijver?' }, { label: 'Planten of bloemen', askDetails: true }, 'Kaarsen'],
    sections: { pets: { show: false }, other: { heading: 'Nog iets wat je kwijt wilt' } },
  },
  groups: [{ name: 'Maandagochtend', exchangeDate: '2026-12-14', participants: ['Ada', 'Ben', 'Cor'] }],
});

// The form EXAMPLE_V1 describes.
function assertV1ExampleForm(event) {
  assert.equal(event.wishOptions, null, 'the form is stored as questions only');
  const form = wishForm(event);
  assert.deepEqual(form.questions.map((q) => [q.id, q.show, q.text]), [
    ['hobbies', true, null], ['likes', true, null], ['pets', false, null], ['avoid', true, null], ['other', true, 'Nog iets wat je kwijt wilt'],
  ]);
  const likes = form.questions[1].choices;
  const ids = likes.map((c) => c.id);
  assert.deepEqual(ids.slice(0, 2), ['chocolate', 'tea'], 'standard labels keep their built-in ids');
  assert.equal(ids[3], 'plants');
  assert.equal(ids[4], 'candles');
  assert.match(ids[2], /^boeken-[0-9a-f]{4}$/);
  assert.deepEqual(likes.map((c) => [c.own, c.detail, c.question]), [
    [null, false, null], [null, false, null], ['Boeken', true, 'Welke schrijver?'], [null, true, null], [null, false, null],
  ]);
}

// The form docs/import/example.json describes.
function assertExampleForm(event) {
  assert.equal(event.wishOptions, null, 'the form is stored as questions only');
  const form = wishForm(event);
  assert.deepEqual(form.questions.map((q) => [isBuiltinQuestion(q.id) ? q.id : 'own', q.type, q.show, q.text]), [
    ['hobbies', 'text', true, 'Wat doe je graag?'],
    ['likes', 'choices', true, null],
    ['own', 'choices', true, 'Welke kleuren vind je mooi?'],
    ['pets', 'choices', false, null],
    ['avoid', 'text', true, null],
    ['other', 'text', true, 'Nog iets wat je kwijt wilt'],
  ]);
  const likes = form.questions[1].choices;
  const ids = likes.map((c) => c.id);
  assert.deepEqual(ids.slice(0, 2), ['chocolate', 'tea'], 'standard labels keep their built-in ids');
  assert.equal(ids[3], 'plants');
  assert.equal(ids[4], 'candles');
  assert.match(ids[2], /^boeken-[0-9a-f]{4}$/);
  assert.deepEqual(likes.map((c) => [c.own, c.detail, c.question]), [
    [null, false, null], [null, false, null], ['Boeken', true, 'Welke schrijver?'], [null, true, null], [null, false, null],
  ]);
  assert.deepEqual(form.questions[2].choices.map((c) => [c.own, c.detail, c.question]), [
    ['Rood', false, null], ['Blauw', false, null], ['Groen', false, null], ['Een andere kleur', true, 'Welke kleur?'],
  ]);
}

async function setup() {
  const clock = { ms: T0 };
  const t = await makeTestApp({ clock: () => new Date(clock.ms) });
  return { ...t, clock };
}

function unescapeHtml(value) {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function confirmForm(body) {
  const token = /name="formToken" value="([^"]+)"/.exec(body);
  const text = /name="text" value="([^"]*)"/.exec(body);
  assert.ok(token && text, 'the check page carries a confirm form');
  return { confirm: '1', formToken: token[1], text: unescapeHtml(text[1]) };
}

// The file

test('the documented example is a current file and reads without problems', () => {
  assert.equal(JSON.parse(EXAMPLE).version, FILE_VERSION);
  const { errors, warnings, plan } = read(EXAMPLE);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(plan.event.name, 'Kerstcadeautjes 2026');
  assert.equal(plan.event.language, 'nl');
  assert.equal(plan.event.cleanupWeeks, 4);
  assert.match(plan.event.themeText, /^Neem een cadeautje mee/);
  assertExampleForm(plan.event);
  assert.equal(plan.groups.length, 2);
  assert.deepEqual(plan.groups[0].participants[2], { name: 'Cor Bakker', email: null });
  assert.deepEqual(plan.groups[1].participants[0], { name: 'Eva Smit', email: null }, 'a bare name is a participant');
  assert.equal(plan.groups[1].autoOpenAt, null);
});

test('the schema allows exactly the fields the import reads', () => {
  const props = (node) => Object.keys(node.properties).sort();
  const group = SCHEMA.properties.groups.items;
  const { $defs } = SCHEMA;
  assert.deepEqual(props(SCHEMA), [...FILE_KEYS.file].sort());
  assert.deepEqual(SCHEMA.properties.version.enum, [FILE_VERSION, 1]);
  assert.deepEqual(SCHEMA.else.properties.event, { $ref: '#/$defs/event' }, 'a current file has the current event');
  assert.deepEqual(SCHEMA.then.properties.event, { $ref: '#/$defs/eventV1' });
  assert.deepEqual(props($defs.event), [...FILE_KEYS.event].sort());
  assert.deepEqual(props($defs.question), [...FILE_KEYS.question].sort());
  assert.deepEqual(props($defs.choice.oneOf[1]), [...FILE_KEYS.option].sort());
  assert.deepEqual($defs.question.properties.id.enum, SECTION_IDS);
  assert.deepEqual(props($defs.eventV1), [...FILE_KEYS.eventV1].sort());
  assert.deepEqual(props($defs.options.items.oneOf[1]), [...FILE_KEYS.option].sort());
  assert.deepEqual(props($defs.section), [...FILE_KEYS.section].sort());
  assert.deepEqual(props($defs.eventV1.properties.sections), [...SECTION_IDS].sort());
  assert.deepEqual(props(group), [...FILE_KEYS.group].sort());
  assert.deepEqual(props(group.properties.participants.items.oneOf[1]), [...FILE_KEYS.participant].sort());
});

test('a file wrapped in a chat answer, a code fence or a byte order mark is still read', () => {
  const json = JSON.stringify(file());
  for (const text of [`\uFEFF${json}`, `Here is your file:\n\n\`\`\`json\n${json}\n\`\`\`\nGood luck!`, `\`\`\`\n${json}\n\`\`\``]) {
    assert.deepEqual(read(text).errors, [], text.slice(0, 30));
  }
});

test('the file is found in an answer copied without its code fences', () => {
  const json = JSON.stringify(file(), null, 2);
  for (const text of [`Here is your file:\n\n${json}\n\nLet me know if you need changes!`, `${json}\nGood luck {with it}`]) {
    assert.deepEqual(read(text).errors, [], text.slice(0, 20));
  }
});

test('a cut-off file and other JSON mistakes get a message that fits', () => {
  // This runtime gives no position for a trailing comma.
  assert.deepEqual(codes(read('{"version":1,"event":{"name":"K"},"groups":[{"name":"G","exchangeDate":"2026-12-14","participants":["A","B",]}]}').errors), ['json-other']);
  assert.deepEqual(read('{\n  "version": 1,\n  "event": {"name" "K"}\n}').errors, [{ where: [], code: 'json', vars: { line: 3, column: 20 } }]);
  assert.deepEqual(codes(read('{"version": 1, "event": {"name": "K"').errors), ['json-end']);
  assert.deepEqual(codes(read('{"version": 1, "event": {"name": \u201cK\u201d}}').errors).length, 1);
  assert.deepEqual(codes(read('{"version": True}').errors).length, 1);
  assert.ok(!codes(read('{"version": True}').errors).includes('json-start'), 'a text that starts with { is not told to start with {');
});

test('broken JSON is reported with its line and character', () => {
  const { errors } = read('{\n  "version": 1,\n  "event": { "name": "Kerst", },\n}');
  assert.deepEqual(errors, [{ where: [], code: 'json', vars: { line: 3, column: 31 } }]);
  assert.deepEqual(codes(read('Sorry, I cannot do that.').errors), ['json-start']);
  assert.deepEqual(codes(read('[1, 2]').errors), ['not-file']);
  assert.deepEqual(codes(read('   ').errors), ['empty']);
  assert.deepEqual(codes(read('x'.repeat(IMPORT_TEXT_MAX + 1)).errors), ['too-large']);
});

test('the version must be there and be 1 or 2', () => {
  const { version, ...rest } = file();
  assert.equal(version, 1);
  assert.deepEqual(codes(read(rest).errors), ['version-missing']);
  assert.deepEqual(read({ ...rest, version: 2 }).errors, []);
  assert.deepEqual(codes(read({ ...rest, version: 3 }).errors), ['version-newer']);
  assert.deepEqual(codes(read({ ...rest, version: '1' }).errors), ['version-unknown']);
});

test('unknown or misspelt fields are refused where they are', () => {
  const data = file({ groups: [{ name: 'Maandag', exchange_date: '2026-12-14', exchangeDate: '2026-12-14', participants: [{ name: 'Ada', mail: 'a@example.com' }, 'Ben', 'Cor'] }] });
  data.notes = 'x';
  data.event.colour = 'red';
  const { errors } = read(data);
  assert.deepEqual(errors.map((e) => [e.where, e.code, e.vars.key]), [
    [[], 'unknown-key', 'notes'],
    [[{ part: 'event' }], 'unknown-key', 'colour'],
    [[{ group: 1, name: 'Maandag' }], 'unknown-key', 'exchange_date'],
    [[{ group: 1, name: 'Maandag' }, { participant: 1, name: 'Ada' }], 'unknown-key', 'mail'],
  ]);
  const proto = read('{"version":1,"__proto__":{"x":1},"event":{"name":"Kerst"},"groups":[]}');
  assert.deepEqual(codes(proto.errors), ['unknown-key']);
});

test('required fields and wrong types are named', () => {
  assert.deepEqual(read({ version: 1, groups: [] }).errors, [{ where: [], code: 'required', vars: { field: 'event' } }]);
  assert.deepEqual(read({ version: 1, event: { name: 'Kerst' } }).errors, [{ where: [], code: 'required', vars: { field: 'groups' } }]);
  const { errors } = read(file({ event: { name: '  ', language: 'de', cleanupWeeks: 0 }, groups: [{ name: 7, exchangeDate: '2026-12-14', participants: 'Ada' }] }));
  assert.deepEqual(errors.map((e) => [e.code, e.vars.field]), [
    ['required', 'name'], ['language', undefined], ['cleanup-weeks', undefined], ['not-text', 'name'], ['not-list', 'participants'],
  ]);
});

test('group dates follow the group form, a short time is written in full', () => {
  const group = (fields) => read(file({ groups: [{ name: 'G', participants: ['A', 'B', 'C'], ...fields }] }));
  assert.deepEqual(codes(group({ exchangeDate: '2026-10-31' }).errors), ['exchange-past']);
  assert.deepEqual(group({ exchangeDate: '2026-11-01' }).errors, [], 'today is allowed');
  assert.deepEqual(codes(group({ exchangeDate: '2026-02-30' }).errors), ['date']);
  assert.deepEqual(codes(group({ exchangeDate: '14-12-2026' }).errors), ['date']);
  assert.deepEqual(codes(group({ exchangeDate: '2026-12-14', autoOpenAt: '2026-10-01' }).errors), ['auto-open-past']);
  assert.deepEqual(codes(group({ exchangeDate: '2026-12-14', autoOpenAt: '2026-12-15' }).errors), ['auto-open-after']);
  assert.deepEqual(codes(group({ exchangeDate: '2026-12-14', exchangeTime: '25:00' }).errors), ['time']);
  assert.deepEqual(codes(group({}).errors), ['required']);
  assert.equal(group({ exchangeDate: '2026-12-14', exchangeTime: '9:30' }).plan.groups[0].exchangeTime, '09:30');
});

test('participants: emails are checked and stored as the paste stores them', () => {
  const people = [
    { name: 'Ada', email: 'Ada@Example.COM' }, { name: 'Ben', email: '' }, { name: 'Cor', email: null },
    { name: 'Dirk', email: 'dirk@café.nl' },
  ];
  const { errors, plan } = read(file({ groups: [{ name: 'G', exchangeDate: '2026-12-14', participants: people }] }));
  assert.deepEqual(errors, []);
  assert.deepEqual(plan.groups[0].participants.map((p) => p.email), ['ada@example.com', null, null, 'dirk@xn--caf-dma.nl']);
  const bad = read(file({ groups: [{ name: 'G', exchangeDate: '2026-12-14', participants: [{ name: 'Ada', email: 'ada@' }, 'B', 'C'] }] }));
  assert.deepEqual(bad.errors, [{ where: [{ group: 1, name: 'G' }, { participant: 1, name: 'Ada' }], code: 'email', vars: { value: 'ada@' } }]);
});

test('an email address in place of a name is refused, as in a pasted list', () => {
  const { errors } = read(file({ groups: [{ name: 'G', exchangeDate: '2026-12-14', participants: ['ada@example.com', { name: 'ben@example.com' }, { name: 'cor@example.com', email: 'cor@example.com' }, 'Dirk'] }] }));
  assert.deepEqual(errors.map((e) => [e.where[1].participant, e.code]), [[1, 'name-is-email'], [2, 'name-is-email']]);
});

test('text is cleaned like the forms clean it, and refused past their limits', () => {
  const ok = read(file({ event: { name: ' Kerst\n 2026 ', theme: 'Regel 1\r\nRegel 2  ' }, groups: [{ name: 'G', exchangeDate: '2026-12-14', exchangePlace: 'De\nLotus', participants: ['  Ada  de Vries ', 'B', 'C'] }] }));
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.plan.event.name, 'Kerst 2026');
  assert.equal(ok.plan.event.themeText, 'Regel 1\nRegel 2');
  assert.equal(ok.plan.groups[0].exchangePlace, 'De Lotus');
  assert.equal(ok.plan.groups[0].participants[0].name, 'Ada de Vries');
  const long = read(file({ event: { name: 'x'.repeat(101) }, groups: [{ name: 'G', exchangeDate: '2026-12-14', exchangePlace: 'p'.repeat(201) }] }));
  assert.deepEqual(long.errors.map((e) => [e.code, e.vars.field, e.vars.max]), [['too-long', 'name', 100], ['too-long', 'exchangePlace', 200]]);
  assert.deepEqual(read(file({ event: { name: '😀'.repeat(50) } })).errors, [], 'an emoji counts as two, as maxlength counts');
  assert.deepEqual(codes(read(file({ event: { name: 'Ke\u0000rst' } })).errors), ['bad-characters']);
  assert.deepEqual(codes(read('{"version":1,"event":{"name":"Ke\\ud800rst"},"groups":[]}').errors), ['bad-characters']);
});

test('settings equal to the defaults are stored as defaults, so they follow the language', () => {
  const standard = ['Chocolade?', 'Thee', 'Koffie', 'Bad- of doucheproducten', 'Kaarsen', 'Boeken of puzzels', 'Planten of bloemen', 'Wijn'].map((label) =>
    (label.endsWith('?') ? { label: label.slice(0, -1), askDetails: true } : label));
  const { errors, plan } = read(file({
    event: {
      name: 'Kerst',
      theme: tr('en', 'theme.default'),
      wishOptions: standard,
      petOptions: ['Dog', 'Cat', { label: 'Other', askDetails: true }],
      sections: { hobbies: { show: true, heading: "Hobby's en interesses" }, likes: {} },
    },
  }));
  assert.deepEqual(errors, []);
  assert.equal(plan.event.themeText, null);
  assert.equal(plan.event.wishOptions, null);
  assert.equal(plan.event.formConfig, null);
});

test('tick lists: empty, repeated or unshaped choices are refused', () => {
  assert.deepEqual(codes(read(file({ event: { name: 'K', wishOptions: [] } })).errors), ['options-empty']);
  const twice = read(file({ event: { name: 'K', wishOptions: ['Thee', 'thee'] } }));
  assert.deepEqual(twice.errors, []);
  assert.deepEqual(twice.warnings, [{ where: [{ part: 'event' }, { option: 'wishOptions', n: 2 }], code: 'option-twice', vars: { label: 'thee' } }]);
  assert.deepEqual(codes(read(file({ event: { name: 'K', petOptions: [3] } })).errors), ['option-shape']);
  assert.deepEqual(codes(read(file({ event: { name: 'K', wishOptions: [{ label: 'Boeken', question: 'q'.repeat(81) }] } })).errors), ['too-long']);
  assert.deepEqual(codes(read(file({ event: { name: 'K', wishOptions: ['x'.repeat(3000), 'y'.repeat(1001)] } })).errors), ['options-too-long']);
  const many = Array.from({ length: CHOICES_MAX + 1 }, (_, i) => `Keuze ${i}`);
  const both = read(file({ event: { name: 'K', wishOptions: many, petOptions: many } })).errors;
  assert.deepEqual(both.map((e) => [e.code, e.vars.field]), [['options-too-many', 'wishOptions'], ['options-too-many', 'petOptions']]);
  assert.notEqual(...both.map((e) => tr('en', `import.error.${e.code}`, e.vars)), 'each message names its list');
  assert.deepEqual(read(file({ event: { name: 'K', petOptions: many.slice(1) } })).errors, []);
  assert.deepEqual(codes(read(file({ event: { name: 'K', sections: { music: { show: false } } } })).errors), ['unknown-section']);
  assert.deepEqual(codes(read(file({ event: { name: 'K', sections: { pets: { show: 'no' } } } })).errors), ['not-boolean']);
  const marks = read(file({ event: { name: 'K', wishOptions: [
    'Boeken? Welke schrijver', 'Wijn?', { label: 'Kaas?', question: 'Welke soort??' }, '?? Thee'] } }));
  assert.deepEqual(marks.errors.map((e) => e.vars.field), ['label'], 'a text that is only a question has no choice');
  const lines = read(file({ event: { name: 'K', wishOptions: ['Boeken? Welke schrijver', 'Wijn?', { label: 'Kaas?', question: 'Welke soort??' }] } }));
  assert.deepEqual(wishForm(lines.plan.event).questions[1].choices.map((c) => [c.label('nl'), c.detail, c.question]),
    [['Boeken', true, 'Welke schrijver?'], ['Wijn', true, null], ['Kaas', true, 'Welke soort?']], 'a text reads as a line of the event form');
});

test('warnings point out what is allowed but probably not meant', () => {
  const groups = [
    { name: 'Maandag', exchangeDate: '2026-12-14', participants: ['Ada', 'Ben', 'Cor'] },
    { name: 'maandag', exchangeDate: '2026-12-14', participants: [{ name: 'Dirk', email: 'dirk@example.com' }] },
  ];
  const { errors, warnings } = read(file({ event: { name: 'Kerst 2025' }, groups }), { existingNames: new Set(['kerst 2025']) });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings.map((w) => [w.where[0]?.group ?? w.where[0]?.part, w.code]), [
    ['event', 'event-exists'],
    [2, 'group-name-twice'],
    [2, 'small-group'],
  ]);
  assert.deepEqual(codes(read(file({ groups: [] })).warnings), ['no-groups']);
});

test('the same address or the same name twice in a group is an error naming the first', () => {
  const groups = [
    { name: 'Maandag', exchangeDate: '2026-12-14', participants: [
      { name: 'Ada', email: 'ada@example.com' }, { name: ' ADA ', email: 'ada2@example.com' }, 'Ben', { name: 'Cor', email: 'Ada@Example.com' }] },
  ];
  const { errors, plan } = read(file({ groups }));
  assert.equal(plan, null);
  assert.deepEqual(errors.map((e) => [e.where.map((w) => w.group ?? w.participant), e.code, e.vars.earlier]), [
    [[1, 2], 'name-twice', [{ participant: 1, name: 'Ada' }]],
    [[1, 4], 'email-twice', [{ participant: 1, name: 'Ada' }]],
  ]);
});

test('one address in two groups of a file is a warning, so one person can join two classes', async () => {
  const groups = [
    { name: 'Maandag', exchangeDate: '2026-12-14', participants: [{ name: 'Ada', email: 'ada@example.com' }, 'Ben', 'Cor'] },
    { name: 'Dinsdag', exchangeDate: '2026-12-15', participants: [{ name: 'Ada', email: 'ADA@example.com' }, 'Dirk', 'Eva'] },
  ];
  const { errors, warnings, plan } = read(file({ groups }));
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, [{
    where: [{ group: 2, name: 'Dinsdag' }, { participant: 1, name: 'Ada' }],
    code: 'email-elsewhere',
    vars: { email: 'ada@example.com', group: 'Maandag' },
  }]);
  assert.ok(plan);
  const t = await setup();
  const check = await t.adminPost('/admin/events/import', { text: JSON.stringify(file({ groups })) });
  assert.equal(check.statusCode, 200);
  assert.match(textOf(check.body), /Groep 2 \(Dinsdag\), deelnemer 1 \(Ada\): ada@example\.com staat ook in groep Maandag\./);
  const res = await t.adminPost('/admin/events/import', confirmForm(check.body));
  assert.equal(res.statusCode, 303);
  assert.equal(t.ctx.repo.listEventParticipants(t.ctx.repo.listEvents()[0].id).length, 6);
});

test('a file has at most so many groups and participants per group', () => {
  const groups = Array.from({ length: 51 }, (_, i) => ({ name: `G${i}`, exchangeDate: '2026-12-14' }));
  assert.deepEqual(codes(read(file({ groups })).errors), ['too-many-groups']);
  const people = Array.from({ length: 501 }, (_, i) => `P${i}`);
  assert.deepEqual(codes(read(file({ groups: [{ name: 'G', exchangeDate: '2026-12-14', participants: people }] })).errors), ['too-many-participants']);
});

test('a file without a valid version is read by its shape, and told which version to add', () => {
  const { version, ...rest } = file({ event: { name: 'K', wishOptions: ['Thee'], sections: { pets: { show: false } } } });
  assert.equal(version, 1);
  assert.deepEqual(read(rest).errors, [{ where: [], code: 'version-missing', vars: { version: 1 } }], 'old keys: version 1');
  assert.deepEqual(read({ ...rest, version: '1' }).errors, [{ where: [], code: 'version-unknown', vars: { oldest: 1, newest: 2 } }]);
  const v2 = { ...rest, event: { name: 'K', questions: [{ type: 'text', text: 'Favoriete auto' }] } };
  assert.deepEqual(read(v2).errors, [{ where: [], code: 'version-missing', vars: { version: 2 } }], 'questions: version 2');
  assert.deepEqual(read({ ...rest, event: { name: 'K' } }).errors, [{ where: [], code: 'version-missing', vars: { version: 2 } }]);
  const both = read({ ...rest, event: { name: 'K', sections: {}, questions: [{ type: 'text', text: 'x' }] } }).errors;
  assert.deepEqual(both.map((e) => [e.code, e.vars.version ?? e.vars.key]), [['version-missing', 2], ['unknown-key', 'sections']]);
});

test('a version 1 label too long for the form is cut, with a warning', () => {
  const long = `${'x'.repeat(79)}yz`;
  const { errors, warnings, plan } = read(file({ event: { name: 'K', wishOptions: ['Thee', long] } }));
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, [{ where: [{ part: 'event' }, { option: 'wishOptions', n: 2 }], code: 'label-cut', vars: { label: long, max: 80 } }]);
  assert.equal(wishForm(plan.event).questions[1].choices[1].own, `${'x'.repeat(79)}y`);
});

test('the check page shows a cut version 1 label as a warning', async () => {
  const t = await setup();
  const res = await t.adminPost('/admin/events/import', { text: JSON.stringify(file({ event: { name: 'K', wishOptions: ['x'.repeat(81)] } })) });
  assert.equal(res.statusCode, 200);
  assert.match(textOf(res.body), /Evenement, de keuzes bij &quot;Ik houd van\.\.\.&quot;, keuze 1: &quot;x{40}…&quot; is langer dan 80 tekens en wordt ingekort\./);
});

// Version 2: the form as questions

const BUILTINS = [
  { id: 'hobbies', type: 'text' }, { id: 'likes', type: 'choices' }, { id: 'pets', type: 'choices' },
  { id: 'avoid', type: 'text' }, { id: 'other', type: 'text' },
];

function file2(questions, event = {}) {
  return { ...file(), version: 2, event: { name: 'Kerst', ...(questions === undefined ? {} : { questions }), ...event } };
}

const formOf = (data) => {
  const { errors, plan } = read(data);
  assert.deepEqual(errors, []);
  return wishForm(plan.event);
};

test('a version 2 file adds its own questions in the order given', () => {
  const { errors, plan } = read(file2([...BUILTINS, { type: 'text', text: 'Favoriete auto' }]));
  assert.deepEqual(errors, []);
  assert.equal(plan.event.wishOptions, null);
  const form = wishForm(plan.event);
  assert.deepEqual(form.questions.slice(0, 5).map((q) => q.id), ['hobbies', 'likes', 'pets', 'avoid', 'other']);
  const own = form.questions[5];
  assert.match(own.id, /^q-[0-9a-f]{4}$/);
  assert.deepEqual([own.type, own.text, own.show], ['text', 'Favoriete auto', true]);
  assert.ok(sameForm({ questions: form.questions.slice(0, 5) }, wishForm({})), 'built-ins by id are the built-in questions');
});

test('a version 2 file without questions has the built-in form, stored as nothing', () => {
  const { errors, plan } = read(file2(undefined));
  assert.deepEqual(errors, []);
  assert.equal(plan.event.formConfig, null);
  assert.equal(plan.event.wishOptions, null);
  assert.equal(read(file2(BUILTINS)).plan.event.formConfig, null, 'the five built-ins as listed are the default too');
});

test('a built-in question keeps its id with own wording; the built-in wording in any language stays built in', () => {
  const form = formOf(file2([
    { id: 'avoid', type: 'text', text: '  Liever\nniet  ' }, { id: 'hobbies', type: 'text', text: 'Hobbies and interests', show: false },
  ]));
  assert.deepEqual(form.questions.map((q) => [q.id, q.text, q.show]), [['avoid', 'Liever niet', true], ['hobbies', null, false]]);
});

test('choices: text or objects, built-in labels in any language keep their built-in id', () => {
  const form = formOf(file2([
    { id: 'likes', type: 'choices', choices: ['Tea', 'Chocolade? Welke soort??', { label: 'Boeken', question: 'Welke schrijver' }, { label: 'Wol', askDetails: true }, 'thee'] },
    { type: 'choices', text: 'Welke kleur?', choices: ['Rood', 'Thee'] },
  ]));
  const [likes, colour] = form.questions;
  assert.deepEqual(likes.choices.map((c) => [c.id.replace(/-[0-9a-f]{4}$/, ''), c.own, c.detail, c.question]), [
    ['tea', null, false, null], ['chocolate', null, true, 'Welke soort?'], ['boeken', 'Boeken', true, 'Welke schrijver?'],
    ['wol', 'Wol', true, null], ['thee', 'thee', false, null],
  ]);
  assert.deepEqual(colour.choices.map((c) => [c.id.replace(/-[0-9a-f]{4}$/, ''), c.own]), [['rood', 'Rood'], ['thee', 'Thee']],
    'an own question has no built-in choices');
  const pets = formOf(file2([{ id: 'pets', type: 'choices' }])).questions[0];
  assert.deepEqual(pets.choices.map((c) => c.id), ['dog', 'cat', 'other'], 'a built-in list without choices keeps its own');
});

test('version 2 problems are named where they are', () => {
  const at = (n, choice) => [{ part: 'event' }, { question: n }, ...(choice ? [{ choice }] : [])];
  const problems = (questions, event) => read(file2(questions, event)).errors.map((e) => [e.where, e.code]);
  assert.deepEqual(problems([{ type: 'list', text: 'x' }]), [[at(1), 'question-type']]);
  assert.deepEqual(problems([{ text: 'x' }]), [[at(1), 'question-type']]);
  assert.deepEqual(problems([{ id: 'likes', type: 'text' }]), [[at(1), 'question-id-type']]);
  assert.deepEqual(problems([{ type: 'text' }, { type: 'text', text: '   ' }]), [[at(1), 'question-text'], [at(2), 'question-text']]);
  assert.deepEqual(problems([{ id: 'music', type: 'text', text: 'x' }]), [[at(1), 'question-id']]);
  assert.deepEqual(problems([{ id: 'hobbies', type: 'text' }, { id: 'hobbies', type: 'text' }]), [[at(2), 'question-id']]);
  assert.deepEqual(problems([{ type: 'text', text: 'x', choices: ['a'] }]), [[at(1), 'choices-on-text']]);
  assert.deepEqual(problems([{ type: 'choices', text: 'x' }]), [[at(1), 'choices-empty']]);
  assert.deepEqual(problems([{ id: 'likes', type: 'choices', choices: [] }]), [[at(1), 'choices-empty']]);
  assert.deepEqual(problems([{ id: 'likes', type: 'choices', choices: ['a', 7, { label: '  ' }, '?'] }]),
    [[at(1, 2), 'option-shape'], [at(1, 3), 'required'], [at(1, 4), 'required']]);
  assert.deepEqual(problems([{ type: 'text', text: 'x', show: 'no', colour: 1 }]), [[at(1), 'unknown-key'], [at(1), 'not-boolean']]);
  assert.deepEqual(problems([]), [[[{ part: 'event' }], 'questions-empty']]);
  assert.deepEqual(problems('x'), [[[{ part: 'event' }], 'not-list']]);
  assert.deepEqual(problems([7]), [[at(1), 'not-object']]);
  const many = Array.from({ length: QUESTIONS_MAX + 1 }, (_, i) => ({ type: 'text', text: `Vraag ${i}` }));
  assert.deepEqual(problems(many), [[[{ part: 'event' }], 'too-many-questions']]);
  assert.deepEqual(problems(many.slice(1)), []);
  const choices = Array.from({ length: CHOICES_MAX + 1 }, (_, i) => `Keuze ${i}`);
  assert.deepEqual(problems([{ type: 'choices', text: 'x', choices }]), [[at(1), 'too-many-choices']]);
  assert.deepEqual(problems([{ type: 'choices', text: 'x', choices: choices.slice(1) }]), []);
  for (const key of ['wishOptions', 'petOptions', 'sections']) {
    assert.deepEqual(problems(undefined, { [key]: null }), [[[{ part: 'event' }], 'unknown-key']], key);
  }
  assert.deepEqual(codes(read({ ...file(), event: { name: 'K', questions: [] } }).errors), ['unknown-key'], 'version 1 has no questions');
});

test('version 2 text past its limit is refused, as version 1 text is', () => {
  const errors = (questions) => read(file2(questions)).errors.map((e) => [e.code, e.vars.field, e.vars.max]);
  assert.deepEqual(errors([{ type: 'text', text: 'x'.repeat(81) }]), [['too-long', 'text', 80]]);
  assert.deepEqual(errors([{ type: 'text', text: '😀'.repeat(80) }]), [], 'counted in code points, as the edit page does');
  assert.deepEqual(errors([{ type: 'choices', text: 'x', choices: ['y'.repeat(81)] }]), [['too-long', 'label', 80]]);
  assert.deepEqual(errors([{ type: 'choices', text: 'x', choices: [{ label: 'y', question: 'q'.repeat(81) }] }]), [['too-long', 'question', 80]]);
  const fits = read(file2([{ type: 'choices', text: 'x', choices: [`y? ${'q'.repeat(79)}?`] }]));
  assert.deepEqual(codes(fits.warnings), [], 'eighty characters with the question mark fit');
  assert.equal(wishForm(fits.plan.event).questions[0].choices[0].question, `${'q'.repeat(79)}?`);
  // The edit page takes QUESTION_MAX - 1 characters and adds the mark, so
  // a follow-up that only fits without its mark is cut the same way, and
  // the organiser is told.
  const cut = read(file2([{ type: 'choices', text: 'x', choices: [`y? ${'q'.repeat(80)}`] }]));
  assert.deepEqual(cut.errors, []);
  assert.deepEqual(cut.warnings.map((w) => [w.code, w.where, w.vars.max]),
    [['question-cut', [{ part: 'event' }, { question: 1 }, { choice: 1 }], 80]]);
  assert.equal(wishForm(cut.plan.event).questions[0].choices[0].question, `${'q'.repeat(79)}?`);
  assert.deepEqual(read(file2([{ type: 'choices', text: 'x', choices: [{ label: 'y', question: '???' }] }])).warnings, [], 'nothing to cut');
});

test('a follow-up that is the built-in one in any language stays built in, so it follows the reader', () => {
  const [likes, pets, own] = formOf(file2([
    { id: 'likes', type: 'choices', choices: ['Chocolade? Welke smaak?', 'Wijn? anything in particular', 'Thee? Welke soort?'] },
    { id: 'pets', type: 'choices', choices: ['Hond', 'Ander dier? which animal??'] },
    { type: 'choices', text: 'Kleur', choices: [{ label: 'Rood', question: 'Iets in het bijzonder?' }, 'Blauw? Which flavour?'] },
  ])).questions;
  const shape = (q) => q.choices.map((c) => [c.id.replace(/-[0-9a-f]{4}$/, ''), c.detail, c.question]);
  assert.deepEqual(shape(likes), [['chocolate', true, null], ['wine', true, null], ['tea', true, 'Welke soort?']]);
  assert.deepEqual(shape(pets), [['dog', false, null], ['other', true, null]]);
  assert.deepEqual(shape(own), [['rood', true, null], ['blauw', true, 'Which flavour?']], 'only the prompt that choice would ask itself');
  const v1 = read({ ...file(), event: { name: 'K', wishOptions: ['Chocolade? Welke smaak?'] } });
  assert.deepEqual(wishForm(v1.plan.event).questions[1].choices[0].question, null, 'also in a version 1 file');
});

test('a repeated choice in version 2 is pointed out, not refused', () => {
  const { errors, warnings } = read(file2([{ type: 'choices', text: 'x', choices: ['Rood', 'rood'] }]));
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings.filter((w) => w.code === 'option-twice').map((w) => w.where),
    [[{ part: 'event' }, { question: 1 }, { choice: 2 }]]);
});

test('a version 1 file and its version 2 download give the same form', async () => {
  const t = await setup();
  const v1 = read(EXAMPLE_V1).plan;
  assertV1ExampleForm(v1.event);
  const id = t.ctx.repo.createEvent(v1.event, t.ctx.nowIso());
  const exported = eventFile(t.ctx.repo.getEvent(id), []);
  assert.equal(exported.version, 2);
  assert.deepEqual(Object.keys(exported.event), ['name', 'language', 'cleanupWeeks', 'theme', 'questions']);
  assert.ok(sameShape(formOf(exported), wishForm(v1.event)));
});

test('the download writes only what differs from the built-in form', () => {
  const event = (formConfig, extra = {}) => ({ name: 'K', language: 'nl', cleanupWeeks: 4, themeText: null, wishOptions: null, formConfig, ...extra });
  assert.ok(!('questions' in eventFile(event(null), []).event), 'the built-in form is left out');
  const { questions } = eventFile(event({ questions: [
    { id: 'hobbies', type: 'text', show: false },
    { id: 'likes', type: 'choices' },
    { id: 'pets', type: 'choices', choices: [{ id: 'dog' }, { id: 'vogel-ab12', label: 'Vogel', detail: true, question: 'Welke soort?' }, { id: 'other', detail: true }] },
    { id: 'q-1a2b', type: 'choices', text: 'Kleur', choices: [{ id: 'rood-cd34', label: 'Rood', detail: true }] },
    { id: 'avoid', type: 'text', text: 'Liever niet' },
  ] }), []).event;
  assert.deepEqual(questions, [
    { id: 'hobbies', type: 'text', show: false },
    { id: 'likes', type: 'choices' },
    { id: 'pets', type: 'choices', choices: ['Hond', 'Vogel? Welke soort?', 'Ander dier?'] },
    { type: 'choices', text: 'Kleur', choices: ['Rood?'] },
    { id: 'avoid', type: 'text', text: 'Liever niet' },
  ]);
});

test('an event downloaded and imported again has the same form', async () => {
  const t = await setup();
  const { repo } = t.ctx;
  const formConfig = { questions: [
    { id: 'q-1a2b', type: 'text', text: 'Favoriete auto' },
    { id: 'likes', type: 'choices', text: 'Lekker', choices: [
      { id: 'tea', label: '' }, { id: 'boeken-1a2b', label: 'Boeken', detail: true, question: 'Welke schrijver?' },
      { id: 'chocolate', detail: true, question: 'Welke soort?' }, { id: 'wol-ab12', label: 'Wol? of garen', detail: false },
    ] },
    { id: 'pets', type: 'choices', show: false },
    { id: 'q-3c4d', type: 'choices', text: 'Kleur', show: false, choices: [{ id: 'rood-cd34', label: 'Rood', detail: true }, { id: 'blauw-ef56', label: 'Blauw' }] },
  ] };
  for (const language of ['nl', 'en']) {
    const id = repo.createEvent({ name: `K ${language}`, language, formConfig }, t.ctx.nowIso());
    const event = repo.getEvent(id);
    assert.ok(sameShape(formOf(eventFile(event, [])), wishForm(event)), language);
  }
});

test('an own choice that reads like a built-in one stays the organiser\'s own after a download', async () => {
  const t = await setup();
  const { repo } = t.ctx;
  const formConfig = { questions: [
    { id: 'likes', type: 'choices', choices: [
      { id: 'tea', detail: false }, { id: 'thee-1a2b', label: 'thee' }, { id: 'tea-3c4d', label: 'Tea', detail: true },
      { id: 'thee-5e6f', label: 'Thee', detail: true, question: 'Welke soort?' },
    ] },
    { id: 'pets', type: 'choices', choices: [{ id: 'hond-ab12', label: 'Dog' }, { id: 'cat' }] },
  ] };
  for (const language of ['nl', 'en']) {
    const event = repo.getEvent(repo.createEvent({ name: `K ${language}`, language, formConfig }, t.ctx.nowIso()));
    const imported = formOf(eventFile(event, []));
    assert.ok(sameShape(imported, wishForm(event)), language);
    assert.deepEqual(imported.questions[0].choices.map((c) => c.own), [null, 'thee', 'Tea', 'Thee'], language);
  }
});

// A renamed built-in choice becomes an own choice on import, which would
// ask the general follow-up; its built-in one is written out as wording.
test('a renamed built-in choice keeps its built-in follow-up after a download', async () => {
  const t = await setup();
  const { repo } = t.ctx;
  const formConfig = { questions: [
    { id: 'likes', type: 'choices', choices: [{ id: 'chocolate', label: 'Bonbons', detail: true }, { id: 'tea', label: 'Theetjes', detail: true }] },
    { id: 'pets', type: 'choices', choices: [{ id: 'dog' }, { id: 'other', label: 'Ander huisdier', detail: true }] },
  ] };
  const asked = (form) => form.questions.filter((q) => q.type === 'choices')
    .flatMap((q) => q.choices.map((c) => [c.label('nl'), detailPrompt(c, form.lang)]));
  for (const language of ['nl', 'en']) {
    const event = repo.getEvent(repo.createEvent({ name: `K ${language}`, language, formConfig }, t.ctx.nowIso()));
    const exported = eventFile(event, []);
    const choices = exported.event.questions.find((q) => q.id === 'likes').choices;
    assert.equal(choices[0], `Bonbons? ${tr(language, 'wish.detail.chocolate')}`, language);
    assert.equal(choices[1], 'Theetjes?', 'a general follow-up stays general');
    const pets = exported.event.questions.find((q) => q.id === 'pets').choices;
    assert.equal(pets[1], `Ander huisdier? ${tr(language, 'wish.petsOther')}`, language);
    const prompts = (form) => asked({ ...form, lang: language });
    assert.deepEqual(prompts(formOf(exported)), prompts(wishForm(event)), language);
  }
});

// A label with a question mark, or one that reads as a built-in choice,
// is written as an object; the built-in follow-up goes with it.
test('a renamed built-in choice written as an object keeps its built-in follow-up', async () => {
  const t = await setup();
  const { repo } = t.ctx;
  const formConfig = { questions: [
    { id: 'likes', type: 'choices', choices: [{ id: 'chocolate', label: 'Bonbons?!', detail: true }] },
    { id: 'pets', type: 'choices', choices: [{ id: 'other', label: 'Cat', detail: true }] },
  ] };
  const event = repo.getEvent(repo.createEvent({ name: 'K', language: 'nl', formConfig }, t.ctx.nowIso()));
  const exported = eventFile(event, []);
  const choices = (form, id) => form.event.questions.find((q) => q.id === id).choices;
  assert.deepEqual(choices(exported, 'likes'), [{ label: 'Bonbons?!', question: tr('nl', 'wish.detail.chocolate') }]);
  assert.deepEqual(choices(exported, 'pets'), [{ label: 'Cat', question: tr('nl', 'wish.petsOther') }]);
  const imported = formOf(exported);
  const asked = (form) => form.questions.flatMap((q) => q.choices.map((c) => [c.label('nl'), detailPrompt(c, 'nl')]));
  assert.deepEqual(asked(imported), asked(wishForm(event)));
});

test('in version 2 a choice written as text takes a built-in label leniently, an object is taken as typed', () => {
  const [likes] = formOf(file2([{ id: 'likes', type: 'choices', choices: ['tea', { label: 'Thee' }, { label: 'Koffie', askDetails: true }] }])).questions;
  assert.deepEqual(likes.choices.map((c) => [c.id.replace(/-[0-9a-f]{4}$/, ''), c.own]), [['tea', null], ['thee', 'Thee'], ['koffie', 'Koffie']]);
});

test('a stored built-in choice without a label of its own downloads and imports again', async () => {
  const t = await setup();
  const { repo } = t.ctx;
  const id = repo.createEvent({ name: 'K', language: 'en', wishOptions: [
    { id: 'tea', label: '', detail: false }, { id: 'wol-ab12', label: 'Wol', detail: false },
  ] }, t.ctx.nowIso());
  const event = repo.getEvent(id);
  const exported = eventFile(event, []);
  assert.deepEqual(exported.event.questions.find((q) => q.id === 'likes').choices, ['Tea', 'Wol']);
  assert.ok(sameShape(formOf(exported), wishForm(event)));
});

test('an empty choice label in version 1 is still refused', () => {
  for (const label of ['', '  ', '?']) {
    assert.deepEqual(read(file({ event: { name: 'K', wishOptions: [{ label }] } })).errors.map((e) => [e.code, e.vars.field]), [['required', 'label']], label);
  }
});

test('version 1 tick lists match built-in labels in any letter case, once each', () => {
  const form = formOf(file({ event: { name: 'K', language: 'en', wishOptions: ['thee', 'Tea', 'Hond'], petOptions: ['Thee', 'Dog'] } }));
  const ids = (id) => form.questions.find((q) => q.id === id).choices.map((c) => c.id.replace(/-[0-9a-f]{4}$/, ''));
  assert.deepEqual(ids('likes'), ['tea', 'tea', 'hond']);
  assert.match(form.questions[1].choices[1].id, /^tea-[0-9a-f]{4}$/, 'the second one is a choice of its own');
  assert.deepEqual(ids('pets'), ['thee', 'dog'], 'a pet list never takes a like id');
});

test('a choice written as text splits at the first question mark, extra marks dropped', () => {
  const lines = ['Boeken? Welke schrijver? Of genre?', 'Wol?? Welke kleur', 'Kaas? Welke soort ? ', 'Brood?   '];
  for (const data of [file({ event: { name: 'K', wishOptions: lines } }), file2([{ id: 'likes', type: 'choices', choices: lines }])]) {
    assert.deepEqual(formOf(data).questions.find((q) => q.id === 'likes').choices.map((c) => [c.own, c.detail, c.question]), [
      ['Boeken', true, 'Welke schrijver? Of genre?'], ['Wol', true, 'Welke kleur?'], ['Kaas', true, 'Welke soort?'], ['Brood', true, null],
    ], `version ${data.version}`);
  }
});

test('the check page lists the questions of a version 2 file', async () => {
  const t = await setup();
  const text = JSON.stringify(file2([
    { type: 'choices', text: 'Kleur', show: false, choices: ['Rood? Welke tint?', 'Blauw'] },
    { id: 'hobbies', type: 'text' },
  ]));
  const nl = textOf((await t.adminPost('/admin/events/import', { text })).body);
  assert.match(nl, /Kleur\s*Aanvinklijst, 2 keuzes\s*Verborgen/);
  assert.match(nl, /Rood: Welke tint\?/);
  assert.match(nl, /Blauw/);
  assert.match(nl, /Hobby&#39;s en interesses\s*Tekstvak/);
  const en = textOf((await t.adminPost('/admin/events/import', { text }, { cookie: `${t.adminCookie()}; giftdraw_lang=en` })).body);
  assert.match(en, /Hobbies and interests\s*Text box/);
  assert.match(en, /Kleur\s*Tick list, 2 choices\s*Hidden/);
});

test('version 2 problems name the question and the choice', async () => {
  const t = await setup();
  const text = JSON.stringify(file2([{ id: 'likes', type: 'choices', choices: ['Thee', 7] }]));
  const res = await t.adminPost('/admin/events/import', { text });
  assert.equal(res.statusCode, 400);
  assert.match(textOf(res.body), /Evenement, vraag 1, keuze 2: Een keuze moet tekst zijn/);
});

// The pages

test('the import page offers a text field, and a file picker only with script', async () => {
  const t = await setup();
  const res = await t.adminGet('/admin/events/import');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<textarea id="import-text" name="text"/);
  assert.match(res.body, /<p class="import-file" hidden>/);
  assert.match(res.body, /js\/import-file\.js/);
  assert.match((await t.adminGet('/admin')).body, /href="\/admin\/events\/import"/);
});

test('the import page offers the assistant request in the organiser\'s language, ready to copy', async () => {
  const t = await setup();
  const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const nl = await t.adminGet('/admin/events/import');
  assert.ok(nl.body.includes(`data-copy-source>${escape(assistantPrompt('nl'))}</textarea>`));
  assert.match(nl.body, /<button type="button" class="primary with-icon" data-copy hidden>/);
  assert.match(nl.body, /js\/copy-link\.js/);
  const en = await t.adminGet('/admin/events/import', { cookie: `${t.adminCookie()}; giftdraw_lang=en` });
  assert.ok(en.body.includes(escape(assistantPrompt('en'))));
  assert.match(assistantPrompt('en'), /"language": "en"/);
  assert.match(assistantPrompt('nl'), /"language": "nl"/);
});

test('the assistant request in the app is the one in the guide', () => {
  for (const lang of ['nl', 'en']) {
    const indented = assistantPrompt(lang).split('\n').map((line) => (line ? `    ${line}` : '')).join('\n');
    assert.ok(GUIDE.includes(`    \`\`\`text\n${indented}\n    \`\`\``), lang);
  }
});

test('checking shows what will be made and creates nothing yet', async () => {
  const t = await setup();
  const res = await t.adminPost('/admin/events/import', { text: EXAMPLE });
  assert.equal(res.statusCode, 200);
  const text = textOf(res.body);
  assert.match(text, /Kerstcadeautjes 2026/);
  assert.match(text, /Maandagochtend/);
  assert.match(text, /Woensdagavond/);
  assert.match(text, /Boeken: Welke schrijver\?/);
  assert.match(text, /Wat doe je graag\?\s*Tekstvak/);
  assert.match(text, /Ik houd van\.\.\.\s*Aanvinklijst, 5 keuzes/);
  assert.match(text, /Welke kleuren vind je mooi\?\s*Aanvinklijst, 4 keuzes/);
  assert.match(text, /Een andere kleur: Welke kleur\?/);
  assert.match(text, /Huisdieren\s*Aanvinklijst, 3 keuzes\s*Verborgen/);
  assert.match(text, /Nog iets wat je kwijt wilt\s*Tekstvak/);
  assert.ok(text.indexOf('Nog iets wat je kwijt wilt') > text.indexOf('Huisdieren'), 'in the order of the form');
  assert.match(text, /4 deelnemers, 3 met e-mail/);
  assert.match(text, /Importeren verstuurt geen berichten/);
  assert.equal(t.ctx.repo.listEvents().length, 0);
});

test('confirming creates the event, its groups, people and pairs, and mails nobody', async () => {
  const t = await setup();
  const check = await t.adminPost('/admin/events/import', { text: EXAMPLE });
  const res = await t.adminPost('/admin/events/import', confirmForm(check.body));
  assert.equal(res.statusCode, 303);
  const match = /^\/admin\/events\/(\d+)\?done=imported$/.exec(res.headers.location);
  assert.ok(match, res.headers.location);
  const { repo } = t.ctx;
  const event = repo.getEvent(Number(match[1]));
  assert.equal(event.name, 'Kerstcadeautjes 2026');
  assertExampleForm(event);
  const groups = repo.listGroups(event.id);
  assert.deepEqual(groups.map((g) => [g.name, g.exchangeDate, g.exchangeTime, g.autoOpenAt]),
    [['Maandagochtend', '2026-12-14', '10:00', '2026-11-30'], ['Woensdagavond', '2026-12-16', '19:30', null]]);
  for (const group of groups) {
    const people = repo.listParticipants(group.id);
    assert.ok(validateAssignment(repo.getAssignment(group.id), people.map((p) => p.id)), 'one valid pairing per group');
    assert.ok(people.every((p) => p.language === 'nl' && !p.invitedAt && !p.drawnAt));
    assert.equal(group.invitationsSentAt, null);
    assert.equal(group.openedAt, null);
  }
  assert.equal(t.db.prepare('SELECT count(*) AS n FROM outbox').get().n, 0);
  const page = await t.adminGet(res.headers.location);
  assert.match(textOf(page.body), /Het evenement is geïmporteerd/);
  assert.ok(t.logs.some((line) => line.includes('"event_imported"') && line.includes('"participants":7')));
  assert.ok(!t.logs.some((line) => /Ada de Vries|ada@example\.com/.test(line)), 'no names or addresses in the log');
});

test('the same file confirmed twice makes one event, also after Back gave the form a new token', async () => {
  const t = await setup();
  const check = await t.adminPost('/admin/events/import', { text: EXAMPLE });
  const form = confirmForm(check.body);
  const first = await t.adminPost('/admin/events/import', form);
  const again = await t.adminPost('/admin/events/import', form);
  assert.equal(again.headers.location, first.headers.location);
  const fresh = await t.adminPost('/admin/events/import', { ...form, formToken: 'A'.repeat(22) });
  assert.equal(fresh.statusCode, 303);
  assert.match(fresh.headers.location, /\?done=already-imported$/);
  assert.equal(t.ctx.repo.listEvents().length, 1);
  assert.match(textOf((await t.adminGet(fresh.headers.location)).body), /Dit bestand was al geïmporteerd/);

  // Once that event is deleted, the file can be imported anew.
  t.ctx.repo.deleteEvent(t.ctx.repo.listEvents()[0].id);
  const later = await t.adminPost('/admin/events/import', { ...form, formToken: 'B'.repeat(22) });
  assert.match(later.headers.location, /\?done=imported$/);
  assert.equal(t.ctx.repo.listEvents().length, 1);
});

test('a confirm is checked again, so a date that passed since the check refuses it', async () => {
  const t = await setup();
  const check = await t.adminPost('/admin/events/import', { text: EXAMPLE });
  t.clock.ms = Date.parse('2026-12-01T10:00:00.000Z');
  const res = await t.adminPost('/admin/events/import', confirmForm(check.body));
  assert.equal(res.statusCode, 400);
  assert.match(textOf(res.body), /Groep 1 \(Maandagochtend\): De datum waarop het trekken vanzelf opengaat, ligt in het verleden/);
  assert.equal(t.ctx.repo.listEvents().length, 0);
});

test('problems are listed with their place, and the text comes back escaped', async () => {
  const t = await setup();
  const data = file({ groups: [{ name: 'Maandag', exchangeDate: '2026-12-14', participants: [{ name: '</textarea><script>x()</script>', email: 'nope' }, 'B', 'C'] }] });
  const res = await t.adminPost('/admin/events/import', { text: JSON.stringify(data) });
  assert.equal(res.statusCode, 400);
  assert.ok(!res.body.includes('<script>x()'), 'nothing from the file is markup');
  assert.match(textOf(res.body), /Groep 1 \(Maandag\), deelnemer 1 \(&lt;\/textarea&gt;&lt;script&gt;x\(\)&lt;\/script&gt;\): Het e-mailadres &quot;nope&quot; klopt niet\./);
  assert.match(res.body, /<textarea id="import-text" name="text"[^>]*>\{&quot;version&quot;:1/);
  assert.equal(t.ctx.repo.listEvents().length, 0);
});

test('problems name the fields in words, and a repeat names where it was first', async () => {
  const t = await setup();
  const data = file({ groups: [
    { name: 'Maandag', participants: ['Ada', 'Ben', 'ada'] },
    { name: 'Dinsdag', exchangeDate: '16-12-2026', exchangeTime: 'half tien', participants: ['Ada', 'Ben', 'Cor'] },
  ] });
  const res = await t.adminPost('/admin/events/import', { text: JSON.stringify(data) });
  assert.equal(res.statusCode, 400);
  const page = textOf(res.body);
  assert.match(page, /Groep 1 \(Maandag\): De ruildatum ontbreekt\./);
  assert.match(page, /Groep 1 \(Maandag\), deelnemer 3 \(ada\): Deze naam staat ook al bij deelnemer 1 \(Ada\)\./);
  assert.match(page, /Groep 2 \(Dinsdag\): De tijd van het ruilen moet een tijd zijn, zoals 10:30\./);
  const outsideText = textOf(res.body.replace(/<textarea[\s\S]*?<\/textarea>/g, ''));
  assert.ok(!/exchangeDate|exchangeTime/.test(outsideText), 'no field keys outside the pasted text');
});

test('a file wrong throughout lists its first problems only', async () => {
  const t = await setup();
  const groups = [{ name: 'G', exchangeDate: '2026-12-14', participants: Array.from({ length: 300 }, () => 1) }];
  const res = await t.adminPost('/admin/events/import', { text: JSON.stringify(file({ groups })) });
  assert.equal(res.statusCode, 400);
  assert.equal((res.body.match(/<li>/g) ?? []).length, 100);
  assert.match(textOf(res.body), /En nog 200\./);
});

test('a text at the size limit, full of accented letters, fits the post', async () => {
  const t = await setup();
  const pad = 'é'.repeat(IMPORT_TEXT_MAX - JSON.stringify(file()).length - 20);
  const text = JSON.stringify({ ...file(), $schema: pad });
  assert.ok(text.length <= IMPORT_TEXT_MAX);
  const res = await t.adminPost('/admin/events/import', { text });
  assert.equal(res.statusCode, 200);
});

test('line breaks sent as CRLF count once, as the field counted them', async () => {
  const t = await setup();
  const base = JSON.stringify(file(), null, 1);
  const lines = '\n'.repeat(IMPORT_TEXT_MAX - base.length - 10);
  const text = `${base.slice(0, -1)}${lines}}`;
  assert.ok(text.length <= IMPORT_TEXT_MAX && text.replace(/\n/g, '\r\n').length > IMPORT_TEXT_MAX);
  const res = await t.adminPost('/admin/events/import', { text: text.replace(/\n/g, '\r\n') });
  assert.equal(res.statusCode, 200);
});

// The template

test('the template download holds settings and groups, never people or links', async () => {
  const t = await setup();
  const check = await t.adminPost('/admin/events/import', { text: EXAMPLE });
  const created = await t.adminPost('/admin/events/import', confirmForm(check.body));
  const id = /\/admin\/events\/(\d+)/.exec(created.headers.location)[1];
  const res = await t.adminGet(`/admin/events/${id}/export`);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /^application\/json/);
  assert.equal(res.headers['content-disposition'], 'attachment; filename="giftdraw-kerstcadeautjes-2026.json"');
  assert.equal(res.headers['cache-control'], 'no-store');
  for (const p of t.ctx.repo.listAllParticipants()) {
    assert.ok(!res.body.includes(p.token), 'no link codes');
    assert.ok(!res.body.includes(p.name), 'no names');
  }
  const exported = JSON.parse(res.body);
  const original = JSON.parse(EXAMPLE);
  const withoutPeople = { ...original, groups: original.groups.map((g) => ({ ...g, participants: [] })) };
  assert.deepEqual(exported, withoutPeople, 'the example comes back as it was, without people');
  assert.match((await t.adminGet(`/admin/events/${id}`)).body, new RegExp(`href="/admin/events/${id}/export" download`));
});

test('a template imported again gives the same settings', async () => {
  const t = await setup();
  const { repo } = t.ctx;
  const id = repo.createEvent({
    name: 'Kerst 2026', language: 'en', cleanupWeeks: 6, themeText: 'Bring something\r\nyou never used.',
    wishOptions: [
      { id: 'tea', label: 'Thee', detail: false }, { id: 'boeken-1a2b', label: 'Books', detail: true, question: 'Which author?' },
      { id: 'chocolate', label: 'Chocolade', detail: true }, { id: 'old-9f9f', label: 'Old? label', detail: false },
    ],
    formConfig: { sections: { avoid: { show: false }, hobbies: { heading: 'What you love' } }, petOptions: [{ id: 'dog', label: 'Dog', detail: false }, { id: 'bird-0000', label: 'Bird', detail: true }] },
  }, t.ctx.nowIso());
  repo.createGroup(id, { name: 'Tuesday', exchangeDate: '2026-12-15', exchangeTime: '09:30', exchangePlace: 'Hall', autoOpenAt: '2026-12-01' }, t.ctx.nowIso());
  const event = repo.getEvent(id);
  const exported = eventFile(event, repo.listGroups(id));
  const { errors, plan } = read(exported);
  assert.deepEqual(errors, []);
  assert.equal(plan.event.themeText, 'Bring something\nyou never used.');
  assert.equal(plan.event.cleanupWeeks, 6);
  const shape = (options) => options.map((o) => [o.id.replace(/-[0-9a-f]{4}$/, ''), o.detail, o.question ?? null]);
  const form = wishForm(plan.event);
  const choicesOf = (id) => form.questions.find((q) => q.id === id).choices;
  assert.deepEqual(shape(choicesOf('likes')), [['tea', false, null], ['books', true, 'Which author?'], ['chocolate', true, null], ['old-label', false, null]]);
  const sections = (f) => f.questions.map((q) => [q.id, q.show, q.text]);
  assert.deepEqual(sections(form), sections(wishForm(event)));
  assert.deepEqual(shape(choicesOf('pets')), [['dog', false, null], ['bird', true, null]]);
  assert.deepEqual(plan.groups, [{ name: 'Tuesday', exchangeDate: '2026-12-15', exchangeTime: '09:30', exchangePlace: 'Hall', autoOpenAt: '2026-12-01', participants: [] }]);
});

test('a template with a choice the event form let through twice still imports', async () => {
  const t = await setup();
  const { repo } = t.ctx;
  const id = repo.createEvent({ name: 'K', language: 'en', wishOptions: [
    { id: 'books-1a2b', label: 'Books', detail: true, question: 'Which author?' }, { id: 'books-3c4d', label: 'books', detail: false },
  ] }, t.ctx.nowIso());
  const { errors, warnings } = read(eventFile(repo.getEvent(id), []));
  assert.deepEqual(errors, []);
  assert.deepEqual(codes(warnings), ['option-twice', 'no-groups']);
});

test('the download name is plain ASCII', () => {
  assert.equal(eventFileName({ name: 'Kerst  café 🎁 2026!' }), 'giftdraw-kerst-cafe-2026.json');
  assert.equal(eventFileName({ name: '🎁' }), 'giftdraw-event.json');
});

test('import and template pages are for the organiser only', async () => {
  const t = await setup();
  const id = t.ctx.repo.createEvent({ name: 'K', language: 'nl' }, t.ctx.nowIso());
  for (const url of ['/admin/events/import', `/admin/events/${id}/export`]) {
    const res = await t.app.inject({ method: 'GET', url });
    assert.notEqual(res.statusCode, 200, url);
  }
  const post = await t.post('/admin/events/import', { text: EXAMPLE });
  assert.notEqual(post.statusCode, 200);
  assert.equal(t.ctx.repo.listEvents().length, 1);
});
