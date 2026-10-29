import { countAnswers } from '../answers.js';
import { CHOICES_MAX, HEADING_MAX, QUESTION_MAX, QUESTIONS_MAX } from '../limits.js';
import {
  cleanHeading, cleanQuestion, FOLLOW_UPS, formValue, isBuiltinChoice, isBuiltinLabel, isBuiltinQuestion, isBuiltinText,
  isOwnPrompt, newChoiceId, newQuestionId, sameForm, wishForm,
} from '../questions.js';
import { questionView } from '../views/questions.js';
import { adminLang } from './admin-auth.js';
import { field } from './admin-shared.js';

const TYPES = new Set(['text', 'choices']);
const ROW_ACTION = /^(up|down|remove):(\d{1,3})$/;
// Fields are read past their maxlength, so a clipped value is cut by the
// same code-point rule as on save rather than mid-character.
const READ_MAX = 4;

const emptyRow = () => ({ id: '', label: '', follow: 'none', question: '' });

// The edit page's fields for a stored question: own text only, so an empty
// field keeps following the reader's language.
function draftOf(question) {
  return {
    show: question.show,
    text: question.text ?? '',
    choices: question.choices.map((c) => ({
      id: c.id,
      label: c.own ?? '',
      follow: c.detail ? (c.question ? 'own' : 'general') : 'none',
      question: c.question ?? '',
    })),
  };
}

// The posted draft, as typed. A row keeps its choice id only if the
// question has that choice and no earlier row claimed it; anything else is
// a new choice, so a tampered id cannot take over another choice's ticks.
// One row past the limit is read, so too many choices is refused rather
// than cut off.
function readDraft(body, question) {
  const draft = { show: body?.show === '1', text: field(body, 'text', HEADING_MAX * READ_MAX), choices: [] };
  if (question.type !== 'choices') return draft;
  const count = Math.min(Number.parseInt(field(body, 'choiceCount', 3), 10) || 0, CHOICES_MAX + 1);
  const known = new Set(question.choices.map((c) => c.id));
  const used = new Set();
  for (let i = 0; i < count; i += 1) {
    let id = field(body, `choice_${i}_id`, 100);
    if (!known.has(id) || used.has(id)) id = '';
    if (id) used.add(id);
    const follow = field(body, `choice_${i}_follow`, 10);
    draft.choices.push({
      id,
      label: field(body, `choice_${i}_label`, HEADING_MAX * READ_MAX),
      follow: FOLLOW_UPS.includes(follow) ? follow : 'none',
      question: field(body, `choice_${i}_question`, QUESTION_MAX * READ_MAX),
    });
  }
  return draft;
}

// A row button's change to the draft, or an error key when it cannot be
// made. Nothing is stored either way.
function applyRowAction(draft, action) {
  const rows = draft.choices;
  if (action === 'add-choice') {
    if (rows.length >= CHOICES_MAX) return { key: 'admin.question.error.tooManyChoices', vars: { max: CHOICES_MAX } };
    rows.push(emptyRow());
    return null;
  }
  const match = ROW_ACTION.exec(action);
  const i = match ? Number(match[2]) : -1;
  if (i < 0 || i >= rows.length) return null;
  const j = match[1] === 'up' ? i - 1 : i + 1;
  if (match[1] === 'remove') rows.splice(i, 1);
  else if (j >= 0 && j < rows.length) [rows[i], rows[j]] = [rows[j], rows[i]];
  return null;
}

