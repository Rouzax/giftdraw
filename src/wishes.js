import { randomBytes } from 'node:crypto';
import { LANGS, t } from './i18n/index.js';

export const DEFAULT_LIKE_IDS = ['chocolate', 'tea', 'coffee', 'bath', 'candles', 'books', 'plants', 'wine'];
export const PET_IDS = ['dog', 'cat', 'other'];
export const SECTION_IDS = ['hobbies', 'likes', 'pets', 'avoid', 'other'];

// The two tick lists share one line format and id scheme; each has its own
// built-in ids, translations and built-in detail questions.
const LISTS = {
  likes: { ids: DEFAULT_LIKE_IDS, key: 'wish.like', prompts: { chocolate: 'wish.detail.chocolate' } },
  pets: { ids: PET_IDS, key: 'wish.pet', prompts: { other: 'wish.petsOther' } },
};
// Fields of the stored wishes each section owns, so a hidden section can keep
// its answer when the rest of the form is saved.
const SECTION_FIELDS = {
  hobbies: ['hobbies'],
  likes: ['likes', 'likeDetails'],
  pets: ['pets', 'petsOther', 'petDetails'],
  avoid: ['avoid'],
  other: ['other'],
};
const TEXT_MAX = 1000;
const QUESTION_MAX = 80;
const HEADING_MAX = 80;
const SLUG_MAX = 32;

const isDefault = (list, id) => list.ids.includes(id);
const defaultLabel = (list, id) => (lang) => t(lang, `${list.key}.${id}`);
const allTranslations = (list, id) => LANGS.map(defaultLabel(list, id));

// Default ids keep their shipped translations even when the organiser has
// edited the list; organiser-typed labels are shown as typed in every language.
function listOptions(stored, list) {
  if (!stored) {
    return list.ids.map((id) => ({ id, label: defaultLabel(list, id), detail: Object.hasOwn(list.prompts, id), question: null }));
  }
  return stored.map(({ id, label, detail, question }) => ({
    id,
    label: isDefault(list, id) ? defaultLabel(list, id) : () => label,
    detail: Boolean(detail),
    question: typeof question === 'string' && question ? question : null,
  }));
}

export function wishOptions(event) {
  return listOptions(event.wishOptions, LISTS.likes);
}

export function petOptions(event) {
  return listOptions(readFormConfig(event.formConfig).petOptions, LISTS.pets);
}

// The organiser's own question is shown as typed in every language, like a
// typed label. Like and pet built-in ids never coincide, so one lookup serves both.
export function detailPrompt(option, lang) {
  if (option.question) return option.question;
  const key = LISTS.likes.prompts[option.id] ?? LISTS.pets.prompts[option.id] ?? 'wish.detail';
  return t(lang, key);
}

// A typed heading may already end in a question mark or an ellipsis; the
// lines then join their value without the usual colon.
export const endsInMark = (label) => /[?!.:…]$/.test(label);

