import { html } from '../html.js';
import { t } from '../i18n/index.js';

const ERROR_KEYS = new Set([400, 403, 404, 429, 500]);

function stylesheet(file, assetVersion) {
  return html`<link rel="stylesheet" href="/static/css/${file}?v=${assetVersion}">`;
}

function shell({ lang, title, body, assetVersion, styles }) {
  return html`<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} - ${t(lang, 'app.name')}</title>
${styles.map((file) => stylesheet(file, assetVersion))}
</head>
<body>
${body}
</body>
</html>
`.toString();
}

export function participantPage({ lang, title, body, assetVersion }) {
  const content = html`<main class="screen">
<p class="app-name">${t(lang, 'app.name')}</p>
${body}
</main>`;
  return shell({ lang, title, body: content, assetVersion, styles: ['base.css', 'participant.css'] });
}

// One plain sentence and nothing else: no status code, no detail.
export function errorPage({ status, lang = 'nl', assetVersion }) {
  const key = ERROR_KEYS.has(status) ? status : status >= 500 ? 500 : 400;
  const body = html`<h1>${t(lang, 'error.title')}</h1>
<p class="lead">${t(lang, `error.${key}`)}</p>`;
  return participantPage({ lang, title: t(lang, 'error.title'), body, assetVersion });
}
