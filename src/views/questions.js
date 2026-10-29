import { html, raw } from '../html.js';
import { icon, iconText } from '../icons.js';
import { t } from '../i18n/index.js';
import { HEADING_MAX, QUESTION_MAX, QUESTIONS_MAX } from '../limits.js';
import { builtinChoiceLabel, detailPrompt, FOLLOW_UPS, isBuiltinQuestion, questionText } from '../questions.js';
import { backLink, deleteForm, doneNotice, formToken } from './admin.js';

const disabled = (on) => (on ? raw(' disabled') : '');
const counted = (lang, key, count, vars = {}) => t(lang, count === 1 ? `${key}One` : key, { count, ...vars });

export function kindText(lang, question) {
  if (question.type === 'text') return t(lang, 'admin.form.typeText');
  return counted(lang, 'admin.form.typeChoices', question.choices.length);
}

const questionUrl = (event, id) => `/admin/events/${event.id}/questions/${id}`;

function questionItem(lang, event, question, first, last) {
  const wording = questionText(question, lang);
  return html`<li class="question-item">
<p class="question-summary"><span class="question-text">${wording}</span>
<span class="muted">${kindText(lang, question)}</span>${question.show ? '' : html` <span class="badge">${t(lang, 'admin.form.hidden')}</span>`}</p>
<div class="question-actions">
<a class="button-link with-icon" href="${questionUrl(event, question.id)}">${icon('pencil')}<span>${t(lang, 'admin.form.edit')}<span class="visually-hidden">: ${wording}</span></span></a>
<form method="post" action="${questionUrl(event, question.id)}/move" class="inline-form move-buttons">
${formToken()}
<button type="submit" name="dir" value="up"${disabled(first)}>${icon('arrow-up', { label: t(lang, 'admin.form.up', { question: wording }) })}</button>
<button type="submit" name="dir" value="down"${disabled(last)}>${icon('arrow-down', { label: t(lang, 'admin.form.down', { question: wording }) })}</button>
</form>
</div>
</li>`;
}

// The question list on the event page. Each question opens on its own
// page; the arrows are plain form posts, so reordering works on a phone
// and without script.
export function formPanel(lang, { event, form, done = null }) {
  const { questions } = form;
  const items = questions.map((q, i) => questionItem(lang, event, q, i === 0, i === questions.length - 1));
  const add = questions.length >= QUESTIONS_MAX
    ? html`<p class="hint">${t(lang, 'admin.form.full', { max: QUESTIONS_MAX })}</p>`
    : html`<p class="button-row">
<a class="button-link with-icon" href="/admin/events/${event.id}/questions/new?type=text">${iconText('plus', t(lang, 'admin.form.addText'))}</a>
<a class="button-link with-icon" href="/admin/events/${event.id}/questions/new?type=choices">${iconText('plus', t(lang, 'admin.form.addChoices'))}</a>
</p>`;
  return html`<section class="panel" id="form">
<h2>${t(lang, 'admin.form.title')}</h2>
${doneNotice(lang, done)}
<p class="hint">${t(lang, 'admin.form.hint')}</p>
<ol class="question-list">${items}</ol>
${add}
</section>`;
}

function fieldError(lang, id, error) {
  if (!error) return '';
  return html`<p class="field-error" id="${id}-error">${t(lang, error.key, error.vars ?? {})}</p>`;
}

// aria-describedby and aria-invalid for a field with an optional hint and
// an optional error.
function described(id, { hint = false, error = null } = {}) {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  const by = ids.length ? raw(` aria-describedby="${ids.join(' ')}"`) : '';
  return html`${by}${error ? raw(' aria-invalid="true"') : ''}`;
}

function followOption(lang, value, row) {
  const label = value === 'general'
    ? t(lang, 'admin.question.followGeneral', { prompt: detailPrompt({ id: row.id, question: null }, lang) })
    : t(lang, value === 'own' ? 'admin.question.followOwn' : 'admin.question.followNone');
  return html`<option value="${value}"${row.follow === value ? raw(' selected') : ''}>${label}</option>`;
}

function rowButton(lang, action, iconName, textKey, labelKey, number, off = false) {
  return html`<button type="submit" name="action" value="${action}" formnovalidate class="with-icon" aria-label="${t(lang, labelKey, { number })}"${disabled(off)}>${iconText(iconName, t(lang, textKey))}</button>`;
}

// One choice as a stack of fields, so it reads top to bottom on a phone.
// The row buttons submit the whole draft; formnovalidate lets them through
// while a required field is still empty.
function choiceRow(lang, questionId, row, i, count, { label: error = null, question: questionError = null } = {}) {
  const id = `choice-${i}`;
  const number = i + 1;
  const builtIn = row.id ? builtinChoiceLabel(questionId, row.id, lang) : null;
  return html`<li class="choice-row">
<input type="hidden" name="choice_${i}_id" value="${row.id}">
<label for="${id}-label">${t(lang, 'admin.question.choice', { number })}</label>
${fieldError(lang, `${id}-label`, error)}
<input id="${id}-label" name="choice_${i}_label" type="text" maxlength="${HEADING_MAX}" value="${row.label}"${builtIn ? html` placeholder="${builtIn}"` : ''}${described(`${id}-label`, { error })}>
<label for="${id}-follow">${t(lang, 'admin.question.follow')}</label>
<select id="${id}-follow" name="choice_${i}_follow">${FOLLOW_UPS.map((value) => followOption(lang, value, row))}</select>
<label for="${id}-question">${t(lang, 'admin.question.ownQuestion')}</label>
${fieldError(lang, `${id}-question`, questionError)}
<input id="${id}-question" name="choice_${i}_question" type="text" maxlength="${QUESTION_MAX - 1}" value="${row.question}"${described(`${id}-question`, { error: questionError })}>
<div class="choice-actions">
${rowButton(lang, `up:${i}`, 'arrow-up', 'admin.question.up', 'admin.question.choiceUp', number, i === 0)}
${rowButton(lang, `down:${i}`, 'arrow-down', 'admin.question.down', 'admin.question.choiceDown', number, i === count - 1)}
${rowButton(lang, `remove:${i}`, 'x', 'admin.question.remove', 'admin.question.choiceRemove', number)}
</div>
</li>`;
}

