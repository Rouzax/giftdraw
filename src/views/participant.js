import { html, raw } from '../html.js';
import { exchangeLine, LANGS, t, themeText } from '../i18n/index.js';
import { detailPrompt, hasWishes, PET_IDS, wishLines, wishOptions } from '../wishes.js';

// Fragments take their links and form targets as arguments so the organiser
// can show the same screens inside the admin shell when acting on behalf.

const TEXT_MAX = 1000;
const checked = (on) => (on ? raw(' checked') : '');

function themeBlock({ event, group, lang, tz }) {
  return html`<section class="theme">
<p>${themeText(event, lang)}</p>
<p class="date">${exchangeLine(lang, group, tz)}</p>
</section>`;
}

function langSwitch({ lang, langAction, from }) {
  const others = LANGS.filter((l) => l !== lang);
  return html`<form class="lang-switch" method="post" action="${langAction}" aria-label="${t(lang, 'lang.switch')}">
${from ? html`<input type="hidden" name="from" value="${from}">` : ''}
${others.map((l) => html`<button type="submit" name="lang" value="${l}" lang="${l}">${t(l, `lang.${l}`)}</button>`)}
</form>`;
}

function footer({ lang, langAction, showLangSwitch, from }) {
  return showLangSwitch ? langSwitch({ lang, langAction, from }) : '';
}

export function welcomeView({ participant, event, group, lang, tz, editHref, langAction, showLangSwitch }) {
  const body = html`<h1>${t(lang, 'welcome.greeting', { name: participant.name })}</h1>
<p class="lead">${t(lang, 'welcome.intro')}</p>
${themeBlock({ event, group, lang, tz })}
<a class="button" href="${editHref}">${t(lang, 'welcome.button')}</a>
${footer({ lang, langAction, showLangSwitch })}`;
  return { title: t(lang, 'welcome.title'), body };
}

// emailOn is false when the app sends no mail at all: an address alone does
// not mean an email will come.
export function waitingView({ participant, event, group, lang, tz, editHref, langAction, showLangSwitch, emailOn }) {
  const body = html`<h1>${t(lang, 'welcome.greeting', { name: participant.name })}</h1>
<p class="lead">${t(lang, participant.email && emailOn ? 'waiting.thanks' : 'waiting.thanksNoEmail')}</p>
${themeBlock({ event, group, lang, tz })}
<a class="button" href="${editHref}">${t(lang, 'waiting.edit')}</a>
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

function textInput(name, label, value) {
  return html`<label class="field-label sub" for="${name}">${label}</label>
<input type="text" id="${name}" name="${name}" maxlength="${TEXT_MAX}" value="${value ?? ''}">`;
}

function checkbox(name, value, label, on) {
  return html`<label class="check"><input type="checkbox" name="${name}" value="${value}"${checked(on)}> <span>${label}</span></label>`;
}

export function aboutFormView({ event, group, wishes, lang, tz, formAction, langAction, showLangSwitch }) {
  const w = wishes ?? {};
  const likes = new Set(w.likes ?? []);
  const pets = new Set(w.pets ?? []);
  const likeFields = wishOptions(event).map((option) => {
    const box = checkbox('likes', option.id, option.label(lang), likes.has(option.id));
    if (!option.detail) return box;
    const name = `detail_${option.id}`;
    return html`${box}
<div class="detail">${textInput(name, detailPrompt(option, lang), w.likeDetails?.[option.id])}</div>`;
  });
  const petFields = PET_IDS.map((id) => checkbox('pets', id, t(lang, `wish.pet.${id}`), pets.has(id)));

  const body = html`<h1>${t(lang, 'about.title')}</h1>
<p class="lead">${t(lang, 'about.intro')}</p>
${themeBlock({ event, group, lang, tz })}
<form class="about" method="post" action="${formAction}">
${textArea('hobbies', t(lang, 'wish.hobbies'), w.hobbies)}
<fieldset>
<legend>${t(lang, 'wish.likes')}</legend>
${likeFields}
</fieldset>
<fieldset>
<legend>${t(lang, 'wish.pets')}</legend>
${petFields}
<div class="detail">${textInput('pets_other', t(lang, 'wish.petsOther'), w.petsOther)}</div>
</fieldset>
${textArea('avoid', t(lang, 'wish.avoid'), w.avoid)}
${textArea('other', t(lang, 'wish.other'), w.other)}
<button type="submit" class="button">${t(lang, 'about.save')}</button>
</form>
${footer({ lang, langAction, showLangSwitch, from: 'about' })}`;
  return { title: t(lang, 'about.title'), body };
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
<button type="submit" class="button">${t(lang, 'draw.button')}</button>
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
  const lines = wishLines(receiver.wishes, wishOptions(event), lang);
  const content = lines.length
    ? html`<dl>${lines.map((line) => html`<div><dt>${line.label}</dt><dd>${line.value}</dd></div>`)}</dl>`
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
  const ownText = t(lang, hasWishes(participant?.wishes) ? 'result.edit' : 'result.fillIn');
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
<a class="edit-link" href="${editHref}">${editText ?? ownText}</a>
${footer({ lang, langAction, showLangSwitch })}
</div>`;
  return { title: t(lang, 'result.title'), body, scripts: reveal ? ['reveal.js'] : [] };
}

// Long wishes would push an A5 page onto a second sheet, so the card steps
// its type down by the amount of text rather than letting the browser split it.
// The limits were measured by printing cards with long wishes and a long
// exchange place to A5 PDF in Chrome.
const CARD_TEXT_STEPS = [[950, 'card-smallest'], [700, 'card-smaller']];

function cardSize(lines, ...texts) {
  const length = lines.reduce((sum, line) => sum + line.label.length + line.value.length, texts.join('').length);
  return CARD_TEXT_STEPS.find(([limit]) => length > limit)?.[1] ?? '';
}

// The printed counterpart of the result screen, for someone without a device.
export function cardView({ participant, receiver, event, group, lang, tz }) {
  const lines = wishLines(receiver.wishes, wishOptions(event), lang);
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
