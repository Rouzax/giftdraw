import { makeCycle } from './draw/cycle.js';
import { isLang, t } from './i18n/index.js';
import {
  CHOICES_MAX, groupDatesError, HEADING_MAX, NAME_MAX, OPTIONS_MAX, PLACE_MAX, QUESTION_MAX, QUESTIONS_MAX, THEME_MAX,
} from './limits.js';
import { normaliseEmail, PASTE_ROWS_MAX } from './people.js';
import {
  BUILTIN_QUESTIONS, builtinChoiceFor, cleanHeading, cleanQuestion, formValue, isBuiltinQuestion, isBuiltinText,
  newChoiceId, newQuestionId, sameForm, SECTION_IDS, wishForm,
} from './questions.js';
import { unixLines } from './text.js';

// An event file describes one event to create: its settings, its groups and
// their participants by name and email. It never holds pairs, links or
// anything that happened since, so a file can only start something new and
// can never be used to read or restore anyone's page.

export const FILE_VERSION = 2;
export const SCHEMA_URL = 'https://rouzax.github.io/giftdraw/import/event.schema.json';
// Percent-encoded in the form post a character takes up to six bytes (an
// accented letter), so this keeps the post inside the import route's body
// limit.
export const IMPORT_TEXT_MAX = 150_000;
export const GROUPS_MAX = 50;
const MIN_GROUP = 3;
const CLEANUP_DEFAULT = 4;

// Keys each object may have. Anything else is refused rather than ignored,
// so a misspelt "exchange_date" is reported instead of silently lost.
// `event` is a version 1 event, with the five fixed parts of the form;
// a version 2 event lists the form as questions instead.
export const FILE_KEYS = {
  file: ['$schema', 'version', 'event', 'groups'],
  event: ['name', 'language', 'cleanupWeeks', 'theme', 'wishOptions', 'sections', 'petOptions'],
  eventV2: ['name', 'language', 'cleanupWeeks', 'theme', 'questions'],
  question: ['id', 'type', 'text', 'show', 'choices'],
  option: ['label', 'question', 'askDetails'],
  section: ['show', 'heading'],
  group: ['name', 'exchangeDate', 'exchangeTime', 'exchangePlace', 'autoOpenAt', 'participants'],
  participant: ['name', 'email'],
};

// Tab and line breaks are whitespace and handled per field; other control
// characters cannot be typed in a form and are refused.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const size = { units: (s) => s.length, codepoints: (s) => Array.from(s).length };

// Where the object that starts at `start` ends, skipping braces inside
// strings, or the end of the text when it never closes (a cut-off answer).
function objectEnd(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i += 1;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth += 1;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return text.length;
}

// An assistant's answer often has a sentence before or after the file, with
// the file in a fenced code block or, copied from the rendered chat, without
// the fences. The file is then the first fenced block, or else the object
// that starts at the first {.
function stripWrapping(text) {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  const fenced = /```[\w-]*[^\S\n]*\n([\s\S]*?)\n?```/.exec(trimmed);
  if (fenced && !trimmed.startsWith('{')) return fenced[1].trim();
  const start = trimmed.indexOf('{');
  return start === -1 ? trimmed : trimmed.slice(start, objectEnd(trimmed, start));
}

function lineAndColumn(text, position) {
  const before = text.slice(0, position);
  const line = before.split('\n').length;
  return { line, column: position - before.lastIndexOf('\n') };
}

// Each problem names where it is as a list of steps from the top, so the
// page can say "group 2 (Monday), participant 5 (Ada)".
function collector() {
  const errors = [];
  const warnings = [];
  return {
    errors,
    warnings,
    error: (where, code, vars = {}) => errors.push({ where, code, vars }),
    warn: (where, code, vars = {}) => warnings.push({ where, code, vars }),
  };
}

function checkKeys(out, value, kind, where) {
  for (const key of Object.keys(value)) {
    if (!FILE_KEYS[kind].includes(key)) out.error(where, 'unknown-key', { key });
  }
}

