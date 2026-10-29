import { html, raw } from '../html.js';
import { iconText } from '../icons.js';
import { exchangeWhen, formatDate, LANGS, t } from '../i18n/index.js';
import { NAME_MAX, PLACE_MAX, THEME_MAX } from '../limits.js';
import { PASTE_TEXT_MAX } from '../people.js';
import { newFormToken } from '../submit-log.js';

const LOCALES = { nl: 'nl-NL', en: 'en-GB' };
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

// Forms that create or remove something carry a one-time token, so a
// repeated post of the same form leads to the first one's result.
export function formToken() {
  return html`<input type="hidden" name="formToken" value="${newFormToken()}" autocomplete="off">`;
}

export function backLink(href, label) {
  return html`<p class="back"><a href="${href}">${label}</a></p>`;
}

export function eventsView(lang, events, { error = null, values = {} } = {}) {
  const title = t(lang, 'admin.events.title');
  const list = events.length
    ? html`<ul class="link-list">${events.map((event) => html`<li><a href="/admin/events/${event.id}">${event.name}</a></li>`)}</ul>`
    : html`<p class="muted">${t(lang, 'admin.events.empty')}</p>`;
  const body = html`<h1>${title}</h1>
${list}
<p><a class="with-icon" href="/admin/events/import">${iconText('file-up', t(lang, 'admin.events.import'))}</a></p>
<section class="panel">
<h2>${t(lang, 'admin.events.new')}</h2>
${errorNotice(lang, error)}
<form method="post" action="/admin/events" class="stack">
${formToken()}
<label for="event-name">${t(lang, 'admin.event.name')}</label>
<input id="event-name" name="name" type="text" maxlength="${NAME_MAX}" required value="${values.name ?? ''}">
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

// With email off there is no invitation mail, so the hints name what the
// organiser does instead.
function groupFields(lang, prefix, values, mailEnabled) {
  const hint = (key) => t(lang, mailEnabled ? key : `${key}NoMail`);
  return html`<label for="${prefix}-name">${t(lang, 'admin.group.name')}</label>
<input id="${prefix}-name" name="name" type="text" maxlength="${NAME_MAX}" required value="${values.name ?? ''}">
${dateInput(`${prefix}-exchange`, 'exchangeDate', t(lang, 'admin.group.exchangeDate'), values.exchangeDate, { required: true })}
<label for="${prefix}-time">${t(lang, 'admin.group.exchangeTime')}</label>
<input id="${prefix}-time" name="exchangeTime" type="time" value="${values.exchangeTime ?? ''}">
<label for="${prefix}-place">${t(lang, 'admin.group.exchangePlace')}</label>
<p class="hint" id="${prefix}-place-hint">${hint('admin.group.exchangePlaceHint')}</p>
<input id="${prefix}-place" name="exchangePlace" type="text" maxlength="${PLACE_MAX}" value="${values.exchangePlace ?? ''}" aria-describedby="${prefix}-place-hint">
${dateInput(`${prefix}-auto`, 'autoOpenAt', t(lang, 'admin.group.autoOpenAt'), values.autoOpenAt, { hint: hint('admin.group.autoOpenHint') })}`;
}

export function deleteForm(lang, action, { label, warning }) {
  return html`<section class="panel danger">
<h2>${label}</h2>
<form method="post" action="${action}" class="stack">
${formToken()}
<p>${warning}</p>
<label class="check"><input type="checkbox" name="confirm" value="1" required> <span>${t(lang, 'admin.delete.confirm')}</span></label>
<button type="submit" class="danger with-icon">${iconText('trash-2', label)}</button>
</form>
</section>`;
}

// formPanel is the question list, which shows its own done notices next
// to the list they are about.
// The sign-up step of the whole event. Each state shows where it stands and
// only the steps that are possible from there.
function signupPanel(lang, { event, groups, state, tz, mailEnabled, error, value }) {
  const action = `/admin/events/${event.id}/signup`;
  const date = event.signupDeadline ? formatDate(lang, event.signupDeadline, tz) : null;
  const deadlineForm = (labelKey, buttonKey, fieldValue, primary) => html`<form method="post" action="${action}" class="stack">
${dateInput('signup-deadline', 'deadline', t(lang, labelKey), fieldValue, { required: true })}
<button type="submit"${primary ? raw(' class="primary"') : ''}>${t(lang, buttonKey)}</button>
</form>`;
  const stepForm = (path, buttonKey, hintKey) => html`<form method="post" action="${action}/${path}" class="stack">
<p class="hint">${t(lang, hintKey)}</p>
<button type="submit">${t(lang, buttonKey)}</button>
</form>`;
  let steps;
  if (state === 'off') {
    const tooLate = groups.some(({ group }) => group.invitationsSentAt || group.openedAt);
    steps = html`<p>${t(lang, 'admin.signup.intro')}</p>
${tooLate ? html`<p class="muted">${t(lang, 'admin.signup.tooLate')}</p>` : deadlineForm('admin.signup.deadline', 'admin.signup.on', value, true)}`;
  } else if (state === 'setup') {
    steps = html`<p>${t(lang, 'admin.signup.setup', { date })}</p>
<form method="post" action="${action}/send" class="stack">
${formToken()}
<p class="hint">${t(lang, mailEnabled ? 'admin.signup.sendHint' : 'admin.signup.sendHintNoMail')}</p>
<button type="submit" class="primary with-icon">${iconText('send', t(lang, 'admin.signup.send'))}</button>
</form>
${deadlineForm('admin.signup.newDeadline', 'admin.signup.move', value || event.signupDeadline, false)}
${stepForm('off', 'admin.signup.off', 'admin.signup.offHint')}`;
  } else if (state === 'open') {
    steps = html`<p>${t(lang, 'admin.signup.open', { date })}</p>
${deadlineForm('admin.signup.newDeadline', 'admin.signup.move', value || event.signupDeadline, false)}
${stepForm('close', 'admin.signup.close', 'admin.signup.closeHint')}`;
  } else if (state === 'closed') {
    steps = html`<p>${t(lang, 'admin.signup.closed')}</p>
${deadlineForm('admin.signup.newDeadline', 'admin.signup.reopen', value, false)}`;
  } else {
    steps = html`<p>${t(lang, 'admin.signup.done')}</p>`;
  }
  return html`<section class="panel" id="signup">
<h2>${t(lang, 'admin.signup.title')}</h2>
${errorNotice(lang, error)}
${steps}
</section>`;
}

export function eventView(lang, {
  event, groups, newGroup, themeValue, formPanel, tz, mailEnabled, signupState = 'off', error = null, groupError = null,
  signupError = null, signupValue = '', done = null,
}) {
  const title = event.name;
  const groupList = groups.length
    ? html`<ul class="group-list">${groups.map(({ group, size }) => html`<li>
<a href="/admin/groups/${group.id}">${group.name}</a>
<span class="muted">${t(lang, 'admin.group.summaryLine', { count: size, when: exchangeWhen(lang, group, tz) })}</span>
<span class="badge${group.openedAt ? ' on' : ''}">${t(lang, group.openedAt ? 'admin.group.isOpen' : 'admin.group.notOpen')}</span>
</li>`)}</ul>`
    : html`<p class="muted">${t(lang, 'admin.groups.empty')}</p>`;
  const body = html`${backLink('/admin', t(lang, 'admin.events.back'))}
<h1>${title}</h1>
${QUESTION_DONE.has(done) ? '' : doneNotice(lang, done)}
<section class="panel">
<h2>${t(lang, 'admin.groups.title')}</h2>
${groupList}
</section>
${signupPanel(lang, { event, groups, state: signupState, tz, mailEnabled, error: signupError, value: signupValue })}
<section class="panel">
<h2>${t(lang, 'admin.groups.new')}</h2>
${errorNotice(lang, groupError)}
<form method="post" action="/admin/events/${event.id}/groups" class="stack">
${formToken()}
${groupFields(lang, 'new-group', newGroup, mailEnabled)}
<button type="submit" class="primary">${t(lang, 'admin.groups.create')}</button>
</form>
</section>
<section class="panel">
<h2>${t(lang, 'admin.event.settings')}</h2>
${errorNotice(lang, error)}
<form method="post" action="/admin/events/${event.id}" class="stack">
<label for="event-name">${t(lang, 'admin.event.name')}</label>
<input id="event-name" name="name" type="text" maxlength="${NAME_MAX}" required value="${event.name}">
<label for="event-language">${t(lang, 'admin.event.language')}</label>
${languageSelect('event-language', event.language)}
<label for="event-cleanup">${t(lang, 'admin.event.cleanupWeeks')}</label>
<p class="hint" id="event-cleanup-hint">${t(lang, 'admin.event.cleanupHint')}</p>
<input id="event-cleanup" name="cleanupWeeks" type="number" min="1" max="52" required value="${event.cleanupWeeks}" aria-describedby="event-cleanup-hint">
<label for="event-theme">${t(lang, 'admin.event.theme')}</label>
<p class="hint" id="event-theme-hint">${t(lang, 'admin.event.themeHint')}</p>
<textarea id="event-theme" name="themeText" rows="7" maxlength="${THEME_MAX}" aria-describedby="event-theme-hint">${themeValue}</textarea>
<button type="submit" class="primary">${t(lang, 'admin.save')}</button>
</form>
</section>
${formPanel}
<section class="panel">
<h2>${t(lang, 'admin.event.export')}</h2>
<p>${t(lang, 'admin.event.exportHint')}</p>
<p><a class="button-link with-icon" href="/admin/events/${event.id}/export" download>${iconText('download', t(lang, 'admin.event.export'))}</a></p>
</section>
${deleteForm(lang, `/admin/events/${event.id}/delete`, { label: t(lang, 'admin.event.delete'), warning: t(lang, 'admin.event.deleteWarning') })}`;
  return { title, body };
}

// The icon repeats the status at a glance; the words stay for reading and
// for screen readers.
const STATUS_ICONS = { done: 'check', waiting: 'hourglass', failed: 'x', warn: 'triangle-alert', none: 'minus' };

function status(kind, content, className = '') {
  return html`<span class="status with-icon${className ? ` ${className}` : ''}">${iconText(STATUS_ICONS[kind], content)}</span>`;
}

const INVITE_STATES = { queued: 'waiting', sent: 'done', retrying: 'warn', failed: 'failed' };

// Only shown with email on; without an address there is nothing to send.
function inviteCell(lang, row) {
  if (!row.participant.email) return status('none', t(lang, 'admin.status.notApplicable'), 'muted');
  const state = row.mail.invite;
  if (state) return status(INVITE_STATES[state], t(lang, `admin.invite.${state}`), `state-${state}`);
  if (row.participant.invitedAt) return status('done', t(lang, 'admin.status.yes'));
  return status('waiting', t(lang, 'admin.status.notYet'), 'muted');
}

function dateOrNo(lang, iso, tz, { noKey = 'admin.status.no', noKind = 'waiting' } = {}) {
  return iso ? status('done', shortDate(lang, iso, tz)) : status(noKind, t(lang, noKey), 'muted');
}

// Codes from the mail library and the network, grouped by what the
// organiser can make of them; anything else gets the general reason.
const FAILURE_REASONS = {
  ECONNECTION: 'unreachable', ECONNREFUSED: 'unreachable', ECONNRESET: 'unreachable', ESOCKET: 'unreachable',
  EDNS: 'unreachable', ENOTFOUND: 'unreachable', ETIMEDOUT: 'timeout', EAUTH: 'login', ETLS: 'secure',
};

// code: as errorCode stores it, e.g. ECONNECTION, EENVELOPE-550-FROM, smtp-421.
function failureReason(code) {
  const [, base, reply, from] = /^(.+?)(?:-([2-5]\d\d))?(-FROM)?$/.exec(code ?? '') ?? [];
  if (Object.hasOwn(FAILURE_REASONS, base)) return FAILURE_REASONS[base];
  if (reply?.startsWith('4')) return 'busy';
  if (from) return 'sender';
  // 550, 551 and 553 are about the mailbox or the address itself.
  if (base === 'EENVELOPE' || ['550', '551', '553'].includes(reply)) return 'address';
  if (base === 'EMESSAGE' || reply?.startsWith('5')) return 'refused';
  return 'other';
}

// The code stays beside the reason, small, for whoever runs the mail server.
function failureText(lang, failure, tz) {
  const kind = t(lang, `admin.mailKind.${failure.kind}`);
  const reason = t(lang, `admin.failure.reason.${failureReason(failure.errorCode)}`);
  const state = failure.retrying ? t(lang, 'admin.failure.retrying') : t(lang, 'admin.failure.gaveUp', { date: shortDate(lang, failure.at, tz) });
  return status(failure.retrying ? 'warn' : 'failed',
    html`<span class="state-failed">${kind}:</span> ${reason} <span class="small"><code>${failure.errorCode}</code> ${state}</span>`);
}

// A mail still being retried goes out by itself; only one given up on can be
// sent again by hand.
function resendFailedForm(lang, participantId, { back = null } = {}) {
  return html`<form method="post" action="/admin/participants/${participantId}/resend-failed" class="inline-form">
${back ? html`<input type="hidden" name="back" value="${back}">` : ''}
<button type="submit" class="with-icon">${iconText('rotate-ccw', t(lang, 'admin.failure.resend'))}</button>
</form>`;
}

// Only shown with email on, so a given-up mail can always be sent again.
function failureCell(lang, failure, tz, participantId) {
  if (!failure) return status('none', t(lang, 'admin.status.none'), 'muted');
  const resend = failure.retrying ? '' : resendFailedForm(lang, participantId, { back: 'group' });
  return html`${failureText(lang, failure, tz)}${resend}`;
}

function cardCell(lang, row) {
  if (!row.participant.printedAt) return status('none', t(lang, 'admin.card.notPrinted'), 'muted');
  if (row.cardOutOfDate) {
    return html`<a class="status with-icon state-failed" href="/admin/participants/${row.participant.id}/card">${iconText('triangle-alert', t(lang, 'admin.card.outOfDate'))}</a>`;
  }
  return status('done', t(lang, 'admin.card.current'));
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
${cell('email', p.email ? emailText(p.email) : status('none', t(lang, 'admin.noEmail'), 'muted'))}
${mailEnabled ? cell('invited', inviteCell(lang, row)) : ''}
${cell('visited', dateOrNo(lang, p.visitedAt, tz), mailEnabled ? `${label('visited')} ${label('visitedNote')}` : label('visited'))}
${cell('wishes', row.hasWishes ? status('done', t(lang, 'admin.status.yes')) : status('waiting', t(lang, 'admin.status.no'), 'muted'))}
${cell('drawn', dateOrNo(lang, p.drawnAt, tz))}
${cell('givesTo', receiver ? receiver.name : html`<span class="muted">${t(lang, 'admin.status.unpaired')}</span>`)}
${mailEnabled ? cell('reminder', dateOrNo(lang, row.mail.lastReminderAt, tz, { noKey: 'admin.status.none', noKind: 'none' })) : ''}
${mailEnabled ? cell('failure', failureCell(lang, row.mail.lastFailure, tz, p.id)) : ''}
${cell('card', cardCell(lang, row))}
</tr>`;
}

