import { randomBytes } from 'node:crypto';
import { LANGS, t } from './i18n/index.js';
import { CHOICES_MAX, HEADING_MAX, QUESTION_MAX, QUESTIONS_MAX } from './limits.js';
import { clipText } from './text.js';

export const BUILTIN_QUESTIONS = [
  { id: 'hobbies', type: 'text' },
  { id: 'likes', type: 'choices' },
  { id: 'pets', type: 'choices' },
  { id: 'avoid', type: 'text' },
  { id: 'other', type: 'text' },
];
export const SECTION_IDS = BUILTIN_QUESTIONS.map((q) => q.id);
export const DEFAULT_LIKE_IDS = ['chocolate', 'tea', 'coffee', 'bath', 'candles', 'books', 'plants', 'wine'];
export const PET_IDS = ['dog', 'cat', 'other'];

// The two built-in tick lists: their choice ids, translations and built-in
// detail questions.
export const BUILTIN_CHOICES = {
  likes: { ids: DEFAULT_LIKE_IDS, key: 'wish.like', prompts: { chocolate: 'wish.detail.chocolate' } },
  pets: { ids: PET_IDS, key: 'wish.pet', prompts: { other: 'wish.petsOther' } },
};
const SLUG_MAX = 32;

// The organiser's own question is shown as typed in every language, like a
// typed label. Like and pet built-in ids never coincide, so one lookup serves both.
export function detailPrompt(option, lang) {
  if (option.question) return option.question;
  const key = BUILTIN_CHOICES.likes.prompts[option.id] ?? BUILTIN_CHOICES.pets.prompts[option.id] ?? 'wish.detail';
  return t(lang, key);
}

export function cleanHeading(value) {
  if (typeof value !== 'string') return null;
  const line = value.replace(/\s+/g, ' ').trim();
  return line ? clipText(line, HEADING_MAX, 'codepoints').trim() : null;
}

function readOption(o) {
  if (!o || typeof o.id !== 'string' || !o.id || typeof o.label !== 'string') return null;
  const option = { id: o.id, label: o.label, detail: Boolean(o.detail) };
  if (typeof o.question === 'string' && o.question) option.question = o.question;
  return option;
}

// The stored form_config is read defensively: unknown keys are dropped and
// anything malformed falls back to the default, so a bad row cannot break
// every participant page of the event.
export function readFormConfig(raw) {
  const config = raw && typeof raw === 'object' ? raw : {};
  const stored = config.sections && typeof config.sections === 'object' ? config.sections : {};
  const sections = {};
  for (const id of SECTION_IDS) {
    const s = stored[id] && typeof stored[id] === 'object' ? stored[id] : {};
    sections[id] = { show: s.show !== false, heading: cleanHeading(s.heading) };
  }
  const options = Array.isArray(config.petOptions) ? config.petOptions.map(readOption).filter(Boolean) : [];
  return { sections, petOptions: options.length ? options : null };
}

// "Boeken??" or "Welke schrijver???" must not store a question of bare or
// doubled question marks, so the ends are trimmed of them before one is added.
const trimMarks = (text) => text.replace(/^[\s?]+/, '').replace(/[\s?]+$/, '');

// What a choice asks after it is ticked: nothing, the built-in prompt, or
// the organiser's own question.
export const FOLLOW_UPS = ['none', 'general', 'own'];

// A choice's own follow-up question: one line, at most QUESTION_MAX code
// points, ending in exactly one question mark; null when nothing is left.
// The mark is added after the clip, so the field allows QUESTION_MAX - 1.
export function cleanQuestion(value) {
  if (typeof value !== 'string') return null;
  const question = trimMarks(value.replace(/\s+/g, ' '));
  if (!question) return null;
  return `${trimMarks(clipText(question, QUESTION_MAX - 1, 'codepoints'))}?`;
}

