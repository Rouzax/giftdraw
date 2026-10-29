import { hasWishes, readAnswers, wishLines } from '../answers.js';
import { html, raw } from '../html.js';
import { icon, iconInline } from '../icons.js';
import { exchangeLine, LANGS, t, themeText } from '../i18n/index.js';
import { detailPrompt, endsInMark, questionText, wishForm } from '../questions.js';

// Fragments take their links and form targets as arguments so the organiser
// can show the same screens inside the admin shell when acting on behalf.

const TEXT_MAX = 1000;
const checked = (on) => (on ? raw(' checked') : '');

// The place gets its own pin inside the sentence, so the sentence is split
// around a marker the way givesTo splits around the name.
function exchangeText(lang, group, tz) {
  if (!group.exchangePlace) return exchangeLine(lang, group, tz);
  const [before, after = ''] = exchangeLine(lang, { ...group, exchangePlace: '{place}' }, tz).split('{place}');
  return html`${before}${iconInline('map-pin', group.exchangePlace)}${after}`;
}

function themeBlock({ event, group, lang, tz }) {
  return html`<section class="theme">
<p>${themeText(event, lang)}</p>
<p class="date">${icon('calendar')}${exchangeText(lang, group, tz)}</p>
</section>`;
}

// Under the about form the buttons submit that form to the switch, so the
// answers typed so far are saved rather than lost on the way to the other
// language.
function langSwitch({ lang, langAction, from }) {
  const others = LANGS.filter((l) => l !== lang);
  const owner = from === 'about' ? raw(` form="about-form" formaction="${langAction}"`) : '';
  return html`<form class="lang-switch" method="post" action="${langAction}" aria-label="${t(lang, 'lang.switch')}">
${others.map((l) => html`<button type="submit" name="lang" value="${l}" lang="${l}"${owner}>${t(l, `lang.${l}`)}</button>`)}
</form>`;
}

function footer({ lang, langAction, showLangSwitch, from }) {
  return showLangSwitch ? langSwitch({ lang, langAction, from }) : '';
}

export function welcomeView({ participant, event, group, lang, tz, editHref, langAction, showLangSwitch }) {
  const body = html`<h1>${t(lang, 'welcome.greeting', { name: participant.name })}</h1>
<p class="lead">${t(lang, 'welcome.intro')}</p>
${themeBlock({ event, group, lang, tz })}
<a class="button" href="${editHref}">${iconInline('pencil', t(lang, 'welcome.button'))}</a>
${footer({ lang, langAction, showLangSwitch })}`;
  return { title: t(lang, 'welcome.title'), body };
}

// emailOn is false when the app sends no mail at all: an address alone does
// not mean an email will come.
export function waitingView({ participant, event, group, lang, tz, editHref, langAction, showLangSwitch, emailOn }) {
  const lead = participant.email && emailOn
    ? html`<p class="lead">${iconInline('mail', t(lang, 'waiting.thanks'))}</p>`
    : html`<p class="lead">${t(lang, 'waiting.thanksNoEmail')}</p>`;
  const body = html`<h1>${t(lang, 'welcome.greeting', { name: participant.name })}</h1>
${lead}
${themeBlock({ event, group, lang, tz })}
<a class="button" href="${editHref}">${iconInline('pencil', t(lang, 'waiting.edit'))}</a>
${footer({ lang, langAction, showLangSwitch })}`;
  return { title: t(lang, 'waiting.title'), body };
}

// Enough rows to show prefilled text whole, so no line sits half under the
// edge. Characters per row are counted for a phone, where rows are shortest;
// participant.css lets browsers that can size to the content do so instead.
const ROW_CHARS = 24;
const ROWS_MIN = 3;
const ROWS_MAX = 20;

function rowsFor(value) {
  const lines = String(value ?? '').split('\n')
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(Array.from(line).length / ROW_CHARS)), 0);
  return Math.min(ROWS_MAX, Math.max(ROWS_MIN, lines));
}

function textArea(name, label, value) {
  return html`<label class="field-label" for="${name}">${label}</label>
<textarea id="${name}" name="${name}" rows="${rowsFor(value)}" maxlength="${TEXT_MAX}">${value ?? ''}</textarea>`;
}

