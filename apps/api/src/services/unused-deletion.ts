import { eq } from 'drizzle-orm';
import { instanceSettings } from '../db/schema';
import type { AppDeps } from '../deps';

/**
 * Since when `DELETE_UNUSED` is on: the deadlines for unused accounts and decks count from then at
 * the earliest, so switching it on deletes nothing right away – everything long unused first gets
 * the full round of reminders. Noted by the first sweep that sees it on (an `instance_settings`
 * row the setup page doesn't know), removed by the first that sees it off: switching it on again
 * grants a new grace.
 */

const KEY = 'delete-unused-since';

/** When it was switched on, or `null` while it is off. */
export async function unusedDeletionSince(deps: AppDeps): Promise<Date | null> {
  if (!deps.config.retention.deleteUnused) {
    await deps.db.delete(instanceSettings).where(eq(instanceSettings.key, KEY));
    return null;
  }
  // Both sweeps may get here first: whichever inserts, both read the same time.
  await deps.db
    .insert(instanceSettings)
    .values({ key: KEY, value: deps.clock.now().toISOString() })
    .onConflictDoNothing();
  const [row] = await deps.db
    .select({ value: instanceSettings.value })
    .from(instanceSettings)
    .where(eq(instanceSettings.key, KEY));
  const since = row ? new Date(row.value) : deps.clock.now();
  return Number.isNaN(since.getTime()) ? deps.clock.now() : since;
}

/** Notes `DELETE_UNUSED` as on since `since` (tests: an instance where it has long been on). */
export async function setUnusedDeletionSince(deps: AppDeps, since: Date): Promise<void> {
  await deps.db
    .insert(instanceSettings)
    .values({ key: KEY, value: since.toISOString() })
    .onConflictDoUpdate({ target: instanceSettings.key, set: { value: since.toISOString() } });
}

/** The later of the two: last use, but not before it was switched on. */
export const laterOf = (a: Date, b: Date) => (a >= b ? a : b);