// Returns the cleaned text, null for absent or empty, or undefined after
// reporting a problem. Single-line fields have every run of whitespace made
// one space, as their form fields can hold no line break.
function readText(out, value, where, field, { max, required = false, multiline = false, measure = 'units' }) {
  if (value === undefined || value === null) {
    if (required) out.error(where, 'required', { field });
    return required ? undefined : null;
  }
  if (typeof value !== 'string') {
    out.error(where, 'not-text', { field });
    return undefined;
  }
  if (!value.isWellFormed() || CONTROL.test(value)) {
    out.error(where, 'bad-characters', { field });
    return undefined;
  }
  const clean = multiline ? unixLines(value).trim() : value.replace(/\s+/g, ' ').trim();
  if (!clean) {
    if (required) out.error(where, 'required', { field });
    return required ? undefined : null;
  }
  if (size[measure](clean) > max) {
    out.error(where, 'too-long', { field, max });
    return undefined;
  }
  return clean;
}

// One choice of a tick list as {label, ask, question, asTyped}, or null
// after reporting a problem. A plain text is read as a line of the old
// event form's list, where a question mark starts the question: "Boeken?
// Welke schrijver". Version 1 labels never hold a question mark, as that
// list could not store one. A version 2 object is taken as typed: its
// label keeps a question mark, as the edit page does, and is never matched
// to a built-in choice, so an own "Tea" next to the built-in one survives a
// download and an import.
function readChoiceItem(out, item, at, { labelMax, labelMeasure, objectAsTyped = false }) {
  let option = item;
  if (typeof item === 'string') {
    const mark = item.indexOf('?');
    option = mark === -1 ? { label: item }
      : { label: item.slice(0, mark), askDetails: true, question: item.slice(mark + 1).replace(/^[\s?]+/, '') || null };
  }
  if (!isObject(option)) {
    out.error(at, 'option-shape', {});
    return null;
  }
  checkKeys(out, option, 'option', at);
  const raw = readText(out, option.label, at, 'label', { max: labelMax, measure: labelMeasure, required: true });
  const asTyped = objectAsTyped && typeof item !== 'string';
  const label = typeof raw === 'string' && !asTyped ? raw.replace(/\?/g, '').replace(/\s+/g, ' ').trim() : raw;
  if (raw && !label) out.error(at, 'required', { field: 'label' });
  const question = readText(out, option.question, at, 'question', { max: QUESTION_MAX, measure: 'codepoints' });
  let ask = Boolean(question);
  if (option.askDetails !== undefined && option.askDetails !== null) {
    if (typeof option.askDetails !== 'boolean') out.error(at, 'not-boolean', { field: 'askDetails' });
    else ask = ask || option.askDetails;
  }
  if (!label || question === undefined) return null;
  return { label, ask, question, asTyped };
}

// The event form allows a repeated choice, so a downloaded template can
// hold one; it is pointed out rather than refused.
function warnTwice(out, items, at) {
  const seen = new Set();
  items.forEach((item, index) => {
    const key = item.label.toLowerCase();
    if (seen.has(key)) out.warn(at(index), 'option-twice', { label: item.label });
    seen.add(key);
  });
}

// Choices as the edit page stores them: a built-in label in any language
// keeps its built-in id, so it follows each reader's language; wording is
// cleaned and cut like the edit page cuts it.
function fileChoices(questionId, items) {
  const taken = new Set();
  return items.map(({ label, ask, question, asTyped }) => {
    const builtIn = asTyped ? null : builtinChoiceFor(questionId, label, taken);
    const own = builtIn ? null : cleanHeading(label);
    const id = builtIn ?? newChoiceId(own, taken);
    taken.add(id);
    return { id, own, detail: ask, question: cleanQuestion(question) };
  });
}