// tick names the box this field belongs to; wish-form.js ticks it while
// typing, the way parseWishesForm already counts a filled-in field as ticked.
function textInput(name, label, value, tick) {
  return html`<label class="field-label sub" for="${name}">${label}</label>
<input type="text" id="${name}" name="${name}" maxlength="${TEXT_MAX}" value="${value ?? ''}" data-tick="${tick}">`;
}

function checkbox(id, name, value, label, on) {
  return html`<label class="check"><input type="checkbox" id="${id}" name="${name}" value="${value}"${checked(on)}> <span>${label}</span></label>`;
}

// One tick box per choice; a detail choice gets its text field right under
// its box.
function tickList(question, answer, lang) {
  const ticked = new Set(answer?.ticked ?? []);
  return question.choices.map((choice) => {
    const boxId = `c_${question.id}_${choice.id}`;
    const box = checkbox(boxId, `q_${question.id}`, choice.id, choice.label(lang), ticked.has(choice.id));
    if (!choice.detail) return box;
    const detail = `d_${question.id}_${choice.id}`;
    return html`${box}
<div class="detail">${textInput(detail, detailPrompt(choice, lang), answer?.details[choice.id], boxId)}</div>`;
  });
}

// A stored answer of the other kind than its question asks for is not
// shown; the next save drops it.
function questionField(question, answer, lang) {
  const heading = questionText(question, lang);
  if (question.type === 'text') return textArea(`q_${question.id}`, heading, typeof answer === 'string' ? answer : '');
  return html`<fieldset>
<legend>${heading}</legend>
${tickList(question, typeof answer === 'object' ? answer : null, lang)}
</fieldset>`;
}

// outdated says the post came from a page whose fields cannot be read, so
// nothing was saved and the stored answers are shown again.
export function aboutFormView({ event, group, wishes, lang, tz, formAction, langAction, showLangSwitch, outdated = false }) {
  const answers = readAnswers(wishes);
  const shown = wishForm(event).questions.filter((question) => question.show);
  const body = html`<h1>${t(lang, 'about.title')}</h1>
${outdated ? html`<p class="notice" role="alert">${t(lang, 'about.outdated')}</p>` : ''}
<p class="lead">${t(lang, 'about.intro')}</p>
${themeBlock({ event, group, lang, tz })}
<form class="about" id="about-form" method="post" action="${formAction}">
<input type="hidden" name="from" value="about">
<input type="hidden" name="questions" value="${shown.map((question) => question.id).join(' ')}">
${shown.map((question) => questionField(question, answers[question.id], lang))}
<button type="submit" class="button">${t(lang, 'about.save')}</button>
</form>
${footer({ lang, langAction, showLangSwitch, from: 'about' })}`;
  return { title: t(lang, 'about.title'), body, scripts: ['wish-form.js'] };
}

const BOWL_SLIPS = 7;
const CONFETTI_PIECES = 24;
const pieces = (n) => raw('<i></i>'.repeat(n));

// Decorative only; the name and the button carry everything that matters.
function bowl({ lifting = false } = {}) {
  return html`<div class="scene" aria-hidden="true">
<div class="bowl-inside"></div>
<div class="bowl-slips">${pieces(BOWL_SLIPS)}</div>
${lifting ? raw('<div class="lift"><i></i></div>') : ''}
<div class="bowl"></div>
</div>`;
}

export function drawView({ lang, drawAction, langAction, showLangSwitch }) {
  const body = html`<h1>${t(lang, 'draw.title')}</h1>
<p class="lead">${t(lang, 'draw.intro')}</p>
${bowl()}
<form method="post" action="${drawAction}">
<button type="submit" class="button">${iconInline('gift', t(lang, 'draw.button'))}</button>
</form>
${footer({ lang, langAction, showLangSwitch })}`;
  return { title: t(lang, 'draw.title'), body };
}

