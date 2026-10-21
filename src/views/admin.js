import { html, raw } from '../html.js';
import { formatDate, LANGS, t } from '../i18n/index.js';

const LOCALES = { nl: 'nl-NL', en: 'en-GB' };
const THEME_MAX = 2000;
const OPTIONS_MAX = 4000;
const PASTE_MAX = 20000;

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

// A stored timestamp as a short local date, e.g. "3 nov.".
function shortDate(lang, iso, tz) {
  return new Intl.DateTimeFormat(LOCALES[lang] ?? LOCALES.nl, { timeZone: tz, day: 'numeric', month: 'short' })
    .format(new Date(iso));
}

const selected = (on) => (on ? raw(' selected') : '');

function errorNotice(lang, error) {
  return error ? html`<p class="notice error" role="alert">${t(lang, error)}</p>` : '';
}

function languageSelect(lang, id, value) {
  return html`<select id="${id}" name="language">
${LANGS.map((code) => html`<option value="${code}"${selected(code === value)}>${t(code, `lang.${code}`)}</option>`)}
</select>`;
}

function backLink(href, label) {
  return html`<p class="back"><a href="${href}">${label}</a></p>`;
}

export function eventsView(lang, events, { error = null, values = {} } = {}) {
  const title = t(lang, 'admin.events.title');
  const list = events.length
    ? html`<ul class="link-list">${events.map((event) => html`<li><a href="/admin/events/${event.id}">${event.name}</a></li>`)}</ul>`
    : html`<p class="muted">${t(lang, 'admin.events.empty')}</p>`;
  const body = html`<h1>${title}</h1>
${list}
<section class="panel">
<h2>${t(lang, 'admin.events.new')}</h2>
${errorNotice(lang, error)}
<form method="post" action="/admin/events" class="stack">
<label for="event-name">${t(lang, 'admin.event.name')}</label>
<input id="event-name" name="name" type="text" maxlength="100" required value="${values.name ?? ''}">
<label for="event-language">${t(lang, 'admin.event.language')}</label>
${languageSelect(lang, 'event-language', values.language ?? 'nl')}
<button type="submit" class="primary">${t(lang, 'admin.events.create')}</button>
</form>
</section>`;
  return { title, body };
}

function dateInput(id, name, label, value, { required = false, hint = null } = {}) {
  return html`<label for="${id}">${label}</label>
${hint ? html`<p class="hint" id="${id}-hint">${hint}</p>` : ''}
<input id="${id}" name="${name}" type="date" value="${value ?? ''}"${required ? raw(' required') : ''}${hint ? raw(` aria-describedby="${id}-hint"`) : ''}>`;
}

function groupFields(lang, prefix, values) {
  return html`<label for="${prefix}-name">${t(lang, 'admin.group.name')}</label>
<input id="${prefix}-name" name="name" type="text" maxlength="100" required value="${values.name ?? ''}">
${dateInput(`${prefix}-exchange`, 'exchangeDate', t(lang, 'admin.group.exchangeDate'), values.exchangeDate, { required: true })}
${dateInput(`${prefix}-auto`, 'autoOpenAt', t(lang, 'admin.group.autoOpenAt'), values.autoOpenAt, { hint: t(lang, 'admin.group.autoOpenHint') })}`;
}

function deleteForm(lang, action, { label, warning }) {
  return html`<section class="panel danger">
<h2>${label}</h2>
<form method="post" action="${action}" class="stack">
<p>${warning}</p>
<label class="check"><input type="checkbox" name="confirm" value="1" required> <span>${t(lang, 'admin.delete.confirm')}</span></label>
<button type="submit" class="danger">${label}</button>
</form>
</section>`;
}

