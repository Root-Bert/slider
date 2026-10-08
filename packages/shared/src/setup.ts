import { z } from 'zod';

/**
 * Setup page (`/einrichtung`): logins, mail and sign-up configured in the browser instead of
 * environment variables, so a self-hosted Slider needs nothing but `SLIDER_URL` to start.
 * Before the first account exists it is opened with the one-time setup token from the server log;
 * afterwards only the instance admin may use it. Values set by the environment always win and
 * are shown read-only.
 */

/** The settings the page may store – named like their environment variables. */
export const SETUP_KEYS = [
  'BOOTSTRAP_EMAIL',
  'SMTP_URL',
  'MAIL_FROM',
  'MS_CLIENT_ID',
  'MS_CLIENT_SECRET',
  'MS_TENANT',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'OIDC_ISSUER',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'OIDC_LABEL',
  'SIGNUP',
  'SIGNUP_DOMAINS',
] as const;
export const setupKeySchema = z.enum(SETUP_KEYS);
export type SetupKey = z.infer<typeof setupKeySchema>;

/** Never sent back to the browser, stored encrypted. `SMTP_URL` carries the mail password. */
export const SECRET_SETUP_KEYS: readonly SetupKey[] = [
  'SMTP_URL',
  'MS_CLIENT_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'OIDC_CLIENT_SECRET',
];

export const setupFieldSchema = z.object({
  /** `env`: set by an environment variable (read-only here); `stored`: saved on this page. */
  source: z.enum(['env', 'stored']).nullable(),
  /** The value; always `null` for secrets – see `set`. */
  value: z.string().nullable(),
  set: z.boolean(),
});
export type SetupField = z.infer<typeof setupFieldSchema>;

/** `GET /setup` – with the setup token (header `X-Setup-Token`) or as instance admin. */
export const setupStatusSchema = z.object({
  /** Token or session good enough to see and change the settings. */
  authorized: z.boolean(),
  /** The first account (the instance admin) exists; from then on only that admin may come here. */
  hasAccount: z.boolean(),
  /** At least one login works (Microsoft, Google, SSO or e-mail). */
  loginConfigured: z.boolean(),
  /** Only when authorized. */
  settings: z
    .object({
      /** `SLIDER_URL`, the public address. */
      url: z.string(),
      /** `automatic`: the server restarts itself after saving; `manual`: restart it yourself. */
      restart: z.enum(['automatic', 'manual']),
      /** To copy into the app registrations at Microsoft, Google and the SSO provider. */
      redirectUris: z.object({ microsoft: z.string(), google: z.string(), oidc: z.string() }),
      fields: z.record(setupKeySchema, setupFieldSchema),
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

/** Header for the one-time setup token (the link in the server log carries it after `#token=`). */
export const SETUP_TOKEN_HEADER = 'X-Setup-Token';
