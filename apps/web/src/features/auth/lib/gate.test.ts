import type { MeResponse } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { accountGate, isSignedOutError } from './gate';

const author = { id: 'u', name: 'A', type: 'owner', color: 'red' } as const;

describe('accountGate', () => {
  it('waits while /me loads', () => {
    expect(accountGate({ error: null })).toBe('loading');
  });

  it('sends signed-out visitors to the login page', () => {
    expect(accountGate({ error: new ApiError(401, 'unauthorized', 'x') })).toBe('login');
    expect(isSignedOutError(new ApiError(401, 'unauthorized', 'x'))).toBe(true);
    expect(isSignedOutError(new ApiError(404, 'not_found', 'x'))).toBe(false);
  });

  it('lets accounts in (also the dev login)', () => {
    const me = {
      viewer: { kind: 'owner', author },
      user: { id: 'u' },
      workspaces: [],
      pendingInvites: [],
    } as unknown as MeResponse;
    expect(accountGate({ data: me, error: null })).toBe('ready');
  });

  it('shows other failures as errors', () => {
    expect(accountGate({ error: new ApiError(500, 'internal', 'x') })).toBe('error');
  });
});
