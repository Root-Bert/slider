import type { QueryClient } from '@tanstack/react-query';

/**
 * What a query client does with an error that may mean the session ended (the 401 → login
 * redirect, set up in `app/query-client.ts`). Queries and mutations reach it through the
 * client's caches; API calls outside React Query report their errors with `reportSessionError`.
 */
const sessionErrorHandlers = new WeakMap<QueryClient, (error: unknown) => void>();

export function setSessionErrorHandler(client: QueryClient, handler: (error: unknown) => void) {
  sessionErrorHandlers.set(client, handler);
}

/**
 * For API calls that bypass the query and mutation caches (the XHR upload, the OneDrive picker
 * session): an ended session goes to the login here too, instead of only an inline error.
 */
export function reportSessionError(client: QueryClient, error: unknown) {
  sessionErrorHandlers.get(client)?.(error);
}
