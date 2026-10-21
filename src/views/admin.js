import { html, raw } from '../html.js';
import { formatDate, LANGS, t } from '../i18n/index.js';
import { PASTE_TEXT_MAX } from '../people.js';

const LOCALES = { nl: 'nl-NL', en: 'en-GB' };
const THEME_MAX = 2000;
const OPTIONS_MAX = 4000;
const MIN_GROUP = 3;

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

function languageSelect(id, value) {
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
${languageSelect('event-language', values.language ?? 'nl')}
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
${languageSelect('event-language', event.language)}
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

// With email off nobody is ever invited by mail, so "not yet" would never change.
function inviteCell(lang, row, mailEnabled) {
  if (!row.participant.email || !mailEnabled) return html`<span class="muted">${t(lang, 'admin.status.notApplicable')}</span>`;
  const state = row.mail.invite;
  if (state) return html`<span class="state-${state}">${t(lang, `admin.invite.${state}`)}</span>`;
  if (row.participant.invitedAt) return t(lang, 'admin.status.yes');
  return html`<span class="muted">${t(lang, 'admin.status.notYet')}</span>`;
}

function dateOrNo(lang, iso, tz, noKey = 'admin.status.no') {
  return iso ? shortDate(lang, iso, tz) : html`<span class="muted">${t(lang, noKey)}</span>`;
}

function failureText(lang, failure, tz) {
  const kind = t(lang, `admin.mailKind.${failure.kind}`);
  const state = failure.retrying ? t(lang, 'admin.failure.retrying') : t(lang, 'admin.failure.gaveUp', { date: shortDate(lang, failure.at, tz) });
  return html`<span class="state-failed">${kind}: <code>${failure.errorCode}</code></span> <span class="small">${state}</span>`;
}

// A mail still being retried goes out by itself; only one given up on can be
// sent again by hand.
function resendFailedForm(lang, participantId, { back = null } = {}) {
  return html`<form method="post" action="/admin/participants/${participantId}/resend-failed" class="inline-form">
${back ? html`<input type="hidden" name="back" value="${back}">` : ''}
<button type="submit">${t(lang, 'admin.failure.resend')}</button>
</form>`;
}

function failureCell(lang, failure, tz, participantId, mailEnabled) {
  if (!failure) return html`<span class="muted">${t(lang, 'admin.status.none')}</span>`;
  const resend = !failure.retrying && mailEnabled ? resendFailedForm(lang, participantId, { back: 'group' }) : '';
  return html`${failureText(lang, failure, tz)}${resend}`;
}

function cardCell(lang, row) {
  if (!row.participant.printedAt) return html`<span class="muted">${t(lang, 'admin.card.notPrinted')}</span>`;
  if (row.cardOutOfDate) {
    return html`<a class="state-failed" href="/admin/participants/${row.participant.id}/card">${t(lang, 'admin.card.outOfDate')}</a>`;
  }
  return t(lang, 'admin.card.current');
}

// A break opportunity before the @ keeps a narrow column from splitting
// the address mid-word.
function emailText(email) {
  const at = email.lastIndexOf('@');
  return html`<span class="email">${email.slice(0, at)}<wbr>${email.slice(at)}</span>`;
}

function participantRow(lang, row, tz, mailEnabled) {
  const { participant: p, receiver } = row;
  const label = (key) => t(lang, `admin.col.${key}`);
  // One wrapper per cell: the phone layout is a two-column grid of label and value.
  const cell = (key, content, text = label(key)) => html`<td data-label="${text}"><div>${content}</div></td>`;
  return html`<tr>
<th scope="row"><a href="/admin/participants/${p.id}">${p.name}</a></th>
${cell('email', p.email ? emailText(p.email) : html`<span class="muted">${t(lang, 'admin.noEmail')}</span>`)}
${cell('invited', inviteCell(lang, row, mailEnabled))}
${cell('visited', dateOrNo(lang, p.visitedAt, tz), `${label('visited')} ${label('visitedNote')}`)}
${cell('wishes', row.hasWishes ? t(lang, 'admin.status.yes') : html`<span class="muted">${t(lang, 'admin.status.no')}</span>`)}
${cell('drawn', dateOrNo(lang, p.drawnAt, tz))}
${cell('givesTo', receiver ? receiver.name : html`<span class="muted">${t(lang, 'admin.status.unpaired')}</span>`)}
${cell('reminder', dateOrNo(lang, row.mail.lastReminderAt, tz, 'admin.status.none'))}
${cell('failure', failureCell(lang, row.mail.lastFailure, tz, p.id, mailEnabled))}
${cell('card', cardCell(lang, row))}
</tr>`;
}

function participantTable(lang, rows, tz, mailEnabled) {
  if (rows.length === 0) return html`<p class="muted">${t(lang, 'admin.participants.empty')}</p>`;
  const heading = (key) => html`<th scope="col">${t(lang, `admin.col.${key}`)}</th>`;
  return html`<p class="hint">${t(lang, 'admin.participants.hint')}</p>
<div class="table-wrap">
<table class="people">
<thead><tr>
${heading('name')}${heading('email')}${heading('invited')}
<th scope="col">${t(lang, 'admin.col.visited')} <span class="small">${t(lang, 'admin.col.visitedNote')}</span></th>
${heading('wishes')}${heading('drawn')}${heading('givesTo')}${heading('reminder')}${heading('failure')}${heading('card')}
</tr></thead>
<tbody>
${rows.map((row) => participantRow(lang, row, tz, mailEnabled))}
</tbody>
</table>
</div>`;
}

function summary(lang, rows, mailEnabled) {
  const total = rows.length;
  const n = (test) => rows.filter(test).length;
  const withEmail = rows.filter((r) => r.participant.email);
  const items = [
    t(lang, 'admin.summary.drawn', { count: n((r) => r.participant.drawnAt), total }),
    t(lang, 'admin.summary.wishes', { count: n((r) => r.hasWishes), total }),
    t(lang, 'admin.summary.visited', { count: n((r) => r.participant.visitedAt), total }),
  ];
  if (mailEnabled) {
    items.push(t(lang, 'admin.summary.invited', {
      count: withEmail.filter((r) => r.participant.invitedAt).length, total: withEmail.length,
    }));
  }
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

// With email off the button only records that the organiser shared the
// links; once pressed there is nothing left to do here.
function invitePanelBody(lang, { group, mailEnabled, uninvited }) {
  if (!mailEnabled && group.invitationsSentAt) return html`<p>${t(lang, 'admin.invite.sharedNoMail')}</p>`;
  return html`<p>${mailEnabled ? t(lang, 'admin.invite.pending', { count: uninvited }) : t(lang, 'admin.invite.mailOff')}</p>
<form method="post" action="/admin/groups/${group.id}/invite">
<button type="submit" class="primary">${t(lang, mailEnabled ? 'admin.invite.button' : 'admin.invite.buttonNoMail')}</button>
</form>`;
}

// With email off the invitation button is labelled after sharing the links,
// so the hint has to name that button instead.
function openErrorKey(error, mailEnabled) {
  return error === 'no-invitations' && !mailEnabled ? 'admin.open.error.no-invitations-nomail' : `admin.open.error.${error}`;
}

function drawPanel(lang, { group, rows, openError, mailEnabled }) {
  const arrange = rows.some((r) => r.receiver)
    ? html`<p><a href="/admin/groups/${group.id}/arrange">${t(lang, 'admin.draw.arrange')}</a></p>`
    : '';
  const open = group.openedAt
    ? html`<p>${t(lang, 'admin.draw.isOpen')}</p>`
    : html`<p>${t(lang, mailEnabled ? 'admin.draw.openIntro' : 'admin.draw.openIntroNoMail')}</p>
${!group.invitationsSentAt && openError !== 'no-invitations' ? html`<p class="hint">${t(lang, openErrorKey('no-invitations', mailEnabled))}</p>` : ''}
<form method="post" action="/admin/groups/${group.id}/open">
<button type="submit" class="primary">${t(lang, 'admin.draw.openButton')}</button>
</form>`;
  return html`<section class="panel" id="draw">
<h2>${t(lang, 'admin.draw.title')}</h2>
${openError ? html`<p class="notice error" role="alert">${t(lang, openErrorKey(openError, mailEnabled))}</p>` : ''}
${open}
${arrange}
</section>`;
}

// Outcomes of the dashboard's "Send again", reported back on the dashboard.
export const GROUP_DONE = new Set(['failed-requeued', 'no-failure', 'mail-off']);

export function groupView(lang, {
  event, group, rows, warnings, mailEnabled, tz, error = null, values = null, pasteError = null, pasteText = '',
  openError = null, done = null,
}) {
  const title = group.name;
  const uninvited = rows.filter((r) => r.participant.email && !r.participant.invitedAt).length;
  const banners = [
    ...warnings.map((w) => html`<p class="notice warn">${t(lang, `admin.warning.${w}`)}</p>`),
    mailEnabled ? '' : html`<p class="notice warn">${t(lang, 'admin.mailOff')}</p>`,
  ];
  const form = values ?? group;
  const body = html`${backLink(`/admin/events/${event.id}`, event.name)}
<h1>${title}</h1>
${doneNotice(lang, done)}
${banners}
${summary(lang, rows, mailEnabled)}
${groupStatus(lang, group, tz)}
<section class="panel">
<h2>${t(lang, 'admin.invite.title')}</h2>
${invitePanelBody(lang, { group, mailEnabled, uninvited })}
</section>
${drawPanel(lang, { group, rows, openError, mailEnabled })}
<section class="panel wide">
<h2>${t(lang, 'admin.participants.title')}</h2>
${participantTable(lang, rows, tz, mailEnabled)}
</section>
<section class="panel">
<h2>${t(lang, 'admin.paste.title')}</h2>
${pasteError ? html`<p class="notice error" role="alert">${pasteError}</p>` : ''}
${pasteForm(lang, group.id, pasteText)}
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
<textarea id="paste-text" name="text" rows="8" maxlength="${PASTE_TEXT_MAX}" aria-describedby="paste-hint">${text}</textarea>
<button type="submit" class="primary">${t(lang, 'admin.paste.check')}</button>
</form>`;
}

function personLabel(lang, row) {
  return row.email ? `${row.name} (${row.email})` : `${row.name} (${t(lang, 'admin.noEmail')})`;
}

// changes: [{giverName, newReceiverName, drawn, hasEmail}], givers whose
// receiver changes in an open group.
function changeList(lang, changes) {
  const note = (c) => {
    if (!c.drawn) return '';
    return c.hasEmail ? t(lang, 'admin.paste.changeMailed') : t(lang, 'admin.paste.changeReprint');
  };
  return html`<ul>${changes.map((c) => html`<li>${t(lang, 'admin.paste.change', { giver: c.giverName, receiver: c.newReceiverName })} ${note(c)}</li>`)}</ul>`;
}

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
<ul>${plan.duplicates.map((d) => html`<li>${d.otherGroupName === null
    ? t(lang, 'admin.paste.duplicateInList', { email: plan.rows[d.row].email })
    : t(lang, 'admin.paste.duplicate', { email: plan.rows[d.row].email, group: d.otherGroupName })}</li>`)}</ul>
</section>`
    : '';
  const openNotice = changes
    ? html`<section class="panel">
<h2>${t(lang, 'admin.paste.openTitle')}</h2>
<p>${t(lang, 'admin.paste.openIntro')}</p>
${changeList(lang, changes)}
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

const LOCK_ICON = raw('<svg class="lock-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">'
  + '<path fill="currentColor" d="M4 7V5a4 4 0 0 1 8 0v2h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h1zm2 0h4V5a2 2 0 0 0-4 0v2z"/></svg>');

function pairRow(lang, { pair, others, groupId, version, swapped, canSwap }) {
  const { giver, receiver, locked } = pair;
  const classes = ['pair', locked ? 'is-locked' : '', swapped ? 'is-swapped' : ''].filter(Boolean).join(' ');
  let action = '';
  if (locked) action = html`<p class="lock">${LOCK_ICON} ${t(lang, 'admin.arrange.locked')}</p>`;
  else if (canSwap) {
    action = html`<form method="post" action="/admin/groups/${groupId}/swap" class="pair-swap">
<input type="hidden" name="a" value="${giver.id}">
<input type="hidden" name="version" value="${version}">
<label for="swap-${giver.id}">${t(lang, 'admin.arrange.swapWith')}</label>
<select id="swap-${giver.id}" name="b" required>
<option value="">${t(lang, 'admin.arrange.choose')}</option>
${others.filter((o) => o.giver.id !== giver.id).map((o) => html`<option value="${o.giver.id}">${t(lang, 'admin.arrange.option', { giver: o.giver.name, receiver: o.receiver.name })}</option>`)}
</select>
<button type="submit">${t(lang, 'admin.arrange.swap')}</button>
</form>`;
  }
  const data = locked || !canSwap ? '' : html` data-giver="${giver.id}" data-receiver="${receiver.id}" data-name="${giver.name}"`;
  return html`<li class="${classes}" id="pair-${giver.id}"${data}>
<p class="pair-names"><span class="pair-giver">${giver.name}</span> <span class="pair-arrow" aria-hidden="true">&rarr;</span><span class="visually-hidden">${t(lang, 'admin.arrange.givesTo')}</span> <span class="pair-receiver">${receiver.name}</span></p>
${action}
</li>`;
}

// arrange.js moves this item under the most recently picked card, so it
// pushes the rows below down instead of covering them.
function confirmBar(lang) {
  return html`<li class="arrange-bar" data-arrange-bar hidden role="group" aria-label="${t(lang, 'admin.arrange.barLabel')}" data-confirm="${t(lang, 'admin.arrange.confirm')}" data-self="${t(lang, 'admin.arrange.selfNote')}" data-next="${t(lang, 'admin.arrange.pickNext')}">
<p class="arrange-bar-text" data-text></p>
<div class="arrange-bar-actions">
<button type="button" class="primary" data-swap>${t(lang, 'admin.arrange.swap')}</button>
<button type="button" data-cancel>${t(lang, 'admin.arrange.cancel')}</button>
</div>
</li>`;
}

// pairs: [{giver, receiver, locked}] in a stable order, so rows stay put
// after a swap. swapped: the two giver ids just swapped, or null.
export function arrangeView(lang, { group, pairs, version, error = null, swapped = null }) {
  const title = t(lang, 'admin.arrange.title');
  const others = pairs.filter((p) => !p.locked);
  const byId = new Map(pairs.map((p) => [p.giver.id, p]));
  // In a cycle of 3 every two givers are neighbours, so any swap would give
  // one of them themselves.
  const canSwap = pairs.length > MIN_GROUP;
  const done = swapped && swapped.every((id) => byId.has(id))
    ? html`<p class="notice done" role="status">${t(lang, 'admin.arrange.swapped', {
      a: byId.get(swapped[0]).giver.name, ra: byId.get(swapped[0]).receiver.name,
      b: byId.get(swapped[1]).giver.name, rb: byId.get(swapped[1]).receiver.name,
    })}</p>`
    : '';
  const rows = pairs.map((pair) => pairRow(lang, {
    pair, others, groupId: group.id, version, swapped: swapped?.includes(pair.giver.id), canSwap,
  }));
  let list = html`<p class="muted">${t(lang, 'admin.arrange.noPairs')}</p>`;
  let how = '';
  if (pairs.length && !canSwap) {
    list = html`<ul class="pairs">
${rows}
</ul>`;
    how = html`<p class="notice warn">${t(lang, 'admin.arrange.groupOfThree')}</p>`;
  } else if (pairs.length) {
    list = html`<ul class="pairs" data-arrange data-pick="${t(lang, 'admin.arrange.pick')}" data-pick-label="${t(lang, 'admin.arrange.pickLabel')}">
${rows}
${confirmBar(lang)}
</ul>
<p class="visually-hidden" aria-live="polite" data-live></p>`;
    how = html`<p class="hint" data-how-form>${t(lang, 'admin.arrange.howForm')}</p>
<p class="hint" data-how-script hidden>${t(lang, 'admin.arrange.howScript')}</p>`;
  }
  const body = html`${backLink(`/admin/groups/${group.id}`, group.name)}
<h1>${title}</h1>
${errorNotice(lang, error)}
${done}
<p>${t(lang, 'admin.arrange.intro')}</p>
${how}
${list}`;
  return { title, body, scripts: canSwap ? ['arrange.js'] : [] };
}

const DONE_OK = new Set(['saved', 'wishes-saved', 'link-regenerated', 'invite-queued', 'remind-queued', 'failed-requeued']);
export const PERSON_DONE = new Set([...DONE_OK, 'nothing-to-remind', 'no-email', 'not-invited', 'mail-off', 'no-failure']);

function doneNotice(lang, done) {
  if (!done) return '';
  return html`<p class="notice ${DONE_OK.has(done) ? 'done' : 'warn'}" role="status">${t(lang, `admin.person.done.${done}`)}</p>`;
}

function personFacts(lang, { participant: p, group, receiver, tz }) {
  const lines = [
    t(lang, 'admin.person.group', { group: group.name }),
    p.email ? t(lang, 'admin.person.email', { email: p.email }) : t(lang, 'admin.noEmail'),
    p.drawnAt ? t(lang, 'admin.person.drawn', { date: shortDate(lang, p.drawnAt, tz) }) : t(lang, 'admin.person.notDrawn'),
    receiver ? t(lang, 'admin.person.givesTo', { name: receiver.name }) : t(lang, 'admin.status.unpaired'),
  ];
  return html`<ul class="facts">${lines.map((line) => html`<li>${line}</li>`)}</ul>`;
}

// Without script the field is still there to select and copy by hand;
// copy-link.js reveals the button.
function linkPanel(lang, { participant: p, link }) {
  return html`<section class="panel">
<h2>${t(lang, 'admin.person.link.title')}</h2>
<div class="copy-link" data-copy-link data-copied="${t(lang, 'admin.person.link.copied')}" data-failed="${t(lang, 'admin.person.link.copyFailed')}">
<label for="person-link">${t(lang, 'admin.person.link.label')}</label>
<p class="hint" id="person-link-hint">${t(lang, 'admin.person.link.hint', { name: p.name })}</p>
<div class="copy-row">
<input id="person-link" type="text" readonly value="${link}" spellcheck="false" autocomplete="off" aria-describedby="person-link-hint" data-copy-source>
<button type="button" data-copy hidden>${t(lang, 'admin.person.link.copy')}</button>
</div>
<p class="small" aria-live="polite" data-copy-status></p>
</div>
<div class="qr">
<img src="/admin/participants/${p.id}/qr" width="180" height="180" alt="${t(lang, 'admin.person.qr.alt', { name: p.name })}">
<p class="hint">${t(lang, 'admin.person.qr.hint')} <a href="/admin/participants/${p.id}/qr">${t(lang, 'admin.person.qr.open')}</a></p>
</div>
<form method="post" action="/admin/participants/${p.id}/regenerate-link" class="stack">
<h3>${t(lang, 'admin.person.regenerate.title')}</h3>
<p class="hint">${t(lang, 'admin.person.regenerate.warning')}</p>
<label class="check"><input type="checkbox" name="confirm" value="1" required> <span>${t(lang, 'admin.person.regenerate.confirm')}</span></label>
<button type="submit">${t(lang, 'admin.person.regenerate.button')}</button>
</form>
</section>`;
}

function remindHint(lang, p, remindKind) {
  if (!remindKind) return t(lang, 'admin.person.mail.nothingToRemind');
  if (!p.invitedAt) return t(lang, 'admin.person.mail.notInvited');
  return t(lang, `admin.person.mail.remindHint.${remindKind}`);
}

function mailPanel(lang, { participant: p, mail, remindKind, mailEnabled, tz }) {
  let content;
  if (!p.email) content = html`<p class="muted">${t(lang, 'admin.person.mail.noEmail')}</p>`;
  else if (!mailEnabled) content = html`<p class="muted">${t(lang, 'admin.mailOff')}</p>`;
  else {
    const failure = mail.lastFailure;
    const remind = remindKind && p.invitedAt
      ? html`<form method="post" action="/admin/participants/${p.id}/remind" class="inline-form">
<button type="submit">${t(lang, 'admin.person.mail.remind')}</button>
</form>`
      : '';
    content = html`${failure ? html`<p>${t(lang, 'admin.person.mail.failure')} ${failureText(lang, failure, tz)}</p>` : ''}
<div class="button-row">
<form method="post" action="/admin/participants/${p.id}/resend-invite" class="inline-form">
<button type="submit">${t(lang, 'admin.person.mail.resendInvite')}</button>
</form>
${remind}
${failure && !failure.retrying ? resendFailedForm(lang, p.id) : ''}
</div>
<p class="hint">${remindHint(lang, p, remindKind)}</p>`;
  }
  return html`<section class="panel">
<h2>${t(lang, 'admin.person.mail.title')}</h2>
${content}
</section>`;
}

// duplicate: {email, groupName} when the entered address is already used
// elsewhere in the event; saving again with confirmDuplicate goes ahead.
function editPanel(lang, { participant: p, values, error, duplicate }) {
  const form = values ?? { name: p.name, email: p.email ?? '', language: p.language };
  return html`<section class="panel" id="edit">
<h2>${t(lang, 'admin.person.edit.title')}</h2>
${errorNotice(lang, error)}
${duplicate ? html`<p class="notice warn" role="alert">${t(lang, 'admin.paste.duplicate', { email: duplicate.email, group: duplicate.groupName })}</p>` : ''}
<form method="post" action="/admin/participants/${p.id}" class="stack">
<label for="person-name">${t(lang, 'admin.person.edit.name')}</label>
<input id="person-name" name="name" type="text" maxlength="100" required value="${form.name}">
<label for="person-email">${t(lang, 'admin.person.edit.email')}</label>
<p class="hint" id="person-email-hint">${t(lang, 'admin.person.edit.emailHint')}</p>
<input id="person-email" name="email" type="email" maxlength="254" value="${form.email}" aria-describedby="person-email-hint">
<label for="person-language">${t(lang, 'admin.person.edit.language')}</label>
${languageSelect('person-language', form.language)}
${duplicate ? html`<input type="hidden" name="confirmDuplicate" value="1">` : ''}
<button type="submit" class="primary">${t(lang, duplicate ? 'admin.person.edit.saveAnyway' : 'admin.save')}</button>
</form>
</section>`;
}

function cardStatus(lang, p, cardOutOfDate, tz) {
  if (!p.printedAt) return t(lang, 'admin.card.notPrinted');
  const printed = t(lang, 'admin.behalf.printed', { date: shortDate(lang, p.printedAt, tz) });
  return cardOutOfDate ? html`${printed} <span class="state-failed">${t(lang, 'admin.card.outOfDate')}</span>` : printed;
}

// Everything the organiser does for someone in person: the participant's own
// screens shown on her device, and the printed card for those without one.
function behalfPanel(lang, { participant: p, group, receiver, cardOutOfDate, tz }) {
  const base = `/admin/participants/${p.id}`;
  const draw = group.openedAt && receiver
    ? html`<form method="post" action="${base}/draw" class="stack">
<button type="submit"${p.drawnAt ? '' : raw(' class="primary"')}>${t(lang, p.drawnAt ? 'admin.behalf.drawAgain' : 'admin.behalf.draw', { name: p.name })}</button>
</form>
${p.drawnAt ? '' : html`<p class="hint">${t(lang, 'admin.behalf.drawHint', { name: p.name })}</p>`}`
    : html`<p class="muted">${t(lang, 'admin.behalf.notOpen')}</p>`;
  const card = p.drawnAt
    ? html`<p><a href="${base}/card">${t(lang, 'admin.behalf.card')}</a></p>
<p class="small">${cardStatus(lang, p, cardOutOfDate, tz)}</p>`
    : html`<p class="muted">${t(lang, 'admin.behalf.cardAfterDraw')}</p>`;
  return html`<section class="panel behalf${p.email ? '' : ' emphasis'}" id="behalf">
<h2>${t(lang, 'admin.behalf.title', { name: p.name })}</h2>
<p class="hint">${t(lang, p.email ? 'admin.behalf.intro' : 'admin.behalf.introNoEmail', { name: p.name })}</p>
<h3>${t(lang, 'admin.behalf.wishesTitle')}</h3>
<p><a href="${base}/about">${t(lang, 'admin.behalf.about', { name: p.name })}</a></p>
<h3>${t(lang, 'admin.behalf.drawTitle')}</h3>
${draw}
<h3>${t(lang, 'admin.behalf.cardTitle')}</h3>
${card}
</section>`;
}

export function participantView(lang, {
  participant, group, receiver, mail, link, remindKind, mailEnabled, tz, cardOutOfDate = false,
  done = null, error = null, values = null, duplicate = null,
}) {
  const title = participant.name;
  const behalf = behalfPanel(lang, { participant, group, receiver, cardOutOfDate, tz });
  // Without email the organiser does everything herself, so it comes first.
  const first = participant.email ? '' : behalf;
  const later = participant.email ? behalf : '';
  const body = html`${backLink(`/admin/groups/${group.id}`, group.name)}
<h1>${title}</h1>
${doneNotice(lang, done)}
${personFacts(lang, { participant, group, receiver, tz })}
${first}
${linkPanel(lang, { participant, link })}
${mailPanel(lang, { participant, mail, remindKind, mailEnabled, tz })}
${later}
${editPanel(lang, { participant, values, error, duplicate })}
<section class="panel danger">
<h2>${t(lang, 'admin.person.remove.title')}</h2>
<p>${t(lang, 'admin.person.remove.intro', { name: participant.name })}</p>
<p><a class="button-link" href="/admin/participants/${participant.id}/remove">${t(lang, 'admin.person.remove.link')}</a></p>
</section>`;
  return { title, body, scripts: ['copy-link.js'] };
}

// plan: {version, map: [[giver, receiver]] | null, refused?}; changes as in
// changeList, only for an open group.
export function removeView(lang, { participant, group, plan, open, changes }) {
  const title = t(lang, 'admin.remove.title', { name: participant.name });
  const back = backLink(`/admin/participants/${participant.id}`, participant.name);
  if (plan.refused) {
    const body = html`${back}
<h1>${title}</h1>
<p class="notice warn">${t(lang, 'admin.remove.tooSmall')}</p>
<p><a href="/admin/groups/${group.id}">${group.name}</a></p>`;
    return { title, body };
  }
  let effect;
  if (open) {
    effect = html`<h2>${t(lang, 'admin.remove.openTitle')}</h2>
<p>${t(lang, 'admin.remove.openIntro')}</p>
${changeList(lang, changes)}`;
  } else {
    effect = html`<p>${t(lang, plan.map ? 'admin.remove.closedPairs' : 'admin.remove.closedNoPairs')}</p>`;
  }
  const body = html`${back}
<h1>${title}</h1>
<section class="panel danger">
<p>${t(lang, 'admin.remove.intro', { name: participant.name, group: group.name })}</p>
${effect}
<form method="post" action="/admin/participants/${participant.id}/remove" class="button-row">
<input type="hidden" name="group" value="${group.id}">
<input type="hidden" name="plan" value="${JSON.stringify({ version: plan.version, map: plan.map })}">
<button type="submit" class="danger">${t(lang, 'admin.remove.confirm', { name: participant.name })}</button>
<a href="/admin/participants/${participant.id}">${t(lang, 'admin.remove.cancel')}</a>
</form>
</section>`;
  return { title, body };
}

// The organiser's controls above the card, in her language; print.css hides
// them on paper.
export function cardTools(lang, { participant, cardOutOfDate }) {
  const base = `/admin/participants/${participant.id}`;
  const note = participant.printedAt && cardOutOfDate
    ? html`<p class="card-note">${t(lang, 'admin.card.changed')}</p>`
    : '';
  return html`<div class="card-tools" lang="${lang}">
<p><a href="${base}">${t(lang, 'admin.behalf.back', { name: participant.name })}</a></p>
${note}
<form method="post" action="${base}/card/printed">
<button type="submit">${t(lang, 'admin.card.print')}</button>
</form>
<p class="card-hint">${t(lang, 'admin.card.printHint')}</p>
</div>`;
}