// A version 1 tick list, measured as the old event form's textarea held it.
function readOptions(out, value, where, field) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    out.error(where, 'not-list', { field });
    return undefined;
  }
  if (value.length === 0) {
    out.error(where, 'options-empty', { field });
    return undefined;
  }
  const at = (index) => [...where, { option: field, n: index + 1 }];
  const items = value.map((item, index) => readChoiceItem(out, item, at(index), { labelMax: OPTIONS_MAX }));
  if (items.includes(null)) return undefined;
  warnTwice(out, items, at);
  // The old event form held longer labels than the form does now; the file
  // still imports, and the organiser sees which labels are cut.
  items.forEach(({ label }, index) => {
    if (cleanHeading(label) !== label) out.warn(at(index), 'label-cut', { label, max: HEADING_MAX });
  });
  const lines = items.map(({ label, ask, question }) => (ask ? `${label}?${question ? ` ${question}` : ''}` : label));
  if (lines.join('\n').length > OPTIONS_MAX) {
    out.error(where, 'options-too-long', { field, max: OPTIONS_MAX });
    return undefined;
  }
  return items;
}

function readSections(out, value, where) {
  const sections = Object.fromEntries(SECTION_IDS.map((id) => [id, { show: true, heading: null }]));
  if (value === undefined || value === null) return sections;
  if (!isObject(value)) {
    out.error(where, 'not-object', { field: 'sections' });
    return undefined;
  }
  let ok = true;
  for (const [id, section] of Object.entries(value)) {
    const at = [...where, { section: id }];
    if (!SECTION_IDS.includes(id)) {
      out.error(where, 'unknown-section', { key: id, known: SECTION_IDS.join(', ') });
      ok = false;
      continue;
    }
    if (!isObject(section)) {
      out.error(at, 'not-object', { field: id });
      ok = false;
      continue;
    }
    checkKeys(out, section, 'section', at);
    if (section.show !== undefined && section.show !== null && typeof section.show !== 'boolean') {
      out.error(at, 'not-boolean', { field: 'show' });
      ok = false;
    }
    const heading = readText(out, section.heading, at, 'heading', { max: HEADING_MAX, measure: 'codepoints' });
    if (heading === undefined) ok = false;
    // A heading equal to a built-in one stays empty, so it keeps following
    // each participant's language, as on the edit page.
    const own = cleanHeading(heading);
    sections[id] = { show: section.show !== false, heading: own && !isBuiltinText(id, own) ? own : null };
  }
  return ok ? sections : undefined;
}

function readCleanupWeeks(out, value, where) {
  if (value === undefined || value === null) return CLEANUP_DEFAULT;
  const weeks = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
    out.error(where, 'cleanup-weeks', {});
    return undefined;
  }
  return weeks;
}

// The five fixed parts of a version 1 form, as questions.
function readFormV1(out, value, where) {
  const likes = readOptions(out, value.wishOptions, where, 'wishOptions');
  const pets = readOptions(out, value.petOptions, where, 'petOptions');
  const sections = readSections(out, value.sections, where);
  if ([likes, pets, sections].includes(undefined)) return undefined;
  const lists = { likes, pets };
  return wishForm({}).questions.map((q) => ({
    ...q,
    text: sections[q.id].heading,
    show: sections[q.id].show,
    choices: lists[q.id] ? fileChoices(q.id, lists[q.id]) : q.choices,
  }));
}

// A version 2 tick list: null keeps a built-in question's own choices.
function readChoices(out, value, at, builtIn) {
  if ((value === undefined || value === null) && builtIn) return null;
  if (value !== undefined && value !== null && !Array.isArray(value)) {
    out.error(at, 'not-list', { field: 'choices' });
    return undefined;
  }
  if (!value?.length) {
    out.error(at, 'choices-empty', {});
    return undefined;
  }
  if (value.length > CHOICES_MAX) {
    out.error(at, 'too-many-choices', { max: CHOICES_MAX });
    return undefined;
  }
  const choiceAt = (index) => [...at, { choice: index + 1 }];
  const items = value.map((item, index) => readChoiceItem(out, item, choiceAt(index), {
    labelMax: HEADING_MAX, labelMeasure: 'codepoints', objectAsTyped: true,
  }));
  if (items.includes(null)) return undefined;
  warnTwice(out, items, choiceAt);
  return items;
}

