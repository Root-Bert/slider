import type { Calendar } from '@slider/shared';
import { readString } from '@/lib/storage';

/** The calendar a new event goes to: the last one picked, in this browser. */
export const lastCalendarKey = (workspaceId: string) => `slider.calendar.last:${workspaceId}`;

/**
 * Where a plain event goes (the calendar's „Termin anlegen“, a mail's): the last calendar picked,
 * else one's private one, else the first one may put events in. `''`: none.
 */
export function plainEventCalendar(calendars: readonly Calendar[], workspaceId: string): string {
  const editable = calendars.filter((each) => each.canEdit);
  const last = readString(lastCalendarKey(workspaceId));
  return (
    editable.find((each) => each.id === last)?.id ??
    editable.find((each) => each.kind === 'private' && !each.parentId)?.id ??
    editable[0]?.id ??
    ''
  );
}
