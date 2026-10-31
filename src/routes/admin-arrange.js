import { arrangeState, openGroup, swapPair } from '../drawing.js';
import { arrangeView } from '../views/admin.js';
import { adminLang } from './admin-auth.js';
import { ID } from './admin-shared.js';

const SWAPPED = /^(\d{1,15})-(\d{1,15})$/;
const VERSION_MAX = 64;
const SWAP_STATUS = { stale: 409, drawn: 409, self: 400, unknown: 400 };

const idFrom = (value) => (typeof value === 'string' && ID.test(value) ? Number(value) : null);

export function adminArrangeRoutes(app, ctx, { render, loadGroup, groupPage }) {
  const { repo } = ctx;

  function arrangePage(lang, group, extra = {}) {
    const { people, map, version } = arrangeState(repo, group.id);
    const byId = new Map(people.map((p) => [p.id, p]));
    const pairs = people
      .filter((p) => map.has(p.id))
      .map((giver) => ({ giver, receiver: byId.get(map.get(giver.id)), locked: Boolean(giver.drawnAt) }));
    return arrangeView(lang, { group, pairs, version, ...extra });
  }

  app.get('/admin/groups/:id/arrange', loadGroup, async (request, reply) => {
    const match = SWAPPED.exec(String(request.query?.swapped ?? ''));
    const swapped = match ? [Number(match[1]), Number(match[2])] : null;
    return render(request, reply, arrangePage(adminLang(request), request.record, { swapped }));
  });

  app.post('/admin/groups/:id/swap', loadGroup, async (request, reply) => {
    const group = request.record;
    const a = idFrom(request.body?.a);
    const b = idFrom(request.body?.b);
    const version = typeof request.body?.version === 'string' ? request.body.version.slice(0, VERSION_MAX) : '';
    const result = a === null || b === null ? { error: 'unknown' } : swapPair(ctx, group.id, a, b, version);
    if (result.error) {
      request.log.info({ group_id: group.id, reason: result.error }, 'swap_refused');
      const view = arrangePage(adminLang(request), group, { error: `admin.arrange.error.${result.error}` });
      return render(request, reply, view, SWAP_STATUS[result.error]);
    }
    request.log.info({ group_id: group.id, giver_a: a, giver_b: b }, 'pairs_swapped');
    return reply.redirect(`/admin/groups/${group.id}/arrange?swapped=${a}-${b}`, 303);
  });

  // Opening mails everyone and cannot be undone, so like every other step
  // of that kind it needs the tick; the checkbox is required in the form,
  // and a post without it is refused here too.
  app.post('/admin/groups/:id/open', loadGroup, async (request, reply) => {
    const group = request.record;
    const dashboard = `/admin/groups/${group.id}?done=opened`;
    if (request.body?.confirm !== '1' && !group.openedAt) {
      request.log.info({ group_id: group.id, reason: 'confirm' }, 'group_open_refused');
      return render(request, reply, groupPage(adminLang(request), group, { openError: 'confirm' }), 400);
    }
    const result = openGroup(ctx, group.id);
    // A second press, or one racing the auto-open, finds the group open:
    // that is the outcome the organiser asked for, not an error.
    if (result.reason === 'already-open') return reply.redirect(dashboard, 303);
    if (!result.opened) {
      request.log.info({ group_id: group.id, reason: result.reason }, 'group_open_refused');
      return render(request, reply, groupPage(adminLang(request), repo.getGroup(group.id), { openError: result.reason }), 409);
    }
    return reply.redirect(dashboard, 303);
  });
}