export function eventView(lang, { event, groups, newGroup, themeValue, optionsValue, tz, error = null, groupError = null }) {
  const title = event.name;
  const groupList = groups.length
    ? html`<ul class="group-list">${groups.map(({ group, size }) => html`<li>
<a href="/admin/groups/${group.id}">${group.name}</a>
<span class="muted">${t(lang, 'admin.group.summaryLine', { count: size, date: formatDate(lang, group.exchangeDate, tz) })}</span>
<span class="badge${group.openedAt ? ' on' : ''}">${t(lang, group.openedAt ? 'admin.group.isOpen' : 'admin.group.notOpen')}</span>
</li>`)}</ul>`
    : html`<p class="muted">${t(lang, 'admin.groups.empty')}</p>`;
  const body = html`${backLink('/admin', t(lang, 'admin.events.back'))}
<h1>${title}</h1>
<section class="panel">
<h2>${t(lang, 'admin.groups.title')}</h2>
${groupList}
</section>
<section class="panel">
<h2>${t(lang, 'admin.groups.new')}</h2>
${errorNotice(lang, groupError)}
<form method="post" action="/admin/events/${event.id}/groups" class="stack">
${groupFields(lang, 'new-group', newGroup)}
<button type="submit" class="primary">${t(lang, 'admin.groups.create')}</button>
</form>
</section>
<section class="panel">
<h2>${t(lang, 'admin.event.settings')}</h2>
${errorNotice(lang, error)}
<form method="post" action="/admin/events/${event.id}" class="stack">
<label for="event-name">${t(lang, 'admin.event.name')}</label>
<input id="event-name" name="name" type="text" maxlength="100" required value="${event.name}">
<label for="event-language">${t(lang, 'admin.event.language')}</label>
${languageSelect(lang, 'event-language', event.language)}
<label for="event-cleanup">${t(lang, 'admin.event.cleanupWeeks')}</label>
<p class="hint" id="event-cleanup-hint">${t(lang, 'admin.event.cleanupHint')}</p>
<input id="event-cleanup" name="cleanupWeeks" type="number" min="1" max="52" required value="${event.cleanupWeeks}" aria-describedby="event-cleanup-hint">
<label for="event-theme">${t(lang, 'admin.event.theme')}</label>
<p class="hint" id="event-theme-hint">${t(lang, 'admin.event.themeHint')}</p>
<textarea id="event-theme" name="themeText" rows="7" maxlength="${THEME_MAX}" aria-describedby="event-theme-hint">${themeValue}</textarea>
<label for="event-options">${t(lang, 'admin.event.options')}</label>
<p class="hint" id="event-options-hint">${t(lang, 'admin.event.optionsHint')}</p>
<textarea id="event-options" name="wishOptions" rows="9" maxlength="${OPTIONS_MAX}" aria-describedby="event-options-hint">${optionsValue}</textarea>
<button type="submit" class="primary">${t(lang, 'admin.save')}</button>
</form>
</section>
${deleteForm(lang, `/admin/events/${event.id}/delete`, { label: t(lang, 'admin.event.delete'), warning: t(lang, 'admin.event.deleteWarning') })}`;
  return { title, body };
}

function inviteCell(lang, row) {
  if (!row.participant.email) return html`<span class="muted">${t(lang, 'admin.status.notApplicable')}</span>`;
  const state = row.mail.invite;
  if (state) return html`<span class="state-${state}">${t(lang, `admin.invite.${state}`)}</span>`;
  if (row.participant.invitedAt) return t(lang, 'admin.status.yes');
  return html`<span class="muted">${t(lang, 'admin.status.notYet')}</span>`;
}

function dateOrNo(lang, iso, tz, noKey = 'admin.status.no') {
  return iso ? shortDate(lang, iso, tz) : html`<span class="muted">${t(lang, noKey)}</span>`;
}

function failureCell(lang, failure, tz) {
  if (!failure) return html`<span class="muted">${t(lang, 'admin.status.none')}</span>`;
  const kind = t(lang, `admin.mailKind.${failure.kind}`);
  const state = failure.retrying ? t(lang, 'admin.failure.retrying') : t(lang, 'admin.failure.gaveUp', { date: shortDate(lang, failure.at, tz) });
  return html`<span class="state-failed">${kind}: <code>${failure.errorCode}</code></span> <span class="small">${state}</span>`;
}

function cardCell(lang, row) {
  if (!row.participant.printedAt) return html`<span class="muted">${t(lang, 'admin.card.notPrinted')}</span>`;
  if (row.cardOutOfDate) return html`<span class="state-failed">${t(lang, 'admin.card.outOfDate')}</span>`;
  return t(lang, 'admin.card.current');
}

// A break opportunity before the @ keeps a narrow column from splitting
// the address mid-word.
function emailText(email) {
  const at = email.lastIndexOf('@');
  return html`<span class="email">${email.slice(0, at)}<wbr>${email.slice(at)}</span>`;
}