// A follow-up typed as the prompt the choice asks by itself, in any
// language, is no own question: kept as typed it would show in that one
// language to everyone.
const promptKey = (text) => trimMarks(text.replace(/\s+/g, ' ')).toLowerCase();
export function isOwnPrompt(choiceId, question) {
  const key = promptKey(question);
  return !LANGS.some((lang) => promptKey(detailPrompt({ id: choiceId, question: null }, lang)) === key);
}

const builtinType = (id) => BUILTIN_QUESTIONS.find((q) => q.id === id)?.type ?? null;
export const isBuiltinChoice = (questionId, id) => Boolean(BUILTIN_CHOICES[questionId]?.ids.includes(id));
export const isBuiltinQuestion = (id) => builtinType(id) !== null;

// The shipped label of a built-in choice in one language, or null for a
// choice the organiser added.
export function builtinChoiceLabel(questionId, choiceId, lang) {
  if (!isBuiltinChoice(questionId, choiceId)) return null;
  return t(lang, `${BUILTIN_CHOICES[questionId].key}.${choiceId}`);
}

// Typed wording or a typed label equal to the shipped one in any language
// is not own text, so it goes on following each reader's language.
export const isBuiltinText = (questionId, text) => LANGS.some((lang) => t(lang, `wish.${questionId}`) === text);
export const isBuiltinLabel = (questionId, choiceId, label) =>
  LANGS.some((lang) => builtinChoiceLabel(questionId, choiceId, lang) === label);

// The built-in choice a label names in any language and letter case, or
// null. A built-in choice is matched once, so a repeated label becomes a
// choice of its own.
export function builtinChoiceFor(questionId, label, taken) {
  const key = label.trim().toLowerCase();
  const ids = BUILTIN_CHOICES[questionId]?.ids ?? [];
  return ids.find((id) => !taken.has(id)
    && LANGS.some((lang) => builtinChoiceLabel(questionId, id, lang).toLowerCase() === key)) ?? null;
}

// A built-in choice without own text keeps its shipped translations; own
// text is shown as typed in every language.
function makeChoice(questionId, { id, own, detail, question }) {
  const builtIn = BUILTIN_CHOICES[questionId];
  const label = own === null ? (lang) => t(lang, `${builtIn.key}.${id}`) : () => own;
  return { id, label, own, detail, question };
}

function builtinChoices(questionId) {
  const list = BUILTIN_CHOICES[questionId];
  return list.ids.map((id) => makeChoice(questionId, { id, own: null, detail: Object.hasOwn(list.prompts, id), question: null }));
}

// Before forms were lists of questions a built-in id showed its translation
// whatever label was stored with it, so the stored label is not own text.
function oldChoices(questionId, stored) {
  if (!stored) return builtinChoices(questionId);
  return stored.map((o) => makeChoice(questionId, {
    id: o.id,
    own: isBuiltinChoice(questionId, o.id) ? null : o.label,
    detail: o.detail,
    question: o.question ?? null,
  }));
}

function oldForm(event) {
  const { sections, petOptions } = readFormConfig(event.formConfig);
  const likes = Array.isArray(event.wishOptions) ? event.wishOptions.map(readOption).filter(Boolean) : null;
  const stored = { likes, pets: petOptions };
  return BUILTIN_QUESTIONS.map(({ id, type }) => ({
    id,
    type,
    text: sections[id].heading,
    show: sections[id].show,
    choices: type === 'choices' ? oldChoices(id, stored[id]) : [],
  }));
}

function readChoice(questionId, c) {
  if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id) return null;
  const own = typeof c.label === 'string' && c.label.trim() ? c.label : null;
  if (own === null && !isBuiltinChoice(questionId, c.id)) return null;
  const question = typeof c.question === 'string' && c.question ? c.question : null;
  return makeChoice(questionId, { id: c.id, own, detail: Boolean(c.detail), question });
}

