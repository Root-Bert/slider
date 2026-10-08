import type { MeResponse } from '@slider/shared';
import { ApiError } from '@/lib/api-client';

export type GateState = 'loading' | 'login' | 'error' | 'ready';

/**
 * What a member page shows for the `GET /me` state: signed out (401) or a review-link guest
 * without an account goes to the login page; other failures show an error.
 */
export function accountGate(me: { data?: MeResponse; error: Error | null }): GateState {
  if (me.data) return me.data.user ? 'ready' : 'login';
  if (me.error) return me.error instanceof ApiError && me.error.status === 401 ? 'login' : 'error';
  return 'loading';
}

/** Signed out: the deck route sends the visitor to the login page instead of an error. */
export const isSignedOutError = (error: unknown) =>
  error instanceof ApiError && error.status === 401;