// The question the draft describes, or the errors that keep it from being
// saved. Typing the built-in wording or label (in any language) keeps it
// built in, so it goes on following each reader's language.
function buildQuestion(draft, current) {
  const errors = {};
  const builtIn = isBuiltinQuestion(current.id);
  let text = cleanHeading(draft.text);
  if (text && builtIn && isBuiltinText(current.id, text)) text = null;
  if (!text && !builtIn) errors.text = { key: 'admin.question.error.text' };
  const choices = [];
  if (current.type === 'choices') {
    if (draft.choices.length === 0) errors.choices = { key: 'admin.question.error.noChoices' };
    if (draft.choices.length > CHOICES_MAX) {
      errors.choices = { key: 'admin.question.error.tooManyChoices', vars: { max: CHOICES_MAX } };
    }
    const taken = new Set([...current.choices.map((c) => c.id), ...draft.choices.map((r) => r.id).filter(Boolean)]);
    draft.choices.forEach((row, i) => {
      const hasBuiltin = isBuiltinChoice(current.id, row.id);
      let own = cleanHeading(row.label);
      if (own && hasBuiltin && isBuiltinLabel(current.id, row.id, own)) own = null;
      const typed = row.follow === 'own' ? cleanQuestion(row.question) : null;
      const rowErrors = {};
      if (!own && !hasBuiltin) rowErrors.label = { key: 'admin.question.error.label' };
      if (row.follow === 'own' && !typed) rowErrors.question = { key: 'admin.question.error.ownQuestion' };
      if (Object.keys(rowErrors).length) {
        errors[`choice_${i}`] = rowErrors;
        return;
      }
      const id = row.id || newChoiceId(own, taken);
      taken.add(id);
      choices.push({ id, own, detail: row.follow !== 'none', question: typed && isOwnPrompt(id, typed) ? typed : null });
    });
  }
  if (Object.keys(errors).length) return { errors };
  return { question: { id: current.id, type: current.type, text, show: draft.show, choices } };
}

