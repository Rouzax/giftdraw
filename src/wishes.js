import { LANGS, t } from './i18n/index.js';
import { BUILTIN_CHOICES as LISTS, cleanQuestion, newChoiceId, readFormConfig, SECTION_IDS } from './questions.js';

export { readFormConfig, SECTION_IDS } from './questions.js';

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

// The organiser's heading replaces the built-in one for everyone; the
// built-in one follows the reader's language.
export function sectionHeading(section, lang, kind = 'form') {
  if (section.heading) return section.heading;
  return t(lang, kind === 'line' ? `wish.line.${section.id}` : `wish.${section.id}`);
}

// A label can hold a question mark only if it was stored before the `?`
// started a question. Written as a line it would split there, so a line
// without it still matches the old label.
function lineLabel(label) {
  return label.replace(/\?/g, '').replace(/\s+/g, ' ').trim();
}

function labelOf(option, lang) {
  return typeof option.label === 'function' ? option.label(lang) : option.label;
}

const sameLabel = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Whether two option lists read the same to participants. A built-in id
// shows its translation whatever label is stored with it, so only typed
// labels count: the list saved again after the event language changed, or
// a stored copy of the defaults, is no change.
function sameOptions(a, b, kind = 'likes') {
  const list = LISTS[kind];
  const key = (o) => JSON.stringify([o.id, Boolean(o.detail), o.question || null, isDefault(list, o.id) ? null : labelOf(o, 'nl')]);
  return a.length === b.length && a.every((o, i) => key(o) === key(b[i]));
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
    const question = detail ? cleanQuestion(line.slice(mark + 1)) : null;
    const match = candidates.find((c) => !used.has(c.id) && c.labels.some((l) => sameLabel(l, label)));
    const id = match ? match.id : newChoiceId(label, taken);
    used.add(id);
    taken.add(id);
    out.push(question ? { id, label, detail, question } : { id, label, detail });
  }
  return out;
}

// The value to store for a tick list in the line format, or undefined to
// leave it as it is. A list that reads the same as now is left alone, so
// saving the page unchanged never marks printed cards out of date; the
// default list is stored as null, so it keeps following the language.
export function optionsToStore(text, current, lang, kind) {
  const merged = text.trim() ? mergeOptionLabels(text, current, lang, kind) : [];
  const builtIn = kind === 'pets' ? petOptions({}) : wishOptions({});
  if (sameOptions(merged.length ? merged : builtIn, current, kind)) return undefined;
  return merged.length && !sameOptions(merged, builtIn, kind) ? merged : null;
}
