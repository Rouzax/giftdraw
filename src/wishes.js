import { randomBytes } from 'node:crypto';
import { t } from './i18n/index.js';

export const DEFAULT_LIKE_IDS = ['chocolate', 'tea', 'coffee', 'bath', 'candles', 'books', 'plants', 'wine'];
export const PET_IDS = ['dog', 'cat', 'other'];

const DEFAULT_IDS = new Set(DEFAULT_LIKE_IDS);
const DETAIL_IDS = new Set(['chocolate']);
const TEXT_MAX = 1000;
const SLUG_MAX = 32;

const defaultLabel = (id) => (lang) => t(lang, `wish.like.${id}`);

// Default ids keep their shipped translations even when the organiser has
// edited the list; organiser-typed labels are shown as typed in every language.
export function wishOptions(event) {
  if (!event.wishOptions) {
    return DEFAULT_LIKE_IDS.map((id) => ({ id, label: defaultLabel(id), detail: DETAIL_IDS.has(id) }));
  }
  return event.wishOptions.map(({ id, label, detail }) => ({
    id,
    label: DEFAULT_IDS.has(id) ? defaultLabel(id) : () => label,
    detail: Boolean(detail),
  }));
}

export function detailPrompt(option, lang) {
  return t(lang, option.id === 'chocolate' ? 'wish.detail.chocolate' : 'wish.detail');
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

// Matching against the shipped labels as well lets a re-added "Thee" get the
// translated `tea` option back instead of a typed-only one.
export function mergeOptionLabels(text, currentOptions, lang) {
  const candidates = [
    ...currentOptions.map((o) => ({ id: o.id, label: labelOf(o, lang) })),
    ...DEFAULT_LIKE_IDS.map((id) => ({ id, label: defaultLabel(id)(lang) })),
  ];
  const taken = new Set(currentOptions.map((o) => o.id));
  const used = new Set();
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    let label = line.trim();
    const detail = label.endsWith('?');
    if (detail) label = label.slice(0, -1).trim();
    if (!label) continue;
    const match = candidates.find((c) => !used.has(c.id) && sameLabel(c.label, label));
    const id = match ? match.id : newId(label, taken);
    used.add(id);
    taken.add(id);
    out.push({ id, label, detail });
  }
  return out;
}

function field(body, name) {
  return Object.hasOwn(body, name) ? body[name] : undefined;
}

function text(value) {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first.trim().slice(0, TEXT_MAX) : '';
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