// A question as the edit page would save it. An id names a built-in
// question, which then keeps its type; any other question gets a new id.
function readQuestion(out, value, at, before) {
  if (!isObject(value)) {
    out.error(at, 'not-object', { field: 'questions' });
    return null;
  }
  checkKeys(out, value, 'question', at);
  let ok = true;
  const hasId = value.id !== undefined && value.id !== null;
  const builtIn = hasId ? BUILTIN_QUESTIONS.find((q) => q.id === value.id) ?? null : null;
  if (hasId && (!builtIn || before.some((q) => q.id === builtIn.id))) {
    out.error(at, 'question-id', { id: String(value.id), known: SECTION_IDS.join(', ') });
    ok = false;
  }
  if (value.type !== 'text' && value.type !== 'choices') {
    out.error(at, 'question-type', {});
    ok = false;
  } else if (builtIn && builtIn.type !== value.type) {
    out.error(at, 'question-id-type', { id: builtIn.id, type: builtIn.type });
    ok = false;
  }
  if (value.show !== undefined && value.show !== null && typeof value.show !== 'boolean') {
    out.error(at, 'not-boolean', { field: 'show' });
    ok = false;
  }
  const typed = readText(out, value.text, at, 'text', { max: HEADING_MAX, measure: 'codepoints' });
  if (typed === undefined) ok = false;
  const own = cleanHeading(typed);
  const text = own && builtIn && isBuiltinText(builtIn.id, own) ? null : own;
  if (typed !== undefined && !text && !builtIn) {
    out.error(at, 'question-text', {});
    ok = false;
  }
  let items = null;
  if (value.type === 'text' && value.choices !== undefined && value.choices !== null) {
    out.error(at, 'choices-on-text', {});
    ok = false;
  } else if (value.type === 'choices') {
    items = readChoices(out, value.choices, at, Boolean(builtIn));
    if (items === undefined) ok = false;
  }
  if (!ok) return null;
  const id = builtIn ? builtIn.id : newQuestionId({ questions: before });
  let choices = [];
  if (items) choices = fileChoices(id, items);
  else if (builtIn && value.type === 'choices') choices = wishForm({}).questions.find((q) => q.id === id).choices;
  return { id, type: value.type, text, show: value.show !== false, choices };
}

// Without questions a version 2 file has the built-in form.
function readFormV2(out, value, where) {
  if (value === undefined || value === null) return wishForm({}).questions;
  if (!Array.isArray(value)) {
    out.error(where, 'not-list', { field: 'questions' });
    return undefined;
  }
  if (value.length === 0) {
    out.error(where, 'questions-empty', {});
    return undefined;
  }
  if (value.length > QUESTIONS_MAX) {
    out.error(where, 'too-many-questions', { max: QUESTIONS_MAX });
    return undefined;
  }
  const questions = [];
  let ok = true;
  value.forEach((raw, index) => {
    const question = readQuestion(out, raw, [...where, { question: index + 1 }], questions);
    if (question) questions.push(question);
    else ok = false;
  });
  return ok ? questions : undefined;
}

