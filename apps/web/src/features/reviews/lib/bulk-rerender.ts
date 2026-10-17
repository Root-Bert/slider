import type { DeckStatus } from '@slider/shared';
import { isGoneError } from '@/lib/api';

interface FollowedStatus {
  data?: DeckStatus;
  dataUpdatedAt: number;
  error: unknown;
}

/**
 * Progress of a bulk "Neu rendern": `done` decks report no rendering in a status fetched after
 * the start (the cache may still hold an older one); `gone` decks answer 4xx – deleted or no
 * longer accessible – and can never finish, so they count as settled instead of blocking.
 */
export function bulkRerenderProgress(statuses: readonly FollowedStatus[], startedAt: number) {
  let done = 0;
  let gone = 0;
  for (const status of statuses) {
    if (isGoneError(status.error)) gone += 1;
    else if (status.dataUpdatedAt >= startedAt && !status.data?.rendering) done += 1;
  }
  return { done, gone, finished: done + gone === statuses.length };
}
