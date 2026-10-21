import { instantAt } from '../time.js';
import en from './en.js';
import nl from './nl.js';

export const LANGS = ['nl', 'en'];

const CATALOGUES = { nl, en };
const LOCALES = { nl: 'nl-NL', en: 'en-GB' };

export function isLang(x) {
  return LANGS.includes(x);
}

function langOrDefault(lang) {
  return isLang(lang) ? lang : 'nl';
}

export function t(lang, key, vars = {}) {
  const catalogue = CATALOGUES[langOrDefault(lang)];
  // hasOwn so keys such as 'constructor' do not resolve to prototype members.
  if (!Object.hasOwn(catalogue, key)) {
    if (process.env.NODE_ENV === 'test') throw new Error(`missing translation: ${key}`);
    return key;
  }
  return catalogue[key].replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(vars, name) ? String(vars[name]) : match));
}

// Noon keeps the calendar date intact in every time zone offset.
export function formatDate(lang, date, tz) {
  const locale = LOCALES[langOrDefault(lang)];
  return new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(
    instantAt(date, '12:00', tz),
  );
}

// The date with the time when one is set, e.g. "vrijdag 18 december om 10:30".
export function exchangeWhen(lang, group, tz) {
  const date = formatDate(lang, group.exchangeDate, tz);
  return group.exchangeTime ? t(lang, 'common.dateTime', { date, time: group.exchangeTime }) : date;
}

// The one sentence every participant screen, email and card uses for when and
// where the presents are given, so they never disagree.
export function exchangeLine(lang, group, tz) {
  const when = exchangeWhen(lang, group, tz);
  return group.exchangePlace
    ? t(lang, 'common.exchangeAt', { when, place: group.exchangePlace })
    : t(lang, 'common.exchange', { when });
}

export function themeText(event, lang) {
  const custom = event.themeText?.trim();
  return custom ? custom : t(lang, 'theme.default');
}