function readEvent(out, value, version, existingNames) {
  const where = [{ part: 'event' }];
  if (!isObject(value)) {
    out.error([], value === undefined ? 'required' : 'not-object', { field: 'event' });
    return null;
  }
  checkKeys(out, value, version === 1 ? 'event' : 'eventV2', where);
  const name = readText(out, value.name, where, 'name', { max: NAME_MAX, required: true });
  let language = 'nl';
  if (value.language !== undefined && value.language !== null) {
    if (isLang(value.language)) language = value.language;
    else out.error(where, 'language', {});
  }
  const cleanupWeeks = readCleanupWeeks(out, value.cleanupWeeks, where);
  const theme = readText(out, value.theme, where, 'theme', { max: THEME_MAX, multiline: true });
  const questions = version === 1 ? readFormV1(out, value, where) : readFormV2(out, value.questions, where);
  if ([name, cleanupWeeks, theme, questions].includes(undefined)) return null;

  if (existingNames.has(name.toLowerCase())) out.warn(where, 'event-exists', { name });
  const isDefaultTheme = ['nl', 'en'].some((l) => t(l, 'theme.default') === theme);
  return {
    name,
    language,
    cleanupWeeks,
    themeText: theme && !isDefaultTheme ? theme : null,
    wishOptions: null,
    formConfig: formValue({ questions }),
  };
}

// A time such as 9:30 is written as the time field sends it, 09:30.
function readTime(out, value, where) {
  const time = readText(out, value, where, 'exchangeTime', { max: 10 });
  return typeof time === 'string' && /^\d:\d\d$/.test(time) ? `0${time}` : time;
}

const DATE_ERRORS = {
  exchangeTime: ['time', {}],
  exchangeDate: ['date', { field: 'exchangeDate' }],
  exchangePast: ['exchange-past', {}],
  autoOpenAt: ['date', { field: 'autoOpenAt' }],
  autoOpenPast: ['auto-open-past', {}],
  autoOpenAfter: ['auto-open-after', {}],
};

function readParticipant(out, value, where) {
  const person = typeof value === 'string' ? { name: value } : value;
  if (!isObject(person)) {
    out.error(where, 'participant-shape', {});
    return null;
  }
  checkKeys(out, person, 'participant', where);
  const name = readText(out, person.name, where, 'name', { max: NAME_MAX, required: true });
  // A bare address is a name missing, as in a pasted list.
  if (typeof name === 'string' && !person.email && normaliseEmail(name)) {
    out.error(where, 'name-is-email', {});
    return null;
  }
  let email = null;
  if (person.email !== undefined && person.email !== null && person.email !== '') {
    email = typeof person.email === 'string' ? normaliseEmail(person.email) : null;
    if (!email) out.error(where, 'email', { value: String(person.email) });
  }
  if (typeof name !== 'string' || (person.email && !email)) return null;
  return { name, email };
}

function readGroup(out, value, where, today) {
  if (!isObject(value)) {
    out.error(where, 'not-object', { field: 'groups' });
    return null;
  }
  checkKeys(out, value, 'group', where);
  const name = readText(out, value.name, where, 'name', { max: NAME_MAX, required: true });
  const exchangeDate = readText(out, value.exchangeDate, where, 'exchangeDate', { max: 10, required: true });
  const exchangeTime = readTime(out, value.exchangeTime, where);
  const exchangePlace = readText(out, value.exchangePlace, where, 'exchangePlace', { max: PLACE_MAX });
  const autoOpenAt = readText(out, value.autoOpenAt, where, 'autoOpenAt', { max: 10 });
  let ok = ![name, exchangeDate, exchangeTime, exchangePlace, autoOpenAt].includes(undefined);
  if (ok) {
    const dates = groupDatesError({ exchangeDate, exchangeTime, autoOpenAt }, today);
    if (dates) {
      out.error(where, ...DATE_ERRORS[dates]);
      ok = false;
    }
  }
  let people = [];
  if (value.participants !== undefined && value.participants !== null) {
    if (!Array.isArray(value.participants)) {
      out.error(where, 'not-list', { field: 'participants' });
      ok = false;
    } else if (value.participants.length > PASTE_ROWS_MAX) {
      out.error(where, 'too-many-participants', { max: PASTE_ROWS_MAX });
      ok = false;
    } else {
      people = value.participants.map((person, index) => {
        const at = [...where, { participant: index + 1, name: typeof person?.name === 'string' ? person.name : typeof person === 'string' ? person : null }];
        return readParticipant(out, person, at);
      });
      if (people.includes(null)) ok = false;
    }
  }
  return ok ? { name, exchangeDate, exchangeTime, exchangePlace, autoOpenAt, participants: people } : null;
}