// The translation keeps {name} in place so the name can get its own element
// on the slip whatever the word order of the language.
function givesTo(lang, name, reveal) {
  const [before, after = ''] = t(lang, 'result.givesTo').split('{name}');
  return html`<h1 class="slip"${reveal ? raw(' tabindex="-1" data-reveal-focus') : ''}><span class="slip-lead">${before.trim()}</span>
<span class="slip-name">${name}</span>${after}</h1>`;
}

function wishCard({ receiver, event, lang }) {
  const lines = wishLines(receiver.wishes, wishForm(event), lang);
  const content = lines.length
    ? html`<dl>${lines.map((line) => html`<div><dt${endsInMark(line.label) ? raw(' class="ends-in-mark"') : ''}>${line.label}</dt><dd>${line.value}</dd></div>`)}</dl>`
    : html`<p>${t(lang, 'result.noWishes', { name: receiver.name })}</p>`;
  return html`<section class="wishes">
<h2>${t(lang, 'result.wishesTitle', { name: receiver.name })}</h2>
${content}
</section>`;
}

// With reveal, CSS plays the bowl, slip and confetti over about three
// seconds. The name is in the markup from the start, so without script or
// animation support the result simply shows.
// editText replaces the participant's own wording when the organiser shows
// this screen on their behalf.
export function resultView({
  participant, receiver, event, group, lang, tz, reveal, editHref, editText = null, langAction, showLangSwitch,
}) {
  // Someone who draws before filling in anything is asked to, not told to "change" nothing.
  const ownText = t(lang, hasWishes(participant?.wishes, wishForm(event)) ? 'result.edit' : 'result.fillIn');
  const heading = givesTo(lang, receiver.name, reveal);
  const top = reveal
    ? html`<div class="reveal" data-reveal>
${bowl({ lifting: true })}
${heading}
<div class="confetti" aria-hidden="true">${pieces(CONFETTI_PIECES)}</div>
<button type="button" class="skip" data-skip hidden>${t(lang, 'draw.skip')}</button>
</div>`
    : heading;
  const body = html`${top}
<div class="result-rest">
${themeBlock({ event, group, lang, tz })}
${wishCard({ receiver, event, lang })}
<a class="edit-link" href="${editHref}">${iconInline('pencil', editText ?? ownText)}</a>
${footer({ lang, langAction, showLangSwitch })}
</div>`;
  return { title: t(lang, 'result.title'), body, scripts: reveal ? ['reveal.js'] : [] };
}

// Long wishes would push an A5 page onto a second sheet, so the card steps
// its type down by the amount of text rather than letting the browser split it.
// Every wish line and paragraph starts a printed row of its own, so each
// counts in whole rows of CARD_ROW characters: fifteen one-word answers
// fill as much paper as a few long ones. The limits were measured by
// printing cards with long wishes, many short answers, a long theme and a
// long exchange place to A5 PDF in Chrome.
const CARD_TEXT_STEPS = [[950, 'card-smallest'], [700, 'card-smaller']];
const CARD_ROW = 50;
const inRows = (length) => Math.ceil(length / CARD_ROW) * CARD_ROW;

function cardSize(lines, ...texts) {
  const paragraphs = texts.flatMap((text) => text.split('\n'));
  const length = lines.reduce((sum, line) => sum + inRows(line.label.length + line.value.length + 2), 0)
    + paragraphs.reduce((sum, text) => sum + inRows(text.length), 0);
  return CARD_TEXT_STEPS.find(([limit]) => length > limit)?.[1] ?? '';
}

// The printed counterpart of the result screen, for someone without a device.
export function cardView({ participant, receiver, event, group, lang, tz }) {
  const lines = wishLines(receiver.wishes, wishForm(event), lang);
  const size = cardSize(lines, themeText(event, lang), exchangeLine(lang, group, tz));
  const [before, after = ''] = t(lang, 'result.givesTo').split('{name}');
  const body = html`<article class="card${size ? ` ${size}` : ''}">
<p class="card-for">${t(lang, 'card.for', { name: participant.name })}</p>
<h1><span class="card-lead">${before.trim()}</span>
<span class="card-name">${receiver.name}</span>${after}</h1>
${themeBlock({ event, group, lang, tz })}
${wishCard({ receiver, event, lang })}
</article>`;
  return { title: t(lang, 'result.title'), body };
}