function participantTable(lang, rows, tz, mailEnabled) {
  if (rows.length === 0) return html`<p class="muted">${t(lang, 'admin.participants.empty')}</p>`;
  const heading = (key) => html`<th scope="col">${t(lang, `admin.col.${key}`)}</th>`;
  return html`<p class="hint">${t(lang, mailEnabled ? 'admin.participants.hint' : 'admin.participants.hintNoMail')}</p>
<div class="table-wrap">
<table class="people">
<thead><tr>
${heading('name')}${heading('email')}${mailEnabled ? heading('invited') : ''}
<th scope="col">${t(lang, 'admin.col.visited')}${mailEnabled ? html` <span class="small">${t(lang, 'admin.col.visitedNote')}</span>` : ''}</th>
${heading('wishes')}${heading('drawn')}${heading('givesTo')}${mailEnabled ? html`${heading('reminder')}${heading('failure')}` : ''}${heading('card')}
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
      count: withEmail.filter((r) => r.mail.invite === 'sent').length, total: withEmail.length,
    }));
  }
  return html`<ul class="summary">${items.map((item) => html`<li>${item}</li>`)}</ul>`;
}

function groupStatus(lang, group, tz, mailEnabled) {
  const lines = [];
  lines.push(group.invitationsSentAt
    ? t(lang, mailEnabled ? 'admin.group.invitationsSent' : 'admin.group.linksShared', { date: shortDate(lang, group.invitationsSentAt, tz) })
    : t(lang, mailEnabled ? 'admin.group.invitationsNotSent' : 'admin.group.linksNotShared'));
  if (group.openedAt) lines.push(t(lang, 'admin.group.openSince', { date: shortDate(lang, group.openedAt, tz) }));
  else if (group.autoOpenAt) lines.push(t(lang, 'admin.group.opensOn', { date: formatDate(lang, group.autoOpenAt, tz) }));
  else lines.push(t(lang, 'admin.group.notOpenYet'));
  const when = exchangeWhen(lang, group, tz);
  lines.push(group.exchangePlace
    ? t(lang, 'admin.group.exchangeOnAt', { when, place: group.exchangePlace })
    : t(lang, 'admin.group.exchangeOn', { when }));
  return html`<ul class="facts">${lines.map((line) => html`<li>${line}</li>`)}</ul>`;
}

// With email off the button only records that the organiser shared the
// links; once pressed there is nothing left to do here.
function invitePanelBody(lang, { group, mailEnabled, uninvited, withEmail }) {
  if (!mailEnabled && group.invitationsSentAt) return html`<p>${t(lang, 'admin.invite.sharedNoMail')}</p>`;
  // The button stays until it was pressed once, even with nobody to mail:
  // the draw opens only after that.
  if (mailEnabled && group.invitationsSentAt && uninvited === 0) {
    return html`<p>${t(lang, withEmail ? 'admin.invite.allInvited' : 'admin.invite.nobodyEmail')}</p>`;
  }
  return html`<p>${mailEnabled ? t(lang, 'admin.invite.pending', { count: uninvited }) : t(lang, 'admin.invite.mailOff')}</p>
<form method="post" action="/admin/groups/${group.id}/invite">
<button type="submit" class="primary with-icon">${iconText('send', t(lang, mailEnabled ? 'admin.invite.button' : 'admin.invite.buttonNoMail'))}</button>
</form>`;
}

// With email off the invitation button is labelled after sharing the links,
// so the hint has to name that button instead.
function openErrorKey(error, mailEnabled) {
  return error === 'no-invitations' && !mailEnabled ? 'admin.open.error.no-invitations-nomail' : `admin.open.error.${error}`;
}

function drawPanel(lang, { group, rows, openError, mailEnabled }) {
  const arrange = rows.some((r) => r.receiver)
    ? html`<p><a class="with-icon" href="/admin/groups/${group.id}/arrange">${iconText('arrow-left-right', t(lang, 'admin.draw.arrange'))}</a></p>`
    : '';
  const open = group.openedAt
    ? html`<p>${t(lang, 'admin.draw.isOpen')}</p>`
    : html`<p>${t(lang, mailEnabled ? 'admin.draw.openIntro' : 'admin.draw.openIntroNoMail')}</p>
${!group.invitationsSentAt && openError !== 'no-invitations' ? html`<p class="hint">${t(lang, openErrorKey('no-invitations', mailEnabled))}</p>` : ''}
<form method="post" action="/admin/groups/${group.id}/open">
<button type="submit" class="primary with-icon">${iconText('door-open', t(lang, 'admin.draw.openButton'))}</button>
</form>`;
  return html`<section class="panel" id="draw">
<h2>${t(lang, 'admin.draw.title')}</h2>
${openError ? html`<p class="notice error" role="alert">${t(lang, openErrorKey(openError, mailEnabled))}</p>` : ''}
${open}
${arrange}
</section>`;
}

// Outcomes reported on the dashboard: mail buttons posted with back=group,
// and the changes that redirect there.
export const GROUP_DONE = new Set([
  'failed-requeued', 'all-requeued', 'no-failure', 'mail-off', 'already-queued', 'added', 'removed', 'opened',
  'group-created',
]);
export const QUESTION_DONE = new Set(['question-added', 'question-saved', 'question-removed']);
export const EVENT_DONE = new Set([
  'event-created', 'saved', 'imported', 'already-imported', 'signup-on', 'signup-off', 'signup-moved', 'signup-sent',
  'signup-closed', 'signup-reopened', ...QUESTION_DONE,
]);

// Mail still being retried goes out by itself, so only given-up mail counts.
function resendAllPanel(lang, groupId, count, mailEnabled) {
  if (!count || !mailEnabled) return '';
  return html`<div class="notice warn resend-all">
<p>${t(lang, 'admin.failure.groupCount', { count })}</p>
<form method="post" action="/admin/groups/${groupId}/resend-failed">
<button type="submit" class="with-icon">${iconText('rotate-ccw', t(lang, 'admin.failure.resendAll'))}</button>
</form>
</div>`;
}

// Inviting and drawing wait until the event's sign-up is done, so the
// dashboard sends the organiser there instead.
function signupLine(lang, event) {
  return html`<p class="notice">${t(lang, 'admin.signup.groupLine')} <a href="/admin/events/${event.id}#signup">${t(lang, 'admin.signup.groupLink')}</a></p>`;
}

export function groupView(lang, {
  event, group, rows, warnings, mailEnabled, tz, error = null, values = null, pasteError = null, pasteText = '',
  openError = null, done = null, givenUpCount = 0, signupActive = false,
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
${groupStatus(lang, group, tz, mailEnabled)}
${signupActive ? signupLine(lang, event) : html`<section class="panel">
<h2>${t(lang, 'admin.invite.title')}</h2>
${invitePanelBody(lang, { group, mailEnabled, uninvited, withEmail: rows.some((r) => r.participant.email) })}
</section>
${drawPanel(lang, { group, rows, openError, mailEnabled })}`}
<section class="panel wide">
<h2>${t(lang, 'admin.participants.title')}</h2>
${resendAllPanel(lang, group.id, givenUpCount, mailEnabled)}
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
${groupFields(lang, 'group', form, mailEnabled)}
<button type="submit" class="primary">${t(lang, 'admin.save')}</button>
</form>
</section>
${deleteForm(lang, `/admin/groups/${group.id}/delete`, { label: t(lang, 'admin.group.delete'), warning: t(lang, 'admin.group.deleteWarning') })}`;
  return { title, body };
}