// Things that are allowed but probably not meant: the organiser sees them
// before confirming.
function warnAboutGroups(out, groups) {
  if (groups.length === 0) out.warn([], 'no-groups', {});
  const groupNames = new Set();
  const emails = new Map();
  groups.forEach((group, index) => {
    const where = [{ group: index + 1, name: group.name }];
    if (groupNames.has(group.name.toLowerCase())) out.warn(where, 'group-name-twice', { name: group.name });
    groupNames.add(group.name.toLowerCase());
    const count = group.participants.length;
    if (count < MIN_GROUP) out.warn(where, 'small-group', { count, min: MIN_GROUP });
    const names = new Set();
    for (const person of group.participants) {
      const key = person.name.toLowerCase();
      if (names.has(key)) out.warn(where, 'name-twice', { name: person.name });
      names.add(key);
      if (!person.email) continue;
      const first = emails.get(person.email);
      if (first === undefined) emails.set(person.email, group.name);
      // One address for two people happens, such as a couple sharing one.
      else if (first === group.name) out.warn(where, 'email-twice', { email: person.email });
      else out.warn(where, 'email-elsewhere', { email: person.email, group: first });
    }
  });
}

// The version whose rules read the file. Without a valid version the shape
// decides, so a file that lost its version is told which one to add and
// gets no problems that only the other version's rules would find.
function rulesVersion(data) {
  if (data.version === 1 || data.version === FILE_VERSION) return data.version;
  const event = isObject(data.event) ? data.event : {};
  const v1 = ['wishOptions', 'petOptions', 'sections'].some((key) => Object.hasOwn(event, key));
  return v1 && !Object.hasOwn(event, 'questions') ? 1 : FILE_VERSION;
}

// Returns {errors, warnings, plan}; plan is null unless there are no errors.
// today is the organiser's date, as for the group form.
export function readEventFile(text, { today, existingNames = new Set() }) {
  const out = collector();
  const result = () => ({ errors: out.errors, warnings: out.warnings, plan: null });
  if (typeof text !== 'string' || !text.trim()) {
    out.error([], 'empty', {});
    return result();
  }
  if (text.length > IMPORT_TEXT_MAX) {
    out.error([], 'too-large', { max: IMPORT_TEXT_MAX });
    return result();
  }
  const source = stripWrapping(unixLines(text));
  let data;
  try {
    data = JSON.parse(source);
  } catch (err) {
    const message = String(err?.message ?? '');
    const position = /at position (\d+)/.exec(message);
    if (!source.startsWith('{')) out.error([], 'json-start', {});
    // A cut-off text is reported either way, depending on where it stops.
    else if (/end of JSON input/.test(message) || Number(position?.[1]) >= source.length) out.error([], 'json-end', {});
    else if (position) out.error([], 'json', lineAndColumn(source, Number(position[1])));
    else out.error([], 'json-other', {});
    return result();
  }
  if (!isObject(data)) {
    out.error([], 'not-file', {});
    return result();
  }
  checkKeys(out, data, 'file', []);
  const version = rulesVersion(data);
  if (data.version === undefined) out.error([], 'version-missing', { version });
  else if (typeof data.version === 'number' && data.version > FILE_VERSION) out.error([], 'version-newer', {});
  else if (data.version !== version) out.error([], 'version-unknown', { oldest: 1, newest: FILE_VERSION });

  const event = readEvent(out, data.event, version, existingNames);
  let groups = null;
  if (!Array.isArray(data.groups)) {
    out.error([], data.groups === undefined ? 'required' : 'not-list', { field: 'groups' });
  } else if (data.groups.length > GROUPS_MAX) {
    out.error([], 'too-many-groups', { max: GROUPS_MAX });
  } else {
    groups = data.groups.map((group, index) =>
      readGroup(out, group, [{ group: index + 1, name: typeof group?.name === 'string' ? group.name : null }], today));
  }
  if (out.errors.length || !event || !groups || groups.includes(null)) return result();
  warnAboutGroups(out, groups);
  return { errors: out.errors, warnings: out.warnings, plan: { event, groups } };
}

