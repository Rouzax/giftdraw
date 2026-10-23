import { randomBytes } from 'node:crypto';
import { LANGS, t } from './i18n/index.js';

export const DEFAULT_LIKE_IDS = ['chocolate', 'tea', 'coffee', 'bath', 'candles', 'books', 'plants', 'wine'];
export const PET_IDS = ['dog', 'cat', 'other'];

const DEFAULT_IDS = new Set(DEFAULT_LIKE_IDS);
const DETAIL_IDS = new Set(['chocolate']);
const TEXT_MAX = 1000;
const QUESTION_MAX = 80;
const SLUG_MAX = 32;

const defaultLabel = (id) => (lang) => t(lang, `wish.like.${id}`);
const allTranslations = (id) => LANGS.map(defaultLabel(id));

// Default ids keep their shipped translations even when the organiser has
// edited the list; organiser-typed labels are shown as typed in every language.
export function wishOptions(event) {
  if (!event.wishOptions) {
    return DEFAULT_LIKE_IDS.map((id) => ({ id, label: defaultLabel(id), detail: DETAIL_IDS.has(id), question: null }));
  }
  return event.wishOptions.map(({ id, label, detail, question }) => ({
    id,
    label: DEFAULT_IDS.has(id) ? defaultLabel(id) : () => label,
    detail: Boolean(detail),
    question: typeof question === 'string' && question ? question : null,
  }));
}

// The organiser's own question is shown as typed in every language, like a
// typed label.
export function detailPrompt(option, lang) {
  if (option.question) return option.question;
  return t(lang, DETAIL_IDS.has(option.id) ? 'wish.detail.chocolate' : 'wish.detail');
}

// A label can hold a question mark only if it was stored before the `?`
// started a question. Written back as typed it would split there, so it is
// written without, and mergeOptionLabels matches that form to the old id.
function lineLabel(label) {
  return label.replace(/\?/g, '').replace(/\s+/g, ' ').trim();
}

// The inverse of the line format mergeOptionLabels reads, so saving the
// textarea unchanged stores the same options.
export function optionLines(options, lang) {
  return options
    .map((o) => {
      const label = lineLabel(labelOf(o, lang));
      if (!o.detail) return label;
      return o.question ? `${label}? ${o.question}` : `${label}?`;
    })
    .join('\n');
}

// "Boeken??" or "Welke schrijver???" must not store a question of bare or
// doubled question marks, so the ends are trimmed of them before one is added.
const trimMarks = (text) => text.replace(/^[\s?]+/, '').replace(/[\s?]+$/, '');

function parseQuestion(rest) {
  const question = trimMarks(rest);
  if (!question) return null;
  return `${trimMarks(Array.from(question).slice(0, QUESTION_MAX - 1).join(''))}?`;
}

function labelOf(option, lang) {
  return typeof option.label === 'function' ? option.label(lang) : option.label;
}

const sameLabel = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

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

function newId(label, taken) {
  const slug = slugify(label);
  let id;
  do id = `${slug}-${randomBytes(2).toString('hex')}`;
  while (taken.has(id));
  return id;
}

// A default id matches its label in every language, so the result does not
// depend on whether options arrive raw or via wishOptions(), and a typed
// "Thee" in an English event keeps stored `tea` likes. Matching the shipped
// labels too lets a re-added "Thee" get the translated option back.
export function mergeOptionLabels(text, currentOptions, lang) {
  const candidates = [
    ...currentOptions.map((o) => ({
      id: o.id,
      labels: DEFAULT_IDS.has(o.id)
        ? [labelOf(o, lang), ...allTranslations(o.id)]
        : [labelOf(o, lang), lineLabel(labelOf(o, lang))],
    })),
    ...DEFAULT_LIKE_IDS.map((id) => ({ id, labels: allTranslations(id) })),
  ];
  const taken = new Set(currentOptions.map((o) => o.id));
  const used = new Set();
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const mark = line.indexOf('?');
    const detail = mark !== -1;
    const label = (detail ? line.slice(0, mark) : line).trim();
    if (!label) continue;
    const question = detail ? parseQuestion(line.slice(mark + 1)) : null;
    const match = candidates.find((c) => !used.has(c.id) && c.labels.some((l) => sameLabel(l, label)));
    const id = match ? match.id : newId(label, taken);
    used.add(id);
    taken.add(id);
    out.push(question ? { id, label, detail, question } : { id, label, detail });
  }
  return out;
}

function field(body, name) {
  return Object.hasOwn(body, name) ? body[name] : undefined;
}

function text(value) {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== 'string') return '';
  // Cut by code points so an emoji at the limit is not split into half a pair.
  return Array.from(first.trim()).slice(0, TEXT_MAX).join('');
}

function pickIds(value, allowed) {
  const out = [];
  for (const id of Array.isArray(value) ? value : [value]) {
    if (typeof id === 'string' && allowed.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

// A filled-in detail or other-pet text counts as ticking its box, so a
// forgotten tick does not throw the answer away.
export function parseWishesForm(body, options) {
  const b = body ?? {};
  const likes = pickIds(field(b, 'likes'), new Set(options.map((o) => o.id)));
  const likeDetails = {};
  for (const option of options) {
    if (!option.detail) continue;
    const detail = text(field(b, `detail_${option.id}`));
    if (!detail) continue;
    likeDetails[option.id] = detail;
    if (!likes.includes(option.id)) likes.push(option.id);
  }
  const pets = pickIds(field(b, 'pets'), new Set(PET_IDS));
  const petsOther = text(field(b, 'pets_other'));
  if (petsOther && !pets.includes('other')) pets.push('other');
  return {
    hobbies: text(field(b, 'hobbies')),
    likes,
    likeDetails,
    pets,
    petsOther,
    avoid: text(field(b, 'avoid')),
    other: text(field(b, 'other')),
  };
}

export function hasWishes(wishes) {
  if (!wishes) return false;
  if (wishes.hobbies || wishes.petsOther || wishes.avoid || wishes.other) return true;
  return (wishes.likes?.length ?? 0) > 0 || (wishes.pets?.length ?? 0) > 0;
}

// Shipped labels are capitalised for tick boxes but read mid-sentence here.
export function wishLines(wishes, options, lang) {
  if (!wishes) return [];
  const byId = new Map(options.map((o) => [o.id, o]));
  const likes = (wishes.likes ?? [])
    .filter((id) => byId.has(id))
    .map((id) => {
      const label = labelOf(byId.get(id), lang);
      const shown = DEFAULT_IDS.has(id) ? label.toLowerCase() : label;
      const detail = wishes.likeDetails?.[id];
      return detail ? `${shown} (${detail})` : shown;
    });
  const pets = (wishes.pets ?? [])
    .filter((id) => PET_IDS.includes(id))
    .map((id) => (id === 'other' && wishes.petsOther ? wishes.petsOther : t(lang, `wish.pet.${id}`).toLowerCase()));
  const lines = [];
  const add = (section, value) => {
    if (value) lines.push({ label: t(lang, `wish.line.${section}`), value });
  };
  add('hobbies', wishes.hobbies);
  add('likes', likes.join(', '));
  add('pets', pets.join(', '));
  add('avoid', wishes.avoid);
  add('other', wishes.other);
  return lines;
}