export function adminQuestionRoutes(app, ctx, { render, sendError, loadEvent, resubmitted, redirectDone }) {
  const { repo } = ctx;
  const formUrl = (event, done = null) => `/admin/events/${event.id}${done ? `?done=${done}` : ''}#form`;

  function findQuestion(request) {
    const form = wishForm(request.record);
    const question = form.questions.find((q) => q.id === request.params.qid);
    return question ? { form, question } : null;
  }

  function page(request, reply, { form, question, draft, errors = {}, drop = null, status = 200 }) {
    const event = request.record;
    const answered = question.id ? countAnswers(repo.listEventParticipants(event.id), question.id) : 0;
    const view = questionView(adminLang(request), {
      event, question, draft, errors, answered, drop, canDelete: form.questions.length > 1,
    });
    return render(request, reply, view, status);
  }

  // A stand-in for a question not created yet; it gets its id on save.
  const blank = (type) => ({ id: null, type, text: null, show: true, choices: [] });
  const fullError = { key: 'admin.form.full', vars: { max: QUESTIONS_MAX } };

  // Shared by the new and the edit page: a row button re-shows the draft,
  // a save stores the question when it reads differently from before.
  function post(request, reply, form, current) {
    const event = request.record;
    const draft = readDraft(request.body, current);
    const action = typeof request.body?.action === 'string' ? request.body.action : 'save';
    if (action !== 'save') {
      const error = applyRowAction(draft, action);
      const errors = error ? { choices: error } : {};
      return page(request, reply, { form, question: current, draft, errors, status: error ? 400 : 200 });
    }
    const isNew = !current.id;
    if (isNew && form.questions.length >= QUESTIONS_MAX) {
      return page(request, reply, { form, question: current, draft, errors: { text: fullError }, status: 400 });
    }
    const { question, errors } = buildQuestion(draft, isNew ? { ...current, id: newQuestionId(form) } : current);
    if (errors) return page(request, reply, { form, question: current, draft, errors, status: 400 });

    const kept = new Set(question.choices.map((c) => c.id));
    const removed = current.choices.filter((c) => !kept.has(c.id));
    const participants = removed.length ? repo.listEventParticipants(event.id) : [];
    const ticked = removed.filter((c) => countAnswers(participants, current.id, [c.id]) > 0);
    if (ticked.length && request.body?.confirmDrop !== '1') {
      const lang = adminLang(request);
      const drop = {
        names: ticked.map((c) => c.label(lang)),
        count: countAnswers(participants, current.id, ticked.map((c) => c.id)),
      };
      return page(request, reply, { form, question: current, draft, drop });
    }

    const next = {
      questions: isNew ? [...form.questions, question] : form.questions.map((q) => (q.id === question.id ? question : q)),
    };
    let dropped = 0;
    const changed = !sameForm(form, next);
    if (changed) {
      repo.tx(() => {
        repo.updateEvent(event.id, { formConfig: formValue(next), wishOptions: null }, ctx.nowIso());
        if (removed.length) dropped = repo.dropAnswersForEvent(event.id, question.id, removed.map((c) => c.id));
      });
    }
    request.log.info(
      { event_id: event.id, question_id: question.id, changed, answers_dropped: dropped },
      isNew ? 'question_added' : 'question_saved',
    );
    return redirectDone(request, reply, formUrl(event, isNew ? 'question-added' : 'question-saved'));
  }

  app.get('/admin/events/:id/questions/new', loadEvent, async (request, reply) => {
    const type = request.query?.type;
    if (!TYPES.has(type)) return sendError(reply, 400, adminLang(request));
    const form = wishForm(request.record);
    const draft = { show: true, text: '', choices: type === 'choices' ? [emptyRow()] : [] };
    const errors = form.questions.length >= QUESTIONS_MAX ? { text: fullError } : {};
    return page(request, reply, { form, question: blank(type), draft, errors });
  });

  app.post('/admin/events/:id/questions/new', loadEvent, async (request, reply) => {
    const again = resubmitted(request, reply);
    if (again) return again;
    const type = request.body?.type;
    if (!TYPES.has(type)) return sendError(reply, 400, adminLang(request));
    return post(request, reply, wishForm(request.record), blank(type));
  });

  app.get('/admin/events/:id/questions/:qid', loadEvent, async (request, reply) => {
    const found = findQuestion(request);
    if (!found) return sendError(reply, 404, adminLang(request));
    return page(request, reply, { ...found, draft: draftOf(found.question) });
  });

  app.post('/admin/events/:id/questions/:qid', loadEvent, async (request, reply) => {
    const again = resubmitted(request, reply);
    if (again) return again;
    const found = findQuestion(request);
    if (!found) return sendError(reply, 404, adminLang(request));
    return post(request, reply, found.form, found.question);
  });

  app.post('/admin/events/:id/questions/:qid/move', loadEvent, async (request, reply) => {
    const again = resubmitted(request, reply);
    if (again) return again;
    const found = findQuestion(request);
    if (!found) return sendError(reply, 404, adminLang(request));
    const event = request.record;
    const { form, question } = found;
    const dir = request.body?.dir;
    const i = form.questions.indexOf(question);
    const j = dir === 'up' ? i - 1 : dir === 'down' ? i + 1 : -1;
    if (j >= 0 && j < form.questions.length) {
      const questions = [...form.questions];
      [questions[i], questions[j]] = [questions[j], questions[i]];
      repo.updateEvent(event.id, { formConfig: formValue({ questions }), wishOptions: null }, ctx.nowIso());
      request.log.info({ event_id: event.id, question_id: question.id, dir }, 'question_moved');
    }
    return redirectDone(request, reply, formUrl(event));
  });

  // An empty question list reads back as the built-in form, so the last
  // question cannot go; hiding it is the way to leave it out.
  app.post('/admin/events/:id/questions/:qid/delete', loadEvent, async (request, reply) => {
    const again = resubmitted(request, reply);
    if (again) return again;
    const found = findQuestion(request);
    if (!found) return sendError(reply, 404, adminLang(request));
    const { form, question } = found;
    if (request.body?.confirm !== '1' || form.questions.length < 2) return sendError(reply, 400, adminLang(request));
    const event = request.record;
    const questions = form.questions.filter((q) => q !== question);
    const dropped = repo.tx(() => {
      repo.updateEvent(event.id, { formConfig: formValue({ questions }), wishOptions: null }, ctx.nowIso());
      return repo.dropAnswersForEvent(event.id, question.id);
    });
    request.log.info({ event_id: event.id, question_id: question.id, answers_dropped: dropped }, 'question_removed');
    return redirectDone(request, reply, formUrl(event, 'question-removed'));
  });
}
