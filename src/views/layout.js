import { html } from '../html.js';
import { LANGS, t } from '../i18n/index.js';

const ERROR_KEYS = new Set([400, 403, 404, 429, 500]);

function stylesheet(file, assetVersion) {
  return html`<link rel="stylesheet" href="/static/css/${file}?v=${assetVersion}">`;
}

function script(file, assetVersion) {
  return html`<script src="/static/js/${file}?v=${assetVersion}" defer></script>`;
}

function shell({ lang, title, body, assetVersion, styles, scripts = [] }) {
  return html`<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} - ${t(lang, 'app.name')}</title>
<link rel="icon" type="image/svg+xml" href="/static/favicon.svg?v=${assetVersion}">
${styles.map((file) => stylesheet(file, assetVersion))}
${scripts.map((file) => script(file, assetVersion))}
</head>
<body>
${body}
</body>
</html>
`.toString();
}

export function participantPage({ lang, title, body, assetVersion, scripts }) {
  const content = html`<main class="screen">
<p class="app-name">${t(lang, 'app.name')}</p>
${body}
</main>`;
  return shell({ lang, title, body: content, assetVersion, styles: ['base.css', 'participant.css'], scripts });
}

function langSwitch(lang) {
  return html`<form method="post" action="/admin/lang" class="lang-switch" aria-label="${t(lang, 'lang.switch')}">
${LANGS.map((code) => html`<button type="submit" name="lang" value="${code}"${code === lang ? html` aria-current="true"` : ''}>${t(code, `lang.${code}`)}</button>`)}
</form>`;
}

// The organiser works on phone and desktop alike: one column that widens.
export function renderAdminPage(lang, { title, body, assetVersion, scripts = [], showLangSwitch = true, showLogout = false }) {
  const logout = showLogout
    ? html`<form method="post" action="/admin/logout"><button type="submit">${t(lang, 'admin.logout')}</button></form>`
    : '';
  const content = html`<header class="admin-bar">
<a class="admin-home" href="/admin">${t(lang, 'app.name')} <span>${t(lang, 'admin.role')}</span></a>
<div class="admin-actions">
${showLangSwitch ? langSwitch(lang) : ''}
${logout}
</div>
</header>
<main class="admin">
${body}
</main>`;
  return shell({ lang, title, body: content, assetVersion, styles: ['base.css', 'admin.css'], scripts: ['submit-once.js', ...scripts] });
}

// On-behalf screens: the participant's own screen at participant sizes and in
// their language, under a slim organiser bar in the organiser's language.
export function behalfPage({ lang, adminLang, title, body, assetVersion, scripts, note, back }) {
  const content = html`<header class="behalf-bar" lang="${adminLang}">
<a href="${back.href}">${back.label}</a>
<p>${note}</p>
</header>
<main class="screen">
${body}
</main>`;
  return shell({ lang, title, body: content, assetVersion, styles: ['base.css', 'participant.css'], scripts });
}

// The printed card: no app chrome, only the card and, on screen, the
// organiser's print controls.
export function printPage({ lang, title, body, assetVersion }) {
  return shell({ lang, title, body, assetVersion, styles: ['base.css', 'print.css'], scripts: ['print.js'] });
}

// One plain sentence and nothing else: no status code, no detail.
export function errorPage({ status, lang = 'nl', assetVersion }) {
  const key = ERROR_KEYS.has(status) ? status : status >= 500 ? 500 : 400;
  const body = html`<h1>${t(lang, 'error.title')}</h1>
<p class="lead">${t(lang, `error.${key}`)}</p>`;
  return participantPage({ lang, title: t(lang, 'error.title'), body, assetVersion });
}
