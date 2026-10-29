import { html } from '../html.js';
import { iconText } from '../icons.js';
import { exchangeWhen, formatDate, t } from '../i18n/index.js';
import { IMPORT_TEXT_MAX } from '../event-file.js';
import { assistantPrompt } from '../import-prompt.js';
import { clipText } from '../text.js';
import { questionText, wishForm } from '../questions.js';
import { backLink, formToken } from './admin.js';
import { kindText } from './questions.js';

const GUIDE_URL = 'https://rouzax.github.io/giftdraw/guide/import/';
// A name echoed in a location or a message is cut short: the file can hold
// any length, and a problem with a name is often that it is far too long.
const ECHO_MAX = 40;
// A file wrong throughout gives a problem per field; the first ones are
// enough to see what is wrong, and the page stays small.
const PROBLEMS_SHOWN = 100;

const echo = (value) => {
  const text = String(value ?? '');
  const short = clipText(text, ECHO_MAX, 'codepoints');
  return short === text ? text : `${short}…`;
};

function whereText(lang, where) {
  return where.map((step) => {
    if (step.part === 'event') return t(lang, 'import.where.event');
    if (step.group) {
      return step.name ? t(lang, 'import.where.groupNamed', { n: step.group, name: echo(step.name) })
        : t(lang, 'import.where.group', { n: step.group });
    }
    if (step.participant) {
      return step.name ? t(lang, 'import.where.participantNamed', { n: step.participant, name: echo(step.name) })
        : t(lang, 'import.where.participant', { n: step.participant });
    }
    if (step.question) return t(lang, 'import.where.question', { n: step.question });
    if (step.choice) return t(lang, 'import.where.choice', { n: step.choice });
    if (step.option) return t(lang, 'import.where.option', { field: step.option, n: step.n });
    return t(lang, 'import.where.section', { id: step.section });
  }).join(', ');
}

function problemList(lang, problems, kind) {
  const hidden = problems.length - PROBLEMS_SHOWN;
  return html`<ul>${problems.slice(0, PROBLEMS_SHOWN).map((p) => {
    const vars = Object.fromEntries(Object.entries(p.vars).map(([k, v]) => [k, typeof v === 'string' ? echo(v) : v]));
    const message = t(lang, `import.${kind}.${p.code}`, vars);
    return html`<li>${p.where.length ? html`<strong>${whereText(lang, p.where)}:</strong> ` : ''}${message}</li>`;
  })}</ul>
${hidden > 0 ? html`<p>${t(lang, 'import.more', { count: hidden })}</p>` : ''}`;
}

function textForm(lang, text) {
  return html`<form method="post" action="/admin/events/import" class="stack" data-import-form>
<p class="import-file" hidden>
<label for="import-file" class="button-link with-icon">${iconText('file-up', t(lang, 'import.file'))}</label>
<input id="import-file" type="file" accept=".json,application/json,text/plain" class="visually-hidden" data-import-file data-max-bytes="${IMPORT_TEXT_MAX * 4}" data-too-big="${t(lang, 'import.error.too-large', { max: IMPORT_TEXT_MAX })}">
</p>
<p class="notice error" role="alert" hidden data-import-status></p>
<label for="import-text">${t(lang, 'import.label')}</label>
<p class="hint" id="import-text-hint">${t(lang, 'import.hint')}</p>
<textarea id="import-text" name="text" rows="14" maxlength="${IMPORT_TEXT_MAX}" spellcheck="false" aria-describedby="import-text-hint" required>${text}</textarea>
<button type="submit" class="primary">${t(lang, 'import.check')}</button>
</form>`;
}

// The request is in the organiser's language and asks for an event in it.
// Without script the field can still be selected and copied by hand.
function assistantPanel(lang) {
  return html`<section class="panel">
<h2>${t(lang, 'import.assistant.title')}</h2>
<div class="copy-link" data-copy-link data-copied="${t(lang, 'import.assistant.copied')}" data-failed="${t(lang, 'import.assistant.copyFailed')}">
<p id="assistant-prompt-hint">${t(lang, 'import.assistant.intro')}</p>
<p class="hint">${t(lang, 'import.privacy')}</p>
<label for="assistant-prompt">${t(lang, 'import.assistant.label')}</label>
<textarea id="assistant-prompt" class="assistant-prompt" rows="8" readonly spellcheck="false" aria-describedby="assistant-prompt-hint" data-copy-source>${assistantPrompt(lang)}</textarea>
<p><button type="button" class="primary with-icon" data-copy hidden>${iconText('copy', t(lang, 'import.assistant.copy'))}</button></p>
<p class="small" aria-live="polite" data-copy-status></p>
</div>
</section>`;
}

