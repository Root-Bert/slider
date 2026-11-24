import { pluralize } from '@/lib/format';
import type { BulkResult } from '@/lib/api';

/** Toast and menu copy for actions on several decks at once. */

/** The failed part of a bulk request as a toast, or null when everything went through. */
export function failureMessage(result: BulkResult<unknown>, verb: string): string | null {
  const first = result.failed[0];
  if (!first) return null;
  return `${pluralize(result.failed.length, 'Präsentation konnte', 'Präsentationen konnten')} nicht ${verb} werden: ${first.message}`;
}

/** After a move, only what failed – what went is seen going. */
export function movedFailure(result: BulkResult<unknown>): string | null {
  return failureMessage(result, 'verschoben');
}
