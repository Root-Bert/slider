import { ApiError } from '@/lib/api-client';

/** What `DeckPage` needs of a query to decide whether its error replaces the viewer. */
export interface QueryOutcome {
  data: unknown;
  error: Error | null;
}

/** 4xx answers stay true on retry – except "too slow" and "too many requests". */
export const isFinalError = (error: Error) =>
  error instanceof ApiError &&
  error.status >= 400 &&
  error.status < 500 &&
  error.status !== 408 &&
  error.status !== 429;

/**
 * The error that takes over the deck page, if any. A failed background refetch (server
 * redeploying, a proxy's 502) keeps the data it had: the viewer stays up – with drafts,
 * recordings and sketches – and the next poll or focus tries again. Only a query with nothing to
 * show, or a final answer (deck gone, access revoked), ends in the error page.
 */
export function blockingError(queries: readonly QueryOutcome[]): Error | null {
  for (const { data, error } of queries) {
    if (error && (data === undefined || isFinalError(error))) return error;
  }
  return null;
}