function pasteForm(lang, groupId, text) {
  return html`<form method="post" action="/admin/groups/${groupId}/participants" class="stack">
${formToken()}
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
// receiver changes in an open group. With mail off nobody is mailed, so the
// organiser is told whom to tell herself.
function changeList(lang, changes, mailEnabled) {
  const note = (c) => {
    if (!c.drawn) return '';
    if (!mailEnabled) return t(lang, 'admin.paste.changeTell', { giver: c.giverName });
    return c.hasEmail ? t(lang, 'admin.paste.changeMailed') : t(lang, 'admin.paste.changeReprint');
  };
  return html`<ul>${changes.map((c) => html`<li>${t(lang, 'admin.paste.change', { giver: c.giverName, receiver: c.newReceiverName })} ${note(c)}</li>`)}</ul>`;
}

export function pasteConfirmView(lang, { group, plan, errors, changes, text, mailEnabled }) {
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
<p>${t(lang, mailEnabled ? 'admin.paste.openIntro' : 'admin.paste.openIntroNoMail')}</p>
${changeList(lang, changes, mailEnabled)}
</section>`
    : '';
  const confirm = plan.rows.length
    ? html`<section class="panel">
<h2>${t(lang, 'admin.paste.toAdd', { count: plan.rows.length })}</h2>
<ul>${plan.rows.map((row) => html`<li>${personLabel(lang, row)}</li>`)}</ul>
<form method="post" action="/admin/groups/${group.id}/participants">
<input type="hidden" name="confirm" value="1">
${formToken()}
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

function pairRow(lang, { pair, others, groupId, version, swapped, canSwap }) {
  const { giver, receiver, locked } = pair;
  const classes = ['pair', locked ? 'is-locked' : '', swapped ? 'is-swapped' : ''].filter(Boolean).join(' ');
  let action = '';
  if (locked) action = html`<p class="lock with-icon">${iconText('lock', t(lang, 'admin.arrange.locked'))}</p>`;
  else if (canSwap) {
    action = html`<form method="post" action="/admin/groups/${groupId}/swap" class="pair-swap">
<input type="hidden" name="a" value="${giver.id}">
<input type="hidden" name="version" value="${version}">
<label for="swap-${giver.id}">${t(lang, 'admin.arrange.swapWith')}</label>
<select id="swap-${giver.id}" name="b" required>
<option value="">${t(lang, 'admin.arrange.choose')}</option>
${others.filter((o) => o.giver.id !== giver.id).map((o) => html`<option value="${o.giver.id}">${t(lang, 'admin.arrange.option', { giver: o.giver.name, receiver: o.receiver.name })}</option>`)}
</select>
<button type="submit" class="with-icon">${iconText('arrow-left-right', t(lang, 'admin.arrange.swap'))}</button>
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
<button type="button" class="primary with-icon" data-swap>${iconText('arrow-left-right', t(lang, 'admin.arrange.swap'))}</button>
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
    list = html`<ul class="pairs" data-arrange data-arrange-url="/admin/groups/${group.id}/arrange" data-pick="${t(lang, 'admin.arrange.pick')}" data-pick-label="${t(lang, 'admin.arrange.pickLabel')}">
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

const DONE_OK = new Set([
  'saved', 'wishes-saved', 'link-regenerated', 'invite-queued', 'remind-queued', 'failed-requeued', 'all-requeued',
]);
// Done, but with something left for the organiser to do.
const DONE_WARN = new Set([
  'nothing-to-remind', 'no-email', 'not-invited', 'mail-off', 'no-failure', 'already-queued', 'added-tell', 'removed-tell',
  'already-imported',
]);
export const PERSON_DONE = new Set([
  ...DONE_OK, 'nothing-to-remind', 'no-email', 'not-invited', 'mail-off', 'no-failure', 'already-queued',
]);

export function doneNotice(lang, done) {
  if (!done) return '';
  return html`<p class="notice ${DONE_WARN.has(done) ? 'warn' : 'done'}" role="status">${t(lang, `admin.person.done.${done}`)}</p>`;
}

// The organiser draws for someone from this page with that person beside
// her, so the receiver is never on screen before the draw, and after it
// only when she asks for it.
function pairingFact(lang, p, receiver) {
  if (!receiver) return t(lang, 'admin.status.unpaired');
  if (!p.drawnAt) return t(lang, 'admin.person.paired');
  return html`<details class="receiver"><summary>${t(lang, 'admin.person.showReceiver', { name: p.name })}</summary>
<p>${t(lang, 'admin.person.givesTo', { name: receiver.name })}</p></details>`;
}

function personFacts(lang, { participant: p, group, receiver, tz }) {
  const lines = [
    t(lang, 'admin.person.group', { group: group.name }),
    p.email ? t(lang, 'admin.person.email', { email: p.email }) : t(lang, 'admin.noEmail'),
    p.drawnAt ? t(lang, 'admin.person.drawn', { date: shortDate(lang, p.drawnAt, tz) }) : t(lang, 'admin.person.notDrawn'),
    pairingFact(lang, p, receiver),
  ];
  return html`<ul class="facts">${lines.map((line) => html`<li>${line}</li>`)}</ul>`;
}

// Without script the field is still there to select and copy by hand;
// copy-link.js reveals the button.
function linkPanel(lang, { participant: p, link, mailEnabled }) {
  return html`<section class="panel">
<h2>${t(lang, 'admin.person.link.title')}</h2>
<div class="copy-link" data-copy-link data-copied="${t(lang, 'admin.person.link.copied')}" data-failed="${t(lang, 'admin.person.link.copyFailed')}">
<label for="person-link">${t(lang, 'admin.person.link.label')}</label>
<p class="hint" id="person-link-hint">${t(lang, 'admin.person.link.hint', { name: p.name })}</p>
<div class="copy-row">
<input id="person-link" type="text" readonly value="${link}" spellcheck="false" autocomplete="off" aria-describedby="person-link-hint" data-copy-source>
<button type="button" class="with-icon" data-copy hidden>${iconText('copy', t(lang, 'admin.person.link.copy'))}</button>
</div>
<p class="small" aria-live="polite" data-copy-status></p>
</div>
<div class="qr">
<img src="/admin/participants/${p.id}/qr" width="180" height="180" alt="${t(lang, 'admin.person.qr.alt', { name: p.name })}">
<p class="hint">${t(lang, 'admin.person.qr.hint')} <a class="with-icon" href="/admin/participants/${p.id}/qr">${iconText('qr-code', t(lang, 'admin.person.qr.open'))}</a></p>
</div>
<form method="post" action="/admin/participants/${p.id}/regenerate-link" class="stack">
<h3>${t(lang, 'admin.person.regenerate.title')}</h3>
<p class="hint">${t(lang, mailEnabled ? 'admin.person.regenerate.warning' : 'admin.person.regenerate.warningNoMail')}</p>
<label class="check"><input type="checkbox" name="confirm" value="1" required> <span>${t(lang, 'admin.person.regenerate.confirm')}</span></label>
<button type="submit" class="with-icon">${iconText('refresh-cw', t(lang, 'admin.person.regenerate.button'))}</button>
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
<button type="submit" class="with-icon">${iconText('bell', t(lang, 'admin.person.mail.remind'))}</button>
</form>`
      : '';
    content = html`${failure ? html`<p>${t(lang, 'admin.person.mail.failure')} ${failureText(lang, failure, tz)}</p>` : ''}
<div class="button-row">
<form method="post" action="/admin/participants/${p.id}/resend-invite" class="inline-form">
<button type="submit" class="with-icon">${iconText('mail', t(lang, 'admin.person.mail.resendInvite'))}</button>
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
function editPanel(lang, { participant: p, values, error, duplicate, mailEnabled }) {
  const form = values ?? { name: p.name, email: p.email ?? '', language: p.language };
  return html`<section class="panel" id="edit">
<h2>${t(lang, 'admin.person.edit.title')}</h2>
${errorNotice(lang, error)}
${duplicate ? html`<p class="notice warn" role="alert">${t(lang, 'admin.paste.duplicate', { email: duplicate.email, group: duplicate.groupName })}</p>` : ''}
<form method="post" action="/admin/participants/${p.id}" class="stack">
<label for="person-name">${t(lang, 'admin.person.edit.name')}</label>
<input id="person-name" name="name" type="text" maxlength="${NAME_MAX}" required value="${form.name}">
<label for="person-email">${t(lang, 'admin.person.edit.email')}</label>
<p class="hint" id="person-email-hint">${t(lang, mailEnabled ? 'admin.person.edit.emailHint' : 'admin.person.edit.emailHintNoMail')}</p>
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
<button type="submit" class="${p.drawnAt ? '' : 'primary '}with-icon">${iconText('gift', t(lang, p.drawnAt ? 'admin.behalf.drawAgain' : 'admin.behalf.draw', { name: p.name }))}</button>
</form>
${p.drawnAt ? '' : html`<p class="hint">${t(lang, 'admin.behalf.drawHint', { name: p.name })}</p>`}`
    : html`<p class="muted">${t(lang, 'admin.behalf.notOpen')}</p>`;
  const card = p.drawnAt
    ? html`<p><a class="with-icon" href="${base}/card">${iconText('printer', t(lang, 'admin.behalf.card'))}</a></p>
<p class="small">${cardStatus(lang, p, cardOutOfDate, tz)}</p>`
    : html`<p class="muted">${t(lang, 'admin.behalf.cardAfterDraw')}</p>`;
  return html`<section class="panel behalf${p.email ? '' : ' emphasis'}" id="behalf">
<h2>${t(lang, 'admin.behalf.title', { name: p.name })}</h2>
<p class="hint">${t(lang, p.email ? 'admin.behalf.intro' : 'admin.behalf.introNoEmail', { name: p.name })}</p>
<h3>${t(lang, 'admin.behalf.wishesTitle')}</h3>
<p><a class="with-icon" href="${base}/about">${iconText('pencil', t(lang, 'admin.behalf.about', { name: p.name }))}</a></p>
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
${linkPanel(lang, { participant, link, mailEnabled })}
${mailPanel(lang, { participant, mail, remindKind, mailEnabled, tz })}
${later}
${editPanel(lang, { participant, values, error, duplicate, mailEnabled })}
<section class="panel danger">
<h2>${t(lang, 'admin.person.remove.title')}</h2>
<p>${t(lang, 'admin.person.remove.intro', { name: participant.name })}</p>
<p><a class="button-link with-icon" href="/admin/participants/${participant.id}/remove">${iconText('trash-2', t(lang, 'admin.person.remove.link'))}</a></p>
</section>`;
  return { title, body, scripts: ['copy-link.js'] };
}

// plan: {version, map: [[giver, receiver]] | null, refused?}; changes as in
// changeList, only for an open group.
export function removeView(lang, { participant, group, plan, open, changes, mailEnabled }) {
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
${changeList(lang, changes, mailEnabled)}`;
  } else {
    effect = html`<p>${t(lang, plan.map ? 'admin.remove.closedPairs' : 'admin.remove.closedNoPairs')}</p>`;
  }
  const body = html`${back}
<h1>${title}</h1>
<section class="panel danger">
<p>${t(lang, mailEnabled ? 'admin.remove.intro' : 'admin.remove.introNoMail', { name: participant.name, group: group.name })}</p>
${effect}
<form method="post" action="/admin/participants/${participant.id}/remove" class="button-row">
<input type="hidden" name="group" value="${group.id}">
${formToken()}
<input type="hidden" name="plan" value="${JSON.stringify({ version: plan.version, map: plan.map })}">
<button type="submit" class="danger with-icon">${iconText('trash-2', t(lang, 'admin.remove.confirm', { name: participant.name }))}</button>
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
<button type="submit" class="with-icon">${iconText('printer', t(lang, 'admin.card.print'))}</button>
</form>
<p class="card-hint">${t(lang, 'admin.card.printHint')}</p>
</div>`;
}
