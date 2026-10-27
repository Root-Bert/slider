import { z } from 'zod';

/**
 * Company login per workspace (BER-162): a workspace's admins connect their own OpenID
 * Connect provider (Entra, Okta, Keycloak, Google Workspace, …). People at the workspace's
 * domain then sign in through it and land in the workspace.
 *
 * The domain is the workspace's company domain (`Workspace.joinDomain`), proven by a DNS TXT
 * record: a mailbox at the domain is not enough, as the provider vouches for every address there.
 */

/** `GET /workspaces/:id/sso` (admins). */
export const workspaceSsoSchema = z.object({
  /** Issuer, client ID and secret are saved. */
  configured: z.boolean(),
  issuer: z.string().nullable(),
  clientId: z.string().nullable(),
  /** The secret itself never leaves the server. */
  hasSecret: z.boolean(),
  /** Redirect URI to register at the provider – the same for every workspace. */
  redirectUri: z.string(),
  /** The workspace's company domain; `null`: not opened to a domain yet, SSO can't work. */
  domain: z.string().nullable(),
  /** TXT record that proves the domain; `null` until the settings are saved. */
  dnsRecord: z.object({ name: z.string(), value: z.string() }).nullable(),
  /** The TXT record was found for the current domain. */
  verified: z.boolean(),
  /** The plan allows SSO (paid on the hosted instance, always when self-hosted). */
  available: z.boolean(),
  /** Everything is in place: people at `domain` can sign in through the provider. */
  active: z.boolean(),
});
export type WorkspaceSso = z.infer<typeof workspaceSsoSchema>;

/** `PUT /workspaces/:id/sso` – `clientSecret` may be left out to keep the saved one. */
export const updateWorkspaceSsoInputSchema = z.object({
  issuer: z
    .string()
    .trim()
    .max(500)
    .pipe(z.url({ protocol: /^https$/, error: 'Bitte die Issuer-URL mit https:// angeben.' })),
  clientId: z.string().trim().min(1).max(500),
  clientSecret: z.string().trim().min(1).max(2000).optional(),
});
export type UpdateWorkspaceSsoInput = z.infer<typeof updateWorkspaceSsoInputSchema>;

/** `POST /auth/sso/discover` – the address someone wants to sign in with. */
export const discoverSsoInputSchema = z.object({
  email: z.string().trim().max(320).pipe(z.email('Bitte eine gültige E-Mail-Adresse eingeben.')),
});
export type DiscoverSsoInput = z.infer<typeof discoverSsoInputSchema>;

/** Where the browser goes for the company login: `${loginUrl}&returnTo=<path>`. */
/** Only where to go – anyone may ask, so no workspace name. */
export const ssoLoginSchema = z.object({ loginUrl: z.string() });
export type SsoLogin = z.infer<typeof ssoLoginSchema>;

/** DNS name of the TXT record that proves `domain` for the company login. */
export const ssoDnsName = (domain: string) => `_slider-sso.${domain}`;
