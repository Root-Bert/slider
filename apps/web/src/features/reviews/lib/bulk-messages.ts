import { pluralize } from '@/lib/format';
import type { BulkResult } from '@/lib/api';

/** Toast and menu copy for actions on several decks at once. */

/** The failed part of a bulk request as a toast, or null when everything went through. */
export function failureMessage(result: BulkResult<unknown>, verb: string): string | null {
  const first = result.failed[0];
  if (!first) return null;
  return `${pluralize(result.failed.length, 'Präsentation konnte', 'Präsentationen konnten')} nicht ${verb} werden: ${first.message}`;
}

/** Toast text after a move: what went where, or what failed. */
export function movedMessage(
  result: BulkResult<unknown>,
  folderName: string | null,
): { text: string; tone?: 'danger' } {
  const failure = failureMessage(result, 'verschoben');
  if (failure) return { text: failure, tone: 'danger' };
  const what = pluralize(result.done.length, 'Präsentation', 'Präsentationen');
  return {
    text: folderName
      ? `${what} nach „${folderName}“ verschoben`
      : `${what} aus dem Ordner genommen`,
  };
}
