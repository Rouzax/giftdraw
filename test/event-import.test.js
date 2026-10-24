import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateAssignment } from '../src/draw/cycle.js';
import { eventFile, eventFileName, FILE_KEYS, IMPORT_TEXT_MAX, readEventFile } from '../src/event-file.js';
import { t as tr } from '../src/i18n/index.js';
import { assistantPrompt } from '../src/import-prompt.js';
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

test('the documented example reads without problems', () => {
  const { errors, warnings, plan } = read(EXAMPLE);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(plan.event.name, 'Kerstcadeautjes 2026');
  assert.equal(plan.event.language, 'nl');
  assert.equal(plan.event.cleanupWeeks, 4);
  assert.match(plan.event.themeText, /^Neem een cadeautje mee/);
  const ids = plan.event.wishOptions.map((o) => o.id);
  assert.deepEqual(ids.slice(0, 2), ['chocolate', 'tea'], 'standard labels keep their built-in ids');
  assert.equal(ids[3], 'plants');
  assert.equal(ids[4], 'candles');
  assert.match(ids[2], /^boeken-[0-9a-f]{4}$/);
  assert.equal(plan.event.wishOptions[2].question, 'Welke schrijver?');
  assert.equal(plan.event.wishOptions[3].detail, true);
  assert.deepEqual(plan.event.formConfig, { sections: { pets: { show: false }, other: { heading: 'Nog iets wat je kwijt wilt' } } });
  assert.equal(plan.groups.length, 2);
  assert.deepEqual(plan.groups[0].participants[2], { name: 'Cor Bakker', email: null });
  assert.deepEqual(plan.groups[1].participants[0], { name: 'Eva Smit', email: null }, 'a bare name is a participant');
  assert.equal(plan.groups[1].autoOpenAt, null);
});

test('the schema allows exactly the fields the import reads', () => {
  const props = (node) => Object.keys(node.properties).sort();
  const group = SCHEMA.properties.groups.items;
  assert.deepEqual(props(SCHEMA), [...FILE_KEYS.file].sort());
  assert.deepEqual(props(SCHEMA.properties.event), [...FILE_KEYS.event].sort());
  assert.deepEqual(props(group), [...FILE_KEYS.group].sort());
  assert.deepEqual(props(group.properties.participants.items.oneOf[1]), [...FILE_KEYS.participant].sort());
  assert.deepEqual(props(SCHEMA.$defs.options.items.oneOf[1]), [...FILE_KEYS.option].sort());
  assert.deepEqual(props(SCHEMA.$defs.section), [...FILE_KEYS.section].sort());
  assert.deepEqual(props(SCHEMA.properties.event.properties.sections), ['avoid', 'hobbies', 'likes', 'other', 'pets']);
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

test('the version must be there and be 1', () => {
  const { version, ...rest } = file();
  assert.equal(version, 1);
  assert.deepEqual(codes(read(rest).errors), ['version-missing']);
  assert.deepEqual(codes(read({ ...rest, version: 2 }).errors), ['version-newer']);
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
  assert.deepEqual(codes(read(file({ event: { name: 'K', sections: { music: { show: false } } } })).errors), ['unknown-section']);
  assert.deepEqual(codes(read(file({ event: { name: 'K', sections: { pets: { show: 'no' } } } })).errors), ['not-boolean']);
  const marks = read(file({ event: { name: 'K', wishOptions: [
    'Boeken? Welke schrijver', 'Wijn?', { label: 'Kaas?', question: 'Welke soort??' }, '?? Thee'] } }));
  assert.deepEqual(marks.errors.map((e) => e.vars.field), ['label'], 'a text that is only a question has no choice');
  const lines = read(file({ event: { name: 'K', wishOptions: ['Boeken? Welke schrijver', 'Wijn?', { label: 'Kaas?', question: 'Welke soort??' }] } }));
  assert.deepEqual(lines.plan.event.wishOptions.map((o) => [o.label, o.detail, o.question ?? null]),
    [['Boeken', true, 'Welke schrijver?'], ['Wijn', true, null], ['Kaas', true, 'Welke soort?']], 'a text reads as a line of the event form');
});

test('warnings point out what is allowed but probably not meant', () => {
  const groups = [
    { name: 'Maandag', exchangeDate: '2026-12-14', participants: [
      { name: 'Ada', email: 'ada@example.com' }, { name: 'ada', email: 'ada@example.com' }, 'Ben'] },
    { name: 'maandag', exchangeDate: '2026-12-14', participants: [{ name: 'Cor', email: 'ada@example.com' }] },
  ];
  const { errors, warnings } = read(file({ event: { name: 'Kerst 2025' }, groups }), { existingNames: new Set(['kerst 2025']) });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings.map((w) => [w.where[0]?.group ?? w.where[0]?.part, w.code]), [
    ['event', 'event-exists'],
    [1, 'name-twice'],
    [1, 'email-twice'],
    [2, 'group-name-twice'],
    [2, 'small-group'],
    [2, 'email-elsewhere'],
  ]);
  assert.deepEqual(codes(read(file({ groups: [] })).warnings), ['no-groups']);
});

test('a file has at most so many groups and participants per group', () => {
  const groups = Array.from({ length: 51 }, (_, i) => ({ name: `G${i}`, exchangeDate: '2026-12-14' }));
  assert.deepEqual(codes(read(file({ groups })).errors), ['too-many-groups']);
  const people = Array.from({ length: 501 }, (_, i) => `P${i}`);
  assert.deepEqual(codes(read(file({ groups: [{ name: 'G', exchangeDate: '2026-12-14', participants: people }] })).errors), ['too-many-participants']);
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
  assert.match(text, /Kopje van &quot;Verder nog iets\?&quot;: &quot;Nog iets wat je kwijt wilt&quot;/);
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
  assert.deepEqual(event.formConfig, { sections: { pets: { show: false }, other: { heading: 'Nog iets wat je kwijt wilt' } } });
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
  assert.deepEqual(shape(plan.event.wishOptions), [['tea', false, null], ['books', true, 'Which author?'], ['chocolate', true, null], ['old-label', false, null]]);
  assert.deepEqual(plan.event.formConfig.sections, event.formConfig.sections);
  assert.deepEqual(shape(plan.event.formConfig.petOptions), [['dog', false, null], ['bird', true, null]]);
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
