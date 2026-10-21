import { html, raw } from '../html.js';
import { formatDate, LANGS, t, themeText } from '../i18n/index.js';
import { detailPrompt, PET_IDS, wishOptions } from '../wishes.js';

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