export function importView(lang, { text = '' } = {}) {
  const title = t(lang, 'import.title');
  const body = html`${backLink('/admin', t(lang, 'admin.events.back'))}
<h1>${title}</h1>
<p>${t(lang, 'import.intro')} <a href="${GUIDE_URL}" rel="noopener">${t(lang, 'import.guide')}</a></p>
${assistantPanel(lang)}
<section class="panel">
<h2>${t(lang, 'import.paste.title')}</h2>
${textForm(lang, text)}
</section>`;
  return { title, body, scripts: ['import-file.js', 'copy-link.js'] };
}

// The form in its order, worded as the event page's question list words it.
function formItems(lang, event) {
  return html`<ol class="import-questions">${wishForm(event).questions.map((q) => html`<li>
<span class="question-text">${questionText(q, lang)}</span> <span class="muted">${kindText(lang, q)}</span>${q.show ? '' : html` <span class="badge">${t(lang, 'admin.form.hidden')}</span>`}
${q.type === 'choices' ? html`<ul>${q.choices.map((c) => {
    const label = c.label(lang);
    return html`<li>${c.question ? `${label}: ${c.question}` : label}</li>`;
  })}</ul>` : ''}
</li>`)}</ol>`;
}

function eventSummary(lang, event) {
  return html`<section class="panel">
<h2>${t(lang, 'import.event')}: ${event.name}</h2>
<dl class="import-facts">
<dt>${t(lang, 'admin.event.language')}</dt><dd>${t(lang, `lang.${event.language}`)}</dd>
<dt>${t(lang, 'admin.event.cleanupWeeks')}</dt><dd>${event.cleanupWeeks}</dd>
<dt>${t(lang, 'import.theme')}</dt><dd>${event.themeText ? html`<span class="pre-line">${event.themeText}</span>` : t(lang, 'import.theme.standard')}</dd>
<dt>${t(lang, 'admin.form.title')}</dt><dd>${formItems(lang, event)}</dd>
</dl>
</section>`;
}

function groupSummary(lang, group, tz) {
  const emails = group.participants.filter((p) => p.email).length;
  const people = group.participants.length
    ? html`<details>
<summary>${t(lang, 'import.group.people', { count: group.participants.length, emails })}</summary>
<ul>${group.participants.map((p) => html`<li>${p.email ? `${p.name} (${p.email})` : p.name}</li>`)}</ul>
</details>`
    : html`<p class="muted">${t(lang, 'import.group.noPeople')}</p>`;
  return html`<li>
<h3>${group.name}</h3>
<p>${t(lang, 'import.group.when')}: ${exchangeWhen(lang, group, tz)}${group.exchangePlace ? `, ${group.exchangePlace}` : ''}</p>
${group.autoOpenAt ? html`<p>${t(lang, 'import.group.autoOpen', { date: formatDate(lang, group.autoOpenAt, tz) })}</p>` : ''}
${people}
</li>`;
}

// result: {errors, warnings, plan} from readEventFile.
export function importCheckView(lang, { text, result, tz }) {
  const { errors, warnings, plan } = result;
  if (errors.length) {
    const title = t(lang, 'import.errorsTitle');
    const body = html`${backLink('/admin', t(lang, 'admin.events.back'))}
<h1>${title}</h1>
<section class="panel" role="alert">
<p>${t(lang, 'import.errorsIntro')}</p>
${problemList(lang, errors, 'error')}
</section>
<section class="panel">
<h2>${t(lang, 'import.correct')}</h2>
${textForm(lang, text)}
</section>`;
    return { title, body, scripts: ['import-file.js'] };
  }
  const title = t(lang, 'import.previewTitle');
  const warningPanel = warnings.length
    ? html`<section class="panel">
<h2>${t(lang, 'import.warningsTitle')}</h2>
${problemList(lang, warnings, 'warn')}
</section>`
    : '';
  const groups = plan.groups.length
    ? html`<ul class="import-groups">${plan.groups.map((group) => groupSummary(lang, group, tz))}</ul>`
    : '';
  const body = html`${backLink('/admin', t(lang, 'admin.events.back'))}
<h1>${title}</h1>
${warningPanel}
${eventSummary(lang, plan.event)}
<section class="panel">
<h2>${t(lang, 'import.groups', { count: plan.groups.length })}</h2>
${groups}
</section>
<section class="panel">
<p>${t(lang, 'import.noMail')}</p>
<form method="post" action="/admin/events/import">
<input type="hidden" name="confirm" value="1">
${formToken()}
<input type="hidden" name="text" value="${text}">
<button type="submit" class="primary">${t(lang, 'import.confirm')}</button>
</form>
</section>
<section class="panel">
<h2>${t(lang, 'import.correct')}</h2>
${textForm(lang, text)}
</section>`;
  return { title, body, scripts: ['import-file.js'] };
}
