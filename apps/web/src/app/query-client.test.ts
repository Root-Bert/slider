import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/api';
import { createQueryClient } from './query-client';

const signedOut = () => new ApiError(401, 'unauthorized', 'Bitte melde dich an.');

describe('createQueryClient – session ended', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: { pathname: '/w/w1', search: '?ordner=f1', hash: '' },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  function setup(signedIn = true) {
    const redirect = vi.fn();
    const client = createQueryClient(redirect);
    if (signedIn) client.setQueryData(queryKeys.me, { user: { id: 'u1' } });
    return { client, redirect };
  }

  it('a 401 on a list sends the signed-in tab to the login, back here afterwards', async () => {
    const { client, redirect } = setup();
    await client
      .fetchQuery({ queryKey: ['decks', 'w1'], queryFn: () => Promise.reject(signedOut()) })
      .catch(() => {});
    expect(redirect).toHaveBeenCalledWith('/login?returnTo=%2Fw%2Fw1%3Fordner%3Df1');
  });

  it('a 401 on an action does too, once', async () => {
    const { client, redirect } = setup();
    const mutation = () =>
      client
        .getMutationCache()
        .build(client, { mutationFn: () => Promise.reject(signedOut()) })
        .execute(undefined)
        .catch(() => {});
    await mutation();
    await mutation();
    expect(redirect).toHaveBeenCalledOnce();
  });

  it('leaves the Microsoft login prompts and signed-out pages to their own UI', async () => {
    const { client, redirect } = setup();
    await client
      .fetchQuery({
        queryKey: ['import'],
        queryFn: () =>
          Promise.reject(new ApiError(401, 'microsoft_login_required', 'Anmelden', '/api/x')),
      })
      .catch(() => {});
    expect(redirect).not.toHaveBeenCalled();

    const anonymous = setup(false);
    await anonymous.client
      .fetchQuery({ queryKey: ['setup'], queryFn: () => Promise.reject(signedOut()) })
      .catch(() => {});
    expect(anonymous.redirect).not.toHaveBeenCalled();
  });
});