export function cleanHeading(value) {
  if (typeof value !== 'string') return null;
  const line = value.replace(/\s+/g, ' ').trim();
  return line ? Array.from(line).slice(0, HEADING_MAX).join('').trim() : null;
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

// Only what differs from the defaults is stored, and nothing at all when
// everything is default, so the column stays NULL for untouched events.
export function formConfigValue(config) {
  const sections = {};
  for (const id of SECTION_IDS) {
    const { show, heading } = config.sections[id];
    const changed = {};
    if (heading) changed.heading = heading;
    if (!show) changed.show = false;
    if (Object.keys(changed).length) sections[id] = changed;
  }
  const value = {};
  if (Object.keys(sections).length) value.sections = sections;
  if (config.petOptions) value.petOptions = config.petOptions;
  return Object.keys(value).length ? value : null;
}

export function wishForm(event) {
  const { sections } = readFormConfig(event.formConfig);
  return {
    sections: SECTION_IDS.map((id) => ({ id, ...sections[id] })),
    likes: wishOptions(event),
    pets: petOptions(event),
  };
}

// The organiser's heading replaces the built-in one for everyone; the
// built-in one follows the reader's language.
export function sectionHeading(section, lang, kind = 'form') {
  if (section.heading) return section.heading;
  return t(lang, kind === 'line' ? `wish.line.${section.id}` : `wish.${section.id}`);
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
export function mergeOptionLabels(text, currentOptions, lang, kind = 'likes') {
  const list = LISTS[kind];
  const candidates = [
    ...currentOptions.map((o) => ({
      id: o.id,
      labels: isDefault(list, o.id)
        ? [labelOf(o, lang), ...allTranslations(list, o.id)]
        : [labelOf(o, lang), lineLabel(labelOf(o, lang))],
    })),
    ...list.ids.map((id) => ({ id, labels: allTranslations(list, id) })),
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

// The built-in other-pet detail keeps its own field and stored key, so
// rows saved before the pet list was editable read the same.
const petDetailField = (id) => (id === 'other' ? 'pets_other' : `pet_detail_${id}`);

// Ticked ids plus the details typed for detail options. A filled-in detail
// counts as ticking its box, so a forgotten tick does not throw it away.
function parseList(b, options, idsField, detailField) {
  const ids = pickIds(field(b, idsField), new Set(options.map((o) => o.id)));
  const details = {};
  for (const option of options) {
    if (!option.detail) continue;
    const detail = text(field(b, detailField(option.id)));
    if (!detail) continue;
    details[option.id] = detail;
    if (!ids.includes(option.id)) ids.push(option.id);
  }
  return { ids, details };
}

// A hidden section is not on the form, so its stored answer is carried over
// from `previous` instead of being emptied by the save.
export function parseWishesForm(body, form, previous = null) {
  const b = body ?? {};
  const likes = parseList(b, form.likes, 'likes', (id) => `detail_${id}`);
  const pets = parseList(b, form.pets, 'pets', petDetailField);
  const { other: petsOther = '', ...petDetails } = pets.details;
  const wishes = {
    hobbies: text(field(b, 'hobbies')),
    likes: likes.ids,
    likeDetails: likes.details,
    pets: pets.ids,
    petsOther,
    // Left out when empty so a re-save of a row stored without it is no change.
    ...(Object.keys(petDetails).length ? { petDetails } : {}),
    avoid: text(field(b, 'avoid')),
    other: text(field(b, 'other')),
  };
  for (const section of form.sections) {
    if (section.show) continue;
    for (const name of SECTION_FIELDS[section.id]) {
      if (previous && Object.hasOwn(previous, name)) wishes[name] = previous[name];
      else if (name === 'petDetails') delete wishes[name];
    }
  }
  return wishes;
}

export function hasWishes(wishes) {
  if (!wishes) return false;
  if (wishes.hobbies || wishes.petsOther || wishes.avoid || wishes.other) return true;
  return (wishes.likes?.length ?? 0) > 0 || (wishes.pets?.length ?? 0) > 0;
}

// `own` gives the text that stands in for an option, if any: the other-pet
// text names the animal, so it replaces "other" itself.
function listLine(ids, options, list, details, own, lang) {
  const byId = new Map(options.map((o) => [o.id, o]));
  return (ids ?? [])
    .filter((id) => byId.has(id))
    .map((id) => {
      if (own(id)) return own(id);
      const label = labelOf(byId.get(id), lang);
      const shown = isDefault(list, id) ? label.toLowerCase() : label;
      const detail = details?.[id];
      return detail ? `${shown} (${detail})` : shown;
    })
    .join(', ');
}

// Shipped labels are capitalised for tick boxes but read mid-sentence here.
export function wishLines(wishes, form, lang) {
  if (!wishes) return [];
  const none = () => null;
  const values = {
    hobbies: wishes.hobbies,
    likes: listLine(wishes.likes, form.likes, LISTS.likes, wishes.likeDetails, none, lang),
    pets: listLine(wishes.pets, form.pets, LISTS.pets, wishes.petDetails,
      (id) => (id === 'other' ? wishes.petsOther || null : null), lang),
    avoid: wishes.avoid,
    other: wishes.other,
  };
  return form.sections
    .filter((section) => section.show && values[section.id])
    .map((section) => ({ label: sectionHeading(section, lang, 'line'), value: values[section.id] }));
}
