import { html, raw } from '../html.js';
import { formatDate, LANGS, t, themeText } from '../i18n/index.js';
import { detailPrompt, PET_IDS, wishLines, wishOptions } from '../wishes.js';

// Fragments take their links and form targets as arguments so the organiser
// can show the same screens inside the admin shell when acting on behalf.

const TEXT_MAX = 1000;
const checked = (on) => (on ? raw(' checked') : '');

function themeBlock({ event, group, lang, tz }) {
  const date = formatDate(lang, group.exchangeDate, tz);
  return html`<section class="theme">
<p>${themeText(event, lang)}</p>
<p class="date">${t(lang, 'common.exchangeDate', { date })}</p>
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

export function waitingView({ participant, event, group, lang, tz, editHref, langAction, showLangSwitch }) {
  const body = html`<h1>${t(lang, 'welcome.greeting', { name: participant.name })}</h1>
<p class="lead">${t(lang, participant.email ? 'waiting.thanks' : 'waiting.thanksNoEmail')}</p>
${themeBlock({ event, group, lang, tz })}
<a class="button" href="${editHref}">${t(lang, 'waiting.edit')}</a>
${footer({ lang, langAction, showLangSwitch })}`;
  return { title: t(lang, 'waiting.title'), body };
}

function textArea(name, label, value) {
  return html`<label class="field-label" for="${name}">${label}</label>
<textarea id="${name}" name="${name}" rows="3" maxlength="${TEXT_MAX}">${value ?? ''}</textarea>`;
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
export function resultView({ receiver, event, group, lang, tz, reveal, editHref, langAction, showLangSwitch }) {
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
<a class="edit-link" href="${editHref}">${t(lang, 'result.edit')}</a>
${footer({ lang, langAction, showLangSwitch })}
</div>`;
  return { title: t(lang, 'result.title'), body, scripts: reveal ? ['reveal.js'] : [] };
}