function participantRow(lang, row, tz) {
  const { participant: p, receiver } = row;
  const label = (key) => t(lang, `admin.col.${key}`);
  // One wrapper per cell: the phone layout is a two-column grid of label and value.
  const cell = (key, content, text = label(key)) => html`<td data-label="${text}"><div>${content}</div></td>`;
  return html`<tr>
<th scope="row">${p.name}</th>
${cell('email', p.email ? emailText(p.email) : html`<span class="muted">${t(lang, 'admin.noEmail')}</span>`)}
${cell('invited', inviteCell(lang, row))}
${cell('visited', dateOrNo(lang, p.visitedAt, tz), `${label('visited')} ${label('visitedNote')}`)}
${cell('wishes', row.hasWishes ? t(lang, 'admin.status.yes') : html`<span class="muted">${t(lang, 'admin.status.no')}</span>`)}
${cell('drawn', dateOrNo(lang, p.drawnAt, tz))}
${cell('givesTo', receiver ? receiver.name : html`<span class="muted">${t(lang, 'admin.status.unpaired')}</span>`)}
${cell('reminder', dateOrNo(lang, row.mail.lastReminderAt, tz, 'admin.status.none'))}
${cell('failure', failureCell(lang, row.mail.lastFailure, tz))}
${cell('card', cardCell(lang, row))}
</tr>`;
}

function participantTable(lang, rows, tz) {
  if (rows.length === 0) return html`<p class="muted">${t(lang, 'admin.participants.empty')}</p>`;
  const heading = (key) => html`<th scope="col">${t(lang, `admin.col.${key}`)}</th>`;
  return html`<div class="table-wrap">
<table class="people">
<thead><tr>
${heading('name')}${heading('email')}${heading('invited')}
<th scope="col">${t(lang, 'admin.col.visited')} <span class="small">${t(lang, 'admin.col.visitedNote')}</span></th>
${heading('wishes')}${heading('drawn')}${heading('givesTo')}${heading('reminder')}${heading('failure')}${heading('card')}
</tr></thead>
<tbody>
${rows.map((row) => participantRow(lang, row, tz))}
</tbody>
</table>
</div>`;
}

function summary(lang, rows) {
  const total = rows.length;
  const n = (test) => rows.filter(test).length;
  const withEmail = rows.filter((r) => r.participant.email);
  const items = [
    t(lang, 'admin.summary.drawn', { count: n((r) => r.participant.drawnAt), total }),
    t(lang, 'admin.summary.wishes', { count: n((r) => r.hasWishes), total }),
    t(lang, 'admin.summary.visited', { count: n((r) => r.participant.visitedAt), total }),
    t(lang, 'admin.summary.invited', { count: withEmail.filter((r) => r.participant.invitedAt).length, total: withEmail.length }),
  ];
  return html`<ul class="summary">${items.map((item) => html`<li>${item}</li>`)}</ul>`;
}

function groupStatus(lang, group, tz) {
  const lines = [];
  lines.push(group.invitationsSentAt
    ? t(lang, 'admin.group.invitationsSent', { date: shortDate(lang, group.invitationsSentAt, tz) })
    : t(lang, 'admin.group.invitationsNotSent'));
  if (group.openedAt) lines.push(t(lang, 'admin.group.openSince', { date: shortDate(lang, group.openedAt, tz) }));
  else if (group.autoOpenAt) lines.push(t(lang, 'admin.group.opensOn', { date: formatDate(lang, group.autoOpenAt, tz) }));
  else lines.push(t(lang, 'admin.group.notOpenYet'));
  lines.push(t(lang, 'admin.group.exchangeOn', { date: formatDate(lang, group.exchangeDate, tz) }));
  return html`<ul class="facts">${lines.map((line) => html`<li>${line}</li>`)}</ul>`;
}

export function groupView(lang, { event, group, rows, warnings, mailEnabled, tz, error = null, values = null }) {
  const title = group.name;
  const uninvited = rows.filter((r) => r.participant.email && !r.participant.invitedAt).length;
  const banners = [
    ...warnings.map((w) => html`<p class="notice warn">${t(lang, `admin.warning.${w}`)}</p>`),
    mailEnabled ? '' : html`<p class="notice warn">${t(lang, 'admin.mailOff')}</p>`,
  ];
  const form = values ?? group;
  const body = html`${backLink(`/admin/events/${event.id}`, event.name)}
<h1>${title}</h1>
${banners}
${summary(lang, rows)}
${groupStatus(lang, group, tz)}
<section class="panel">
<h2>${t(lang, 'admin.invite.title')}</h2>
<p>${mailEnabled ? t(lang, 'admin.invite.pending', { count: uninvited }) : t(lang, 'admin.mailOff')}</p>
<form method="post" action="/admin/groups/${group.id}/invite">
<button type="submit" class="primary">${t(lang, 'admin.invite.button')}</button>
</form>
</section>
<section class="panel wide">
<h2>${t(lang, 'admin.participants.title')}</h2>
${participantTable(lang, rows, tz)}
</section>
<section class="panel">
<h2>${t(lang, 'admin.paste.title')}</h2>
${pasteForm(lang, group.id, '')}
</section>
<section class="panel">
<h2>${t(lang, 'admin.group.settings')}</h2>
${errorNotice(lang, error)}
<form method="post" action="/admin/groups/${group.id}" class="stack">
${groupFields(lang, 'group', form)}
<button type="submit" class="primary">${t(lang, 'admin.save')}</button>
</form>
</section>
${deleteForm(lang, `/admin/groups/${group.id}/delete`, { label: t(lang, 'admin.group.delete'), warning: t(lang, 'admin.group.deleteWarning') })}`;
  return { title, body };
}

