import { questionText } from './questions.js';
import { clipText, unixLines } from './text.js';

const TEXT_MAX = 1000;

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const strings = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v) : []);

function stringValues(value) {
  const out = {};
  if (!isObject(value)) return out;
  for (const [key, v] of Object.entries(value)) if (typeof v === 'string' && v) out[key] = v;
  return out;
}

const filled = (answer) => (typeof answer === 'string' ? Boolean(answer)
  : answer.ticked.length > 0 || Object.keys(answer.details).length > 0);

function readAnswer(value) {
  if (typeof value === 'string') return value || null;
  if (!isObject(value)) return null;
  const answer = { ticked: strings(value.ticked), details: stringValues(value.details) };
  return filled(answer) ? answer : null;
}

// Rows saved before forms were lists of questions keep each section's
// answer in its own fields; the other-pet text becomes the follow-up of
// the built-in `other` choice.
function oldAnswers(wishes) {
  return {
    hobbies: wishes.hobbies,
    likes: { ticked: wishes.likes, details: wishes.likeDetails },
    pets: { ticked: wishes.pets, details: { ...stringValues(wishes.petDetails), ...stringValues({ other: wishes.petsOther }) } },
    avoid: wishes.avoid,
    other: wishes.other,
  };
}

// Empty answers are left out, so a row saved with nothing in a question
// reads the same as one that never had it.
export function readAnswers(wishes) {
  if (!isObject(wishes)) return {};
  const raw = isObject(wishes.answers) ? wishes.answers : oldAnswers(wishes);
  const answers = {};
  for (const [id, value] of Object.entries(raw)) {
    const answer = readAnswer(value);
    if (answer) answers[id] = answer;
  }
  return answers;
}

function field(body, name) {
  return Object.hasOwn(body, name) ? body[name] : undefined;
}

function text(value) {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== 'string') return '';
  return clipText(unixLines(first.trim()), TEXT_MAX, 'codepoints');
}

function pickIds(value, allowed) {
  const out = [];
  for (const id of Array.isArray(value) ? value : [value]) {
    if (typeof id === 'string' && allowed.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

// Ticked ids plus the follow-ups typed for detail choices. A filled-in
// follow-up counts as ticking its box, so a forgotten tick does not throw
// it away. A box that was ticked and comes back unticked with its stored
// follow-up unchanged was unticked on purpose: without script the field
// keeps its text, which would otherwise tick the box again on every save.
function parseChoices(b, question, before) {
  const ticked = pickIds(field(b, `q_${question.id}`), new Set(question.choices.map((c) => c.id)));
  const details = {};
  for (const choice of question.choices) {
    if (!choice.detail) continue;
    const detail = text(field(b, `d_${question.id}_${choice.id}`));
    if (!detail) continue;
    if (!ticked.includes(choice.id)) {
      if (before?.ticked.includes(choice.id) && before.details[choice.id] === detail) continue;
      ticked.push(choice.id);
    }
    details[choice.id] = detail;
  }
  return { ticked, details };
}

// readAnswers does not know the form, so a stored answer may be of the
// other kind than its question asks for; such an answer cannot be kept.
function ofKind(question, answer) {
  if (answer === undefined) return null;
  return (typeof answer === 'string') === (question.type === 'text') ? answer : null;
}

// The form posts the questions it showed. An answer is taken from the post
// only if its question is shown now and was on that form: a form loaded
// before the organiser showed or hid a question would otherwise store an
// empty answer over the kept one. Answers to questions no longer in the
// form are dropped. A post without the list comes from a page rendered
// before questions existed, whose field names this cannot read, so it
// gives null.
export function parseWishesForm(body, form, previous = null) {
  const b = body ?? {};
  const posted = field(b, 'questions');
  if (typeof posted !== 'string') return null;
  const onPage = new Set(posted.split(/\s+/));
  const before = readAnswers(previous);
  const answers = {};
  for (const question of form.questions) {
    const kept = ofKind(question, before[question.id]);
    const answer = question.show && onPage.has(question.id)
      ? readAnswer(question.type === 'text'
        ? text(field(b, `q_${question.id}`))
        : parseChoices(b, question, kept))
      : kept;
    if (answer) answers[question.id] = answer;
  }
  return { answers };
}

// Answers kept in hidden questions are not shown to anyone, so they do not
// count as filled in; without a form every answer counts.
export function hasWishes(wishes, form = null) {
  const answers = readAnswers(wishes);
  const ids = form ? form.questions.filter((q) => q.show).map((q) => q.id) : Object.keys(answers);
  return ids.some((id) => Object.hasOwn(answers, id));
}

// On the built-in pets question the other-pet text names the animal, so it
// replaces "other" itself.
function choicesLine(question, answer, lang) {
  const byId = new Map(question.choices.map((c) => [c.id, c]));
  return answer.ticked
    .filter((id) => byId.has(id))
    .map((id) => {
      const detail = answer.details[id];
      if (question.id === 'pets' && id === 'other' && detail) return detail;
      // Every label as written, built-in or typed, so a line never mixes
      // "thee" with "Boeken".
      const label = byId.get(id).label(lang);
      return detail ? `${label} (${detail})` : label;
    })
    .join(', ');
}

export function wishLines(wishes, form, lang) {
  const answers = readAnswers(wishes);
  const lines = [];
  for (const question of form.questions) {
    const answer = answers[question.id];
    if (!question.show || !answer) continue;
    // An answer of the other kind cannot be the one this question asked for.
    const value = question.type === 'text'
      ? (typeof answer === 'string' ? answer : '')
      : (typeof answer === 'string' ? '' : choicesLine(question, answer, lang));
    if (value) lines.push({ label: questionText(question, lang, 'line'), value });
  }
  return lines;
}

function answerTo(wishes, questionId) {
  const answers = readAnswers(wishes);
  return Object.hasOwn(answers, questionId) ? answers[questionId] : null;
}

export function countAnswers(participants, questionId, choiceIds = null) {
  return participants.filter((p) => {
    const answer = answerTo(p.wishes, questionId);
    if (!answer || !choiceIds) return Boolean(answer);
    return typeof answer !== 'string' && answer.ticked.some((id) => choiceIds.includes(id));
  }).length;
}

export function dropAnswers(wishes, questionId, choiceIds = null) {
  const answers = readAnswers(wishes);
  const answer = answers[questionId];
  if (!Object.hasOwn(answers, questionId)) return null;
  if (!choiceIds) {
    delete answers[questionId];
    return { answers };
  }
  if (typeof answer === 'string') return null;
  const drops = (id) => choiceIds.includes(id);
  if (!answer.ticked.some(drops) && !Object.keys(answer.details).some(drops)) return null;
  const kept = {
    ticked: answer.ticked.filter((id) => !drops(id)),
    details: Object.fromEntries(Object.entries(answer.details).filter(([id]) => !drops(id))),
  };
  if (filled(kept)) answers[questionId] = kept;
  else delete answers[questionId];
  return { answers };
}
