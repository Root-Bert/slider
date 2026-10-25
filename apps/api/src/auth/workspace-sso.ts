import { resolveTxt as dnsResolveTxt } from 'node:dns/promises';
import { ssoDnsName } from '@slider/shared';
import type { Clock } from '../clock';
import { SSO_CALLBACK_PATH, type Config } from '../config';
import type { WorkspaceSsoRow } from '../db/schema';
import {
  dnsLookup,
  readBodyCapped,
  safeFetch,
  type FetchLike,
  type LookupAll,
  type SafeFetchOptions,
} from '../sources/safe-fetch';
import { OidcClient } from './oidc';

/**
 * The network side of workspaces' company logins (BER-162). Unlike the instance's
 * `OIDC_ISSUER`, a workspace admin types the issuer – so every request to it goes through
 * `safeFetch` (public https addresses only, every redirect re-checked, answers capped).
 */

export type ResolveTxt = (name: string) => Promise<string[][]>;

export interface SsoNetwork {
  fetch?: FetchLike;
  lookup?: LookupAll;
  resolveTxt?: ResolveTxt;
}

/** Discovery documents and token answers are small. */
const MAX_ANSWER_BYTES = 1024 * 1024;

/** `fetch` for {@link OidcClient} through `safeFetch`. */
function safeOidcFetch(network: SsoNetwork): FetchLike {
  const http: SafeFetchOptions = {
    fetch: network.fetch ?? globalThis.fetch,
    lookup: network.lookup ?? dnsLookup,
    maxBytes: MAX_ANSWER_BYTES,
  };
  return async (input, init) => {
    const { response } = await safeFetch(new URL(input), http, init);
    const body = await readBodyCapped(response, MAX_ANSWER_BYTES);
    return new Response(body, { status: response.status, headers: response.headers });
  };
}

/** The OIDC client of one workspace's company login. */
export function workspaceSsoClient(
  config: Pick<Config, 'webOrigin'>,
  row: Pick<WorkspaceSsoRow, 'issuer' | 'clientId' | 'clientSecret'>,
  clock: Clock,
  network: SsoNetwork = {},
): OidcClient {
  return new OidcClient(
    {
      issuer: row.issuer,
      clientId: row.clientId,
      clientSecret: row.clientSecret,
      label: '',
      scopes: 'openid email profile',
      redirectUri: ssoRedirectUri(config),
    },
    clock,
    safeOidcFetch(network),
  );
}

export const ssoRedirectUri = (config: Pick<Config, 'webOrigin'>) =>
  new URL(SSO_CALLBACK_PATH, config.webOrigin).toString();

export const ssoTxtValue = (token: string) => `slider-sso=${token}`;

/** Whether `_slider-sso.<domain>` has the TXT record with `token`. Lookup errors count as no. */
export async function hasSsoTxtRecord(
  network: SsoNetwork,
  domain: string,
  token: string,
): Promise<boolean> {
  const resolveTxt = network.resolveTxt ?? dnsResolveTxt;
  try {
    const records = await resolveTxt(ssoDnsName(domain));
    // Long TXT records come in chunks of 255 characters.
    return records.some((chunks) => chunks.join('').trim() === ssoTxtValue(token));
  } catch {
    return false;
  }
}
