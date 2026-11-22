import { Hono } from 'hono';
import {
  calendarChangeSchema,
  calendarEventChangeSchema,
  calendarEventInputSchema,
  calendarInputSchema,
  calendarOverviewInputSchema,
  type AccountAuthor,
} from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { aiLimits } from '../http/ai-limits';
import { assertWithinLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import {
  createCalendar,
  createEvent,
  deleteCalendar,
  deleteEvent,
  getEvent,
  listCalendars,
  listMailCalendarRefusals,
  listEvents,
  updateCalendar,
  updateEvent,
} from '../services/calendars';
import { calendarOverview } from '../services/calendar/overview';

/**
 * Calendars (`services/calendars.ts`): the ones one sees, their events in a range, sub-calendars
 * and events made, changed and deleted. Account members only.
 */
export function calendarRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const me = (c: { var: ViewerEnv['Variables'] }) => {
    requireOwner(c.var.viewer);
    return (c.var.viewer.author as AccountAuthor).id;
  };
  return new Hono<ViewerEnv>()
    .get('/workspaces/:workspaceId/calendars', viewer, async (c) =>
      c.json(await listCalendars(deps, me(c), c.req.param('workspaceId'))),
    )
    .get('/workspaces/:workspaceId/mail-calendars/refused', viewer, async (c) =>
      c.json(await listMailCalendarRefusals(deps, me(c), c.req.param('workspaceId'))),
    )
    .get('/workspaces/:workspaceId/calendar-events', viewer, async (c) =>
      c.json(
        await listEvents(deps, me(c), c.req.param('workspaceId'), {
          from: c.req.query('from') ?? '',
          to: c.req.query('to') ?? '',
        }),
      ),
    )
    .post('/workspaces/:workspaceId/calendar-overview', viewer, async (c) => {
      const userId = me(c);
      const input = await readJson(c, calendarOverviewInputSchema);
      // The model is asked only when what it reads has changed: then within the AI budget.
      return c.json(
        await calendarOverview(deps, userId, c.req.param('workspaceId'), input, () =>
          assertWithinLimit(
            c,
            aiLimits(deps).aiRequests.hit(userId),
            'Zu viele KI-Aufträge auf einmal. Bitte warte einen Moment.',
          ),
        ),
      );
    })
    .post('/calendars', viewer, async (c) => {
      const input = await readJson(c, calendarInputSchema);
      return c.json(await createCalendar(deps, me(c), input), 201);
    })
    .patch('/calendars/:calendarId', viewer, async (c) => {
      const change = await readJson(c, calendarChangeSchema);
      return c.json(await updateCalendar(deps, me(c), c.req.param('calendarId'), change));
    })
    .delete('/calendars/:calendarId', viewer, async (c) => {
      await deleteCalendar(deps, me(c), c.req.param('calendarId'));
      return c.body(null, 204);
    })
    .post('/calendar-events', viewer, async (c) => {
      const input = await readJson(c, calendarEventInputSchema);
      return c.json(await createEvent(deps, me(c), input), 201);
    })
    .get('/calendar-events/:eventId', viewer, async (c) =>
      c.json(await getEvent(deps, me(c), c.req.param('eventId'))),
    )
    .patch('/calendar-events/:eventId', viewer, async (c) => {
      const change = await readJson(c, calendarEventChangeSchema);
      return c.json(await updateEvent(deps, me(c), c.req.param('eventId'), change));
    })
    .delete('/calendar-events/:eventId', viewer, async (c) => {
      await deleteEvent(deps, me(c), c.req.param('eventId'));
      return c.body(null, 204);
    });
}
