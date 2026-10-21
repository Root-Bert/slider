import type { NextcloudLoginConfig } from '../config';
import { readBodyCapped, safeFetch, type SafeFetchOptions } from '../sources/safe-fetch';

/**
 * "Weiter mit Nextcloud": Nextcloud's own OAuth 2.0 (Verwaltung → Sicherheit → OAuth-2.0-Clients)
 * against the organisation's Nextcloud (`NEXTCLOUD_URL`). Authorization code flow with state;
 * PKCE is sent too (newer Nextclouds check it, older ones ignore it). Not Login Flow v2: that
 * hands out a link anyone could forward, and whoever polls signs in as the person who opened it.
 *
 * Only the identity is kept. The tokens are dropped after one call to the user endpoint – file
 * access comes from connecting the Nextcloud on /konto, as before.
 */

const MAX_ANSWER_BYTES = 64 * 1024;

export class NextcloudLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NextcloudLoginError';
  }
}

export interface NextcloudUser {
  /** The Nextcloud user id: stable, unlike the login name or the address. */
  id: string;
  email: string | null;
  displayName: string | null;
}

export function nextcloudAuthorizeUrl(
  server: string,
  login: NextcloudLoginConfig,
  input: { state: string; challenge: string },
): string {
  const url = new URL(`${server}/index.php/apps/oauth2/authorize`);
  for (const [key, value] of Object.entries({
    client_id: login.clientId,
    response_type: 'code',
    redirect_uri: login.redirectUri,
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
  })) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/** Trades the code for an access token and asks Nextcloud whose it is. */
export async function exchangeNextcloudCode(
  http: SafeFetchOptions,
  server: string,
  login: NextcloudLoginConfig,
  code: string,
  verifier: string,
): Promise<NextcloudUser> {
  const token = await readJson<{ access_token?: unknown; user_id?: unknown; error?: unknown }>(
    http,
    new URL(`${server}/index.php/apps/oauth2/api/v1/token`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: login.redirectUri,
        code_verifier: verifier,
        client_id: login.clientId,
        client_secret: login.clientSecret,
      }).toString(),
    },
    'token exchange',
  );
  if (typeof token.access_token !== 'string' || !token.access_token) {
    throw new NextcloudLoginError(`Nextcloud token exchange failed: ${String(token.error ?? '')}`);
  }
  const answer = await readJson<{
    ocs?: { data?: { id?: unknown; email?: unknown; displayname?: unknown } };
  }>(
    http,
    new URL(`${server}/ocs/v2.php/cloud/user?format=json`),
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'OCS-APIRequest': 'true',
        Accept: 'application/json',
      },
    },
    'user lookup',
  );
  const data = answer.ocs?.data;
  if (typeof data?.id !== 'string' || !data.id) {
    throw new NextcloudLoginError('Nextcloud sent no user id');
  }
  // The token's `user_id` and the user endpoint must agree.
  if (typeof token.user_id === 'string' && token.user_id !== data.id) {
    throw new NextcloudLoginError('Nextcloud user id mismatch');
  }
  return {
    id: data.id,
    email: typeof data.email === 'string' && data.email.includes('@') ? data.email : null,
    displayName:
      typeof data.displayname === 'string' && data.displayname.trim() ? data.displayname : null,
  };
}

async function readJson<T>(
  http: SafeFetchOptions,
  url: URL,
  init: RequestInit,
  step: string,
): Promise<T> {
  let response: Response;
  try {
    ({ response } = await safeFetch(url, http, init));
  } catch (error) {
    throw new NextcloudLoginError(`Nextcloud ${step} unreachable: ${String(error)}`);
  }
  let body: T;
  try {
    body = JSON.parse(new TextDecoder().decode(await readBodyCapped(response, MAX_ANSWER_BYTES)));
  } catch {
    throw new NextcloudLoginError(`Nextcloud ${step}: HTTP ${response.status}, no JSON`);
  }
  if (!response.ok) {
    throw new NextcloudLoginError(`Nextcloud ${step} failed: HTTP ${response.status}`);
  }
  return body;
}