// One transaction: an import creates the whole event or nothing. Pairs are
// drawn up as when people are pasted into a new group; nothing is mailed,
// invitations stay the organiser's step per group.
export function createEventFromPlan(ctx, plan) {
  const { repo } = ctx;
  const now = ctx.nowIso();
  return repo.tx(() => {
    const eventId = repo.createEvent(plan.event, now);
    let participants = 0;
    for (const { participants: people, ...group } of plan.groups) {
      const groupId = repo.createGroup(eventId, group, now);
      if (people.length === 0) continue;
      const rows = people.map((p) => ({ ...p, language: plan.event.language }));
      repo.addParticipantsWithAssignment(groupId, rows, (ids) => (ids.length >= MIN_GROUP ? makeCycle(ids) : null), now);
      participants += people.length;
    }
    return { eventId, groups: plan.groups.length, participants };
  });
}

// A choice as a line of text, "Boeken? Welke schrijver?", where that reads
// back the same. A label with a question mark of its own, or an own label a
// line would match to a built-in choice, needs the object.
function fileChoice(choice, questionId, lang) {
  const label = choice.label(lang);
  const readsBuiltin = choice.own !== null && builtinChoiceFor(questionId, label, new Set()) !== null;
  if (label.includes('?') || readsBuiltin) {
    if (!choice.detail) return { label };
    return choice.question ? { label, question: choice.question } : { label, askDetails: true };
  }
  if (!choice.detail) return label;
  return choice.question ? `${label}? ${choice.question}` : `${label}?`;
}

// A built-in question writes only what differs from it, so its wording and
// default choices keep following the language after an import.
function fileQuestion(question, builtIns, lang) {
  const builtIn = builtIns.find((q) => q.id === question.id);
  const out = isBuiltinQuestion(question.id) ? { id: question.id, type: question.type } : { type: question.type };
  if (question.text) out.text = question.text;
  if (!question.show) out.show = false;
  const defaultChoices = builtIn && sameForm({ questions: [question] }, { questions: [{ ...question, choices: builtIn.choices }] });
  if (question.type === 'choices' && !defaultChoices) out.choices = question.choices.map((c) => fileChoice(c, question.id, lang));
  return out;
}

// The event as a file to start from next time: settings and groups, no
// participants. A form that is the built-in one is left out, so it keeps
// following the language after an import.
export function eventFile(event, groups) {
  const form = wishForm(event);
  const builtIns = wishForm({}).questions;
  const file = {
    $schema: SCHEMA_URL,
    version: FILE_VERSION,
    event: { name: event.name, language: event.language, cleanupWeeks: event.cleanupWeeks },
  };
  if (event.themeText) file.event.theme = unixLines(event.themeText);
  if (!sameForm(form, { questions: builtIns })) {
    file.event.questions = form.questions.map((q) => fileQuestion(q, builtIns, event.language));
  }
  file.groups = groups.map((g) => ({
    name: g.name,
    exchangeDate: g.exchangeDate,
    ...(g.exchangeTime ? { exchangeTime: g.exchangeTime } : {}),
    ...(g.exchangePlace ? { exchangePlace: g.exchangePlace } : {}),
    ...(g.autoOpenAt ? { autoOpenAt: g.autoOpenAt } : {}),
    participants: [],
  }));
  return file;
}

// A download name from the event name, in plain ASCII so every browser and
// file system keeps it.
export function eventFileName(event) {
  const slug = event.name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return `giftdraw-${slug || 'event'}.json`;
}
