import type { MeResponse } from '@slider/shared';
import { ApiError } from '@/lib/api-client';

export type GateState = 'loading' | 'login' | 'claim' | 'error' | 'ready';

/**
 * What a member page shows for the `GET /me` state: signed out (401) goes to the login page;
 * signed in on an instance without admin goes to the setup token (`claim`, nothing else works
 * until then); other failures show an error.
 */
export function accountGate(me: { data?: MeResponse; error: Error | null }): GateState {
  if (me.data) {
    if (!me.data.user) return 'login';
    return me.data.instanceClaimed === false ? 'claim' : 'ready';
  }
  if (me.error) return me.error instanceof ApiError && me.error.status === 401 ? 'login' : 'error';
  return 'loading';
}

/** Signed out: the deck route sends the visitor to the login page instead of an error. */
export const isSignedOutError = (error: unknown) =>
  error instanceof ApiError && error.status === 401;