function readChoices(questionId, stored) {
  if (!Array.isArray(stored)) return builtinType(questionId) ? builtinChoices(questionId) : [];
  const seen = new Set();
  const out = [];
  for (const raw of stored) {
    const choice = readChoice(questionId, raw);
    if (!choice || seen.has(choice.id)) continue;
    seen.add(choice.id);
    out.push(choice);
  }
  return out.slice(0, CHOICES_MAX);
}

// A built-in id must keep its own type, or stored answers would be read as
// the wrong kind; an added question has no built-in wording to fall back on.
function readQuestion(q) {
  if (!q || typeof q !== 'object' || typeof q.id !== 'string' || !q.id) return null;
  if (q.type !== 'text' && q.type !== 'choices') return null;
  const builtIn = builtinType(q.id);
  if (builtIn && builtIn !== q.type) return null;
  const text = cleanHeading(q.text);
  if (!builtIn && !text) return null;
  return {
    id: q.id,
    type: q.type,
    text,
    show: q.show !== false,
    choices: q.type === 'choices' ? readChoices(q.id, q.choices) : [],
  };
}

function newForm(stored) {
  const seen = new Set();
  const out = [];
  for (const raw of stored) {
    const question = readQuestion(raw);
    if (!question || seen.has(question.id)) continue;
    seen.add(question.id);
    out.push(question);
  }
  return out.slice(0, QUESTIONS_MAX);
}

// A stored list of questions wins over the older wishOptions and sections;
// an empty or unreadable one gives the built-in form, so a bad row cannot
// leave every participant page of the event without questions.
export function wishForm(event) {
  const config = event.formConfig && typeof event.formConfig === 'object' ? event.formConfig : {};
  if (Array.isArray(config.questions)) {
    const questions = newForm(config.questions);
    if (questions.length) return { questions };
    return { questions: oldForm({}) };
  }
  return { questions: oldForm(event) };
}

const choiceKey = (c) => [c.id, c.own, c.detail, c.question];
const questionKey = (q) => [q.id, q.type, q.text, q.show, q.choices.map(choiceKey)];
const formKey = (form) => JSON.stringify(form.questions.map(questionKey));

// Whether two forms read the same to participants. A built-in wording or
// choice follows the reader's language, so only own text counts.
export function sameForm(a, b) {
  return formKey(a) === formKey(b);
}

function storedChoice(c) {
  const out = { id: c.id };
  if (c.own !== null) out.label = c.own;
  if (c.detail) out.detail = true;
  if (c.question) out.question = c.question;
  return out;
}

function storedQuestion(q) {
  const out = { id: q.id, type: q.type };
  if (q.text) out.text = q.text;
  if (!q.show) out.show = false;
  if (q.type === 'choices') out.choices = q.choices.map(storedChoice);
  return out;
}

// The built-in form is stored as nothing at all, so the column stays NULL
// for events whose form was never changed.
export function formValue(form) {
  if (sameForm(form, wishForm({}))) return null;
  return { questions: form.questions.map(storedQuestion) };
}

// A typed wording may already end in a question mark or an ellipsis; the
// lines then join their value without the usual colon.
export const endsInMark = (label) => /[?!.:…]$/.test(label);

// The organiser's wording replaces the built-in one for everyone; the
// built-in one follows the reader's language.
export function questionText(question, lang, kind = 'form') {
  if (question.text) return question.text;
  return t(lang, kind === 'line' ? `wish.line.${question.id}` : `wish.${question.id}`);
}

function freshId(prefix, taken) {
  let id;
  do id = `${prefix}-${randomBytes(2).toString('hex')}`;
  while (taken.has(id));
  return id;
}

export function newQuestionId(form) {
  return freshId('q', new Set(form.questions.map((q) => q.id)));
}

function slugify(label) {
  const slug = label
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, SLUG_MAX)
    .replace(/^-+|-+$/g, '');
  return slug || 'option';
}

export function newChoiceId(label, taken) {
  return freshId(slugify(label), taken);
}