function pasteForm(lang, groupId, text) {
  return html`<form method="post" action="/admin/groups/${groupId}/participants" class="stack">
<label for="paste-text">${t(lang, 'admin.paste.label')}</label>
<p class="hint" id="paste-hint">${t(lang, 'admin.paste.hint')}</p>
<textarea id="paste-text" name="text" rows="8" maxlength="${PASTE_MAX}" aria-describedby="paste-hint">${text}</textarea>
<button type="submit" class="primary">${t(lang, 'admin.paste.check')}</button>
</form>`;
}

function personLabel(lang, row) {
  return row.email ? `${row.name} (${row.email})` : `${row.name} (${t(lang, 'admin.noEmail')})`;
}

// changes: [{giverName, newReceiverName, drawn, hasEmail}] for an open group.
export function pasteConfirmView(lang, { group, plan, errors, changes, text }) {
  const title = t(lang, 'admin.paste.confirmTitle');
  const errorList = errors.length
    ? html`<section class="panel">
<h2>${t(lang, 'admin.paste.skipped')}</h2>
<ul>${errors.map((e) => html`<li>${t(lang, 'admin.paste.line', { line: e.line })}: <code>${e.text}</code> (${t(lang, `admin.paste.reason.${e.reason}`)})</li>`)}</ul>
</section>`
    : '';
  const duplicates = plan.duplicates.length
    ? html`<section class="panel">
<h2>${t(lang, 'admin.paste.duplicatesTitle')}</h2>
<ul>${plan.duplicates.map((d) => html`<li>${t(lang, 'admin.paste.duplicate', { email: plan.rows[d.row].email, group: d.otherGroupName })}</li>`)}</ul>
</section>`
    : '';
  const changeNote = (c) => {
    if (!c.drawn) return '';
    return c.hasEmail ? t(lang, 'admin.paste.changeMailed') : t(lang, 'admin.paste.changeReprint');
  };
  const openNotice = changes
    ? html`<section class="panel">
<h2>${t(lang, 'admin.paste.openTitle')}</h2>
<p>${t(lang, 'admin.paste.openIntro')}</p>
<ul>${changes.map((c) => html`<li>${t(lang, 'admin.paste.change', { giver: c.giverName, receiver: c.newReceiverName })} ${changeNote(c)}</li>`)}</ul>
</section>`
    : '';
  const confirm = plan.rows.length
    ? html`<section class="panel">
<h2>${t(lang, 'admin.paste.toAdd', { count: plan.rows.length })}</h2>
<ul>${plan.rows.map((row) => html`<li>${personLabel(lang, row)}</li>`)}</ul>
<form method="post" action="/admin/groups/${group.id}/participants">
<input type="hidden" name="confirm" value="1">
<input type="hidden" name="plan" value="${JSON.stringify({ version: plan.version, rows: plan.rows })}">
<button type="submit" class="primary">${t(lang, 'admin.paste.confirm', { count: plan.rows.length })}</button>
</form>
</section>`
    : html`<p class="notice">${t(lang, 'admin.paste.nothing')}</p>`;
  const body = html`${backLink(`/admin/groups/${group.id}`, group.name)}
<h1>${title}</h1>
${errorList}
${duplicates}
${openNotice}
${confirm}
<section class="panel">
<h2>${t(lang, 'admin.paste.correct')}</h2>
${pasteForm(lang, group.id, text)}
</section>`;
  return { title, body };
}

export function messageView(lang, { titleKey, messageKey, href, linkText }) {
  const title = t(lang, titleKey);
  const body = html`<h1>${title}</h1>
<p class="notice warn">${t(lang, messageKey)}</p>
<p><a href="${href}">${linkText}</a></p>`;
  return { title, body };
}
