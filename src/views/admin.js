import { html } from '../html.js';
import { t } from '../i18n/index.js';

export function loginView(lang, { error = null } = {}) {
  const title = t(lang, 'admin.login.title');
  const body = html`<h1>${title}</h1>
${error ? html`<p class="notice error" role="alert">${t(lang, error)}</p>` : ''}
<form method="post" action="/admin/login" class="stack">
<label for="password">${t(lang, 'admin.login.password')}</label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
<button type="submit" class="primary">${t(lang, 'admin.login.submit')}</button>
</form>`;
  return { title, body };
}

export function noAccessView(lang) {
  const title = t(lang, 'admin.noAccess.title');
  const body = html`<h1>${title}</h1>
<p>${t(lang, 'admin.noAccess.body')}</p>`;
  return { title, body };
}

export function eventsView(lang, events) {
  const title = t(lang, 'admin.events.title');
  const list = events.length
    ? html`<ul class="list">${events.map((event) => html`<li>${event.name}</li>`)}</ul>`
    : html`<p class="muted">${t(lang, 'admin.events.empty')}</p>`;
  const body = html`<h1>${title}</h1>
${list}`;
  return { title, body };
}
