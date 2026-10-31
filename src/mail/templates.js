import { wishLines } from '../answers.js';
import { html } from '../html.js';
import { exchangeLine, formatDate, t, themeText } from '../i18n/index.js';
import { endsInMark, wishForm } from '../questions.js';
import { daysLeft } from '../signup.js';

// Outbox kind -> catalogue key under email.*
const KEYS = {
  invite: 'invite',
  'draw-open': 'drawOpen',
  'remind-wishes': 'remindWishes',
  'remind-draw': 'remindDraw',
  'wishes-updated': 'wishesUpdated',
  reassigned: 'reassigned',
  signup: 'signup',
  'remind-signup': 'remindSignup',
  'signup-nudge': 'signupNudge',
};

export const KINDS = Object.keys(KEYS);

// Kinds that name the giver's receiver; they only go to givers who have
// already seen their result, so naming the receiver gives nothing away.
export const RECEIVER_KINDS = new Set(['wishes-updated', 'reassigned']);

// Kinds about the sign-up, which name the date it closes.
const DEADLINE_KINDS = new Set(['signup', 'remind-signup', 'signup-nudge']);

// Kinds that ask for an answer: a button for each, with ?a= putting the
// chosen answer first on the page. Opening the link records nothing; the
// answer is given on the page.
const ANSWER_KINDS = new Set(['signup', 'remind-signup']);

// Mail clients drop <style> blocks and external CSS, so every rule is inline.
// Colours match public/css/base.css.
const C = {
  paper: '#fffaf3',
  card: '#ffffff',
  ink: '#2b211b',
  muted: '#5c4a3d',
  accent: '#b23a1e',
  ribbon: '#2f6b4f',
  line: '#d9c7b4',
  theme: '#fff3d6',
};
const FONT = 'font-family:system-ui,-apple-system,\'Segoe UI\',Roboto,\'Helvetica Neue\',Arial,sans-serif;'
  // A long word, such as a shop link pasted into a wish or a name without
  // spaces, wraps instead of widening the mail past a phone screen.
  + 'overflow-wrap:anywhere;word-break:break-word;';
const TEXT = `${FONT}font-size:20px;line-height:1.5;color:${C.ink};`;

const colon = (label) => (endsInMark(label) ? label : `${label}:`);

function wishesBlock(lang, receiver, event) {
  const lines = wishLines(receiver.wishes, wishForm(event), lang);
  const title = t(lang, 'result.wishesTitle', { name: receiver.name });
  if (lines.length === 0) {
    const none = t(lang, 'result.noWishes', { name: receiver.name });
    return { html: html`<p style="${TEXT}margin:0 0 24px;">${none}</p>`, text: [none] };
  }
  return {
    html: html`<p style="${TEXT}margin:0 0 8px;font-weight:bold;">${title}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
        ${lines.map((line) => html`<tr><td style="${TEXT}padding:4px 0;">
          <strong>${colon(line.label)}</strong> ${line.value}</td></tr>`)}
      </table>`,
    text: [title, ...lines.map((line) => `- ${colon(line.label)} ${line.value}`)],
  };
}

function buttonHtml(href, label, primary) {
  const cell = primary ? `background-color:${C.accent};` : `background-color:${C.card};border:2px solid ${C.accent};`;
  const color = primary ? '#ffffff' : C.accent;
  return html`<tr><td align="center" style="${cell}border-radius:10px;">
      <a href="${href}" style="display:block;padding:18px 16px;${FONT}font-size:24px;font-weight:bold;line-height:1.3;color:${color};text-decoration:none;">${label}</a>
    </td></tr>`;
}

// now is the send time, which the days left in a sign-up reminder count from.
export function renderEmail(kind, { lang, participant, receiver, event, group, link, tz, now }) {
  if (!KEYS[kind]) throw new Error(`unknown email kind: ${kind}`);
  // Someone invited into a group that is already open gets no separate
  // draw-open mail, so their invitation says they can draw.
  const key = kind === 'invite' && group.openedAt ? 'inviteOpen' : KEYS[kind];
  const vars = { name: RECEIVER_KINDS.has(kind) ? receiver.name : participant.name, event: event.name };
  if (DEADLINE_KINDS.has(kind)) vars.deadline = formatDate(lang, event.signupDeadline, tz);
  if (kind === 'remind-signup') {
    if (!(now instanceof Date)) throw new Error('remind-signup needs the send time');
    vars.days = daysLeft(event.signupDeadline, now, tz);
  }
  // The catalogue has no plural forms, so one day left has its own subject;
  // on the closing day itself subject and body say it is the last day.
  const today = vars.days === 0 ? 'Today' : '';
  const subjectKey = vars.days === 1 ? 'subjectOne' : `subject${today}`;
  const appName = t(lang, 'app.name');
  const subject = `${appName}: ${t(lang, `email.${key}.${subjectKey}`, vars)}`;
  const greeting = t(lang, 'email.greeting', { name: participant.name });
  const body = t(lang, `email.${key}.body${today}`, vars);
  // The text part has no button, so its wording points at the link.
  const bodyText = t(lang, `email.${key}.bodyText${today}`, vars);
  const buttons = ANSWER_KINDS.has(kind)
    ? [
      { href: `${link}?a=yes`, label: t(lang, `email.${key}.button`) },
      { href: `${link}?a=no`, label: t(lang, `email.${key}.button2`) },
    ]
    : [{ href: link, label: t(lang, `email.${key}.button`) }];
  const theme = themeText(event, lang);
  const date = exchangeLine(lang, group, tz);
  const linkIntro = t(lang, 'email.linkIntro');
  const footer = t(lang, 'email.footer');
  const wishes = kind === 'wishes-updated' ? wishesBlock(lang, receiver, event) : null;

  const page = html`<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:${C.paper};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.paper};">
<tr><td align="center" style="padding:16px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:${C.card};border:1px solid ${C.line};border-radius:12px;">
<tr><td style="padding:24px 24px 8px;${FONT}font-size:22px;font-weight:bold;color:${C.ribbon};">${appName}</td></tr>
<tr><td style="padding:8px 24px 0;">
  <p style="${TEXT}margin:0 0 16px;font-size:24px;font-weight:bold;">${greeting}</p>
  <p style="${TEXT}margin:0 0 24px;">${body}</p>
  ${wishes?.html}
  ${buttons.map((b, i) => html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 ${i === buttons.length - 1 ? 28 : 16}px;">
    ${buttonHtml(b.href, b.label, i === 0)}
  </table>`)}
  <p style="${TEXT}margin:0 0 16px;font-weight:bold;">${date}</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr><td style="background-color:${C.theme};border-radius:10px;padding:16px 18px;${FONT}font-size:19px;line-height:1.5;color:${C.ink};">${theme}</td></tr>
  </table>
  <p style="${TEXT}margin:0 0 4px;font-size:18px;color:${C.muted};">${linkIntro}</p>
  <p style="${TEXT}margin:0 0 24px;font-size:18px;word-break:break-all;"><a href="${link}" style="color:${C.accent};">${link}</a></p>
  <p style="${TEXT}margin:0 0 24px;font-size:18px;color:${C.muted};">${footer}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    greeting,
    '',
    bodyText,
    '',
    ...(wishes ? [...wishes.text, ''] : []),
    // Each answer's link under its own label, as the buttons would show.
    ...(ANSWER_KINDS.has(kind)
      ? buttons.flatMap((b) => [colon(b.label), b.href, ''])
      : [t(lang, 'email.textLink'), link, '']),
    date,
    '',
    theme,
    '',
    footer,
    '',
  ].join('\n');

  return { subject, html: page.toString(), text };
}
