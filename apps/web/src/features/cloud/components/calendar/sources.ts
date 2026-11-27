import { useSearchParams } from 'react-router';
import type { Calendar } from '@slider/shared';
import { TODOS } from './entries';

/**
 * The calendar's sources, as the mailboxes atop Post: „Alle“ (no `?quelle=`), the workspace's own
 * calendars (its areas' and one's private ones, the to-dos with them – `workspace`) and each
 * account's (`?quelle=<account id>`). A source is a page's view, never what the list hides.
 */
export const CALENDAR_SOURCE_PARAM = 'quelle';
export const WORKSPACE_SOURCE = 'workspace';

/** Where a calendar comes from: its account, else the workspace. */
export const sourceOf = (calendar: Pick<Calendar, 'mailAccountId'>) =>
  calendar.mailAccountId ?? WORKSPACE_SOURCE;

/** The source the page shows – `null`: „Alle“ (also for one that is gone). */
export function useCalendarSource(calendars: readonly Calendar[] | undefined): string | null {
  const [params] = useSearchParams();
  const asked = params.get(CALENDAR_SOURCE_PARAM);
  if (!asked) return null;
  if (asked === WORKSPACE_SOURCE) return asked;
  return calendars?.some((each) => each.mailAccountId === asked) ? asked : null;
}

/** What stays out in a source: the list's hidden ones, the other sources' calendars (and to-dos). */
export function hiddenIn(
  hidden: ReadonlySet<string>,
  calendars: readonly Calendar[] | undefined,
  source: string | null,
): ReadonlySet<string> {
  if (!source) return hidden;
  const out = new Set(hidden);
  for (const calendar of calendars ?? []) if (sourceOf(calendar) !== source) out.add(calendar.id);
  if (source !== WORKSPACE_SOURCE) out.add(TODOS);
  return out;
}