function choicesBlock(lang, questionId, draft, errors) {
  const count = draft.choices.length;
  return html`<fieldset class="choices">
<legend>${t(lang, 'admin.question.choices')}</legend>
<p class="hint">${t(lang, 'admin.question.choicesHint')}</p>
${fieldError(lang, 'choices', errors.choices)}
<input type="hidden" name="choiceCount" value="${count}">
<ol class="choice-list">${draft.choices.map((row, i) => choiceRow(lang, questionId, row, i, count, errors[`choice_${i}`]))}</ol>
<button type="submit" name="action" value="add-choice" formnovalidate class="with-icon">${iconText('plus', t(lang, 'admin.question.addChoice'))}</button>
</fieldset>`;
}

// Removing ticked choices loses answers, so the save is held back until
// the organiser has read which choices and ticked the box. The page comes
// back scrolled to the top, where a confirmation at the foot of the form
// is missed and the page looks saved, so the block opens the form and
// carries its own save button.
function dropBlock(lang, drop) {
  if (!drop) return '';
  return html`<div class="notice warn drop-confirm" role="alert">
<p><strong>${t(lang, 'admin.question.dropNotSaved')}</strong> ${t(lang, 'admin.question.dropTitle')}</p>
<p>${counted(lang, 'admin.question.dropBody', drop.count, { choices: drop.names.join(', ') })}</p>
<label class="check"><input type="checkbox" name="confirmDrop" value="1" required> <span>${t(lang, 'admin.delete.confirm')}</span></label>
<button type="submit" name="action" value="save" class="primary">${t(lang, 'admin.question.dropSave')}</button>
</div>`;
}

function deletePanel(lang, event, question, { answered, canDelete }) {
  if (!canDelete) {
    return html`<section class="panel"><p>${t(lang, 'admin.question.deleteLast')}</p></section>`;
  }
  const warning = [t(lang, 'admin.question.deleteWarning')];
  if (answered > 0) warning.push(counted(lang, 'admin.question.deleteAnswers', answered));
  return deleteForm(lang, `${questionUrl(event, question.id)}/delete`, {
    label: t(lang, 'admin.question.delete'), warning: warning.join(' '),
  });
}

// One question's page. `question` is the stored question, or for a new one
// a stand-in without an id; `draft` holds the fields as last posted, so a
// row button or a refused save shows everything as the organiser left it.
export function questionView(lang, {
  event, question, draft, errors = {}, answered = 0, drop = null, canDelete = false,
}) {
  const isNew = !question.id;
  const action = questionUrl(event, isNew ? 'new' : question.id);
  const title = isNew ? t(lang, 'admin.question.newTitle') : questionText(question, lang);
  const builtIn = !isNew && isBuiltinQuestion(question.id);
  const hasErrors = Object.keys(errors).length > 0;
  const body = html`${backLink(`/admin/events/${event.id}#form`, event.name)}
<h1>${title}</h1>
<p class="muted">${t(lang, 'admin.question.kind', { kind: kindText(lang, { type: question.type, choices: draft.choices }) })}</p>
${!isNew && answered > 0 && !drop ? html`<p class="notice">${counted(lang, 'admin.question.answered', answered)}</p>` : ''}
${hasErrors ? html`<p class="notice error" role="alert">${t(lang, 'admin.question.notSaved')}</p>` : ''}
<form method="post" action="${action}" class="stack question-form">
<button type="submit" name="action" value="save" class="visually-hidden" tabindex="-1" aria-hidden="true">${t(lang, 'admin.save')}</button>
${formToken()}
${isNew ? html`<input type="hidden" name="type" value="${question.type}">` : ''}
${dropBlock(lang, drop)}
<label class="check"><input type="checkbox" id="question-show" name="show" value="1"${draft.show ? raw(' checked') : ''} aria-describedby="question-show-hint"> <span>${t(lang, 'admin.question.show')}</span></label>
<p class="hint" id="question-show-hint">${t(lang, 'admin.question.showHint')}</p>
<label for="question-text">${t(lang, 'admin.question.text')}</label>
${builtIn ? html`<p class="hint" id="question-text-hint">${t(lang, 'admin.question.textHint')}</p>` : ''}
${fieldError(lang, 'question-text', errors.text)}
<input id="question-text" name="text" type="text" maxlength="${HEADING_MAX}" value="${draft.text}"${builtIn ? html` placeholder="${t(lang, `wish.${question.id}`)}"` : raw(' required')}${described('question-text', { hint: builtIn, error: errors.text })}>
${question.type === 'choices' ? choicesBlock(lang, question.id, draft, errors) : ''}
<button type="submit" name="action" value="save" class="primary">${t(lang, 'admin.save')}</button>
</form>
${isNew ? '' : deletePanel(lang, event, question, { answered, canDelete })}`;
  return { title, body };
}
