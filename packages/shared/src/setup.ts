import { z } from 'zod';

/**
 * Setup page (`/einrichtung`): logins, mail and sign-up configured in the browser instead of
 * environment variables, so a self-hosted Slider needs nothing but `SLIDER_URL` to start.
 * Until an instance admin exists it is opened with the one-time setup token from the server log;
 * a signed-in account becomes instance admin by entering that token (`POST /setup/claim`) –
 * signing in alone never does. Afterwards only the instance admin may use it. Values set by the
 * environment always win and are shown read-only.
 */

/** The settings the page may store – named like their environment variables. */
export const SETUP_KEYS = [
  'SMTP_URL',
  'MAIL_FROM',
  'MS_CLIENT_ID',
  'MS_CLIENT_SECRET',
  'MS_TENANT',
  'NEXTCLOUD_URL',
  'NEXTCLOUD_CLIENT_ID',
  'NEXTCLOUD_CLIENT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'OIDC_ISSUER',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'OIDC_LABEL',
  'SIGNUP',
  'SIGNUP_DOMAINS',
  'DELETE_UNUSED',
] as const;
export const setupKeySchema = z.enum(SETUP_KEYS);
export type SetupKey = z.infer<typeof setupKeySchema>;

/** Never sent back to the browser, stored encrypted. `SMTP_URL` carries the mail password. */
export const SECRET_SETUP_KEYS: readonly SetupKey[] = [
  'SMTP_URL',
  'MS_CLIENT_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'OIDC_CLIENT_SECRET',
  'NEXTCLOUD_CLIENT_SECRET',
];

export const setupFieldSchema = z.object({
  /** `env`: set by an environment variable (read-only here); `stored`: saved on this page. */
  source: z.enum(['env', 'stored']).nullable(),
  /**
   * The value; `null` for secrets – see `set`. Except `SMTP_URL`: it comes without its password
   * (`smtps://user@host:465`), so the page can show and change the mail server.
   */
  value: z.string().nullable(),
  set: z.boolean(),
});
export type SetupField = z.infer<typeof setupFieldSchema>;

/** `GET /setup` – with the setup token (header `X-Setup-Token`) or as instance admin. */
export const setupStatusSchema = z.object({
  /** Token or session good enough to see and change the settings. */
  authorized: z.boolean(),
  /** An instance admin exists; from then on only that admin may come here. */
  claimed: z.boolean(),
  /**
   * Signed in, and no instance admin yet: this account can become admin with the setup token
   * (`POST /setup/claim`). The token alone doesn't open the page for a signed-in account.
   */
  claimable: z.boolean(),
  /** At least one login works (Microsoft or SSO). */
  loginConfigured: z.boolean(),
  /** Only when authorized. */
  settings: z
    .object({
      /** `SLIDER_URL`, the public address. */
      url: z.string(),
      /** `automatic`: the server restarts itself after saving; `manual`: restart it yourself. */
      restart: z.enum(['automatic', 'manual']),
      /** To copy into the app registrations at Microsoft, Google, the SSO provider and Nextcloud. */
      redirectUris: z.object({
        microsoft: z.string(),
        google: z.string(),
        oidc: z.string(),
        nextcloud: z.string(),
      }),
      fields: z.record(setupKeySchema, setupFieldSchema),
      /** What only the environment switches on, for the legal templates: Stripe and Unsplash. */
      features: z.object({ payments: z.boolean(), stockPhotos: z.boolean() }),
    })
    .optional(),
});
export type SetupStatus = z.infer<typeof setupStatusSchema>;

/**
 * `PUT /setup` – only the keys that change: a string sets the value, `null` removes it. Secrets
 * that are left out stay as they are.
 */
export const saveSetupInputSchema = z.object({
  values: z.partialRecord(setupKeySchema, z.string().trim().max(2000).nullable()),
});
export type SaveSetupInput = z.infer<typeof saveSetupInputSchema>;

export const saveSetupResultSchema = z.object({ restart: z.enum(['automatic', 'manual']) });
export type SaveSetupResult = z.infer<typeof saveSetupResultSchema>;

/**
 * `GET /health`. `bootId` is new with every start of the server process: after saving, the setup
 * page knows the restarted server by it. Servers from before it leave it out.
 */
export const healthSchema = z.object({ ok: z.boolean(), bootId: z.string().optional() });
export type Health = z.infer<typeof healthSchema>;

/** `POST /setup/claim` – the signed-in account is now instance admin. */
export const claimSetupResultSchema = z.object({ claimed: z.literal(true) });
export type ClaimSetupResult = z.infer<typeof claimSetupResultSchema>;

/**
 * Header for the one-time setup token. The server log prints it next to the address of the setup
 * page; it is typed in there and never travels in a URL.
 */
export const SETUP_TOKEN_HEADER = 'X-Setup-Token';
