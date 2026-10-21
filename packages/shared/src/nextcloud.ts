import { z } from 'zod';

/**
 * Nextcloud as a source (BER-135): accounts connected with Login Flow v2, a file browser the API
 * proxies (Nextcloud has no embeddable picker) and the import of a picked file. The app password
 * never leaves the server.
 */

/** `GET /me/nextcloud` – a Nextcloud account connected for file access. */
export const nextcloudConnectionSchema = z.object({
  id: z.string(),
  /** Where the Nextcloud lives (`https://cloud.example.de`, or with the path it runs under). */
  server: z.string(),
  /** The login name at that Nextcloud, for display. */
  account: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  /** Reviews that keep themselves up to date through this account. */
  deckCount: z.number().int(),
  /** Nextcloud refused the app password (revoked in its settings): connect it again. */
  needsReconnect: z.boolean(),
});
export type NextcloudConnection = z.infer<typeof nextcloudConnectionSchema>;

/** `GET /nextcloud/settings` – the organisation's Nextcloud from `/einrichtung`, if any. */
export const nextcloudSettingsSchema = z.object({
  /** Set: people connect this one and type no address. */
  server: z.string().nullable(),
});
export type NextcloudSettings = z.infer<typeof nextcloudSettingsSchema>;

/** `POST /nextcloud/login` – without a fixed server, the address the person typed. */
export const startNextcloudLoginInputSchema = z.object({
  server: z.string().trim().max(500).optional(),
});
export type StartNextcloudLoginInput = z.infer<typeof startNextcloudLoginInputSchema>;

export const nextcloudLoginStartSchema = z.object({
  /** Asked for with `POST /nextcloud/login/:id/poll` until the login is done. */
  id: z.string(),
  /** Nextcloud's login page – opened in a popup; SSO and MFA happen there. */
  loginUrl: z.string(),
  /**
   * Sign-in only: the code Nextcloud's grant page shows next to "Slider" – it must match the one
   * the asking window shows, else someone else started the request.
   */
  code: z.string().optional(),
});
export type NextcloudLoginStart = z.infer<typeof nextcloudLoginStartSchema>;

export const nextcloudLoginPollSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('done'), connection: nextcloudConnectionSchema }),
  /** Not finished within Nextcloud's 20 minutes, or already picked up: start again. */
  z.object({ status: z.literal('expired') }),
]);
export type NextcloudLoginPoll = z.infer<typeof nextcloudLoginPollSchema>;

/**
 * `POST /auth/nextcloud/flow` – sign in with any Nextcloud (or, signed in with `intent: 'connect'`,
 * add it as a login on /konto). Answers with a {@link NextcloudLoginStart}.
 */
export const startNextcloudSignInInputSchema = z.object({
  server: z.string().trim().min(1).max(500),
  returnTo: z.string().max(2000).optional(),
  intent: z.enum(['login', 'connect']).optional(),
});
export type StartNextcloudSignInInput = z.infer<typeof startNextcloudSignInInputSchema>;

/** `POST /auth/nextcloud/flow/:id/poll` */
export const nextcloudSignInPollSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('expired') }),
  /** Signed in (session cookie set), linked, or refused: the browser goes to `redirectTo`. */
  z.object({ status: z.literal('done'), redirectTo: z.string() }),
  /** A new account: a confirmation link went to `email`; the account exists once it is used. */
  z.object({ status: z.literal('confirm'), email: z.string() }),
]);
export type NextcloudSignInPoll = z.infer<typeof nextcloudSignInPollSchema>;

/** `POST /auth/nextcloud/confirm` – the token from the confirmation mail. Answers a LoginResult. */
export const confirmNextcloudSignUpInputSchema = z.object({ token: z.string().min(1).max(4000) });
export type ConfirmNextcloudSignUpInput = z.infer<typeof confirmNextcloudSignUpInputSchema>;

/** A file or folder in the Nextcloud browser. */
export const nextcloudEntrySchema = z.object({
  fileId: z.string(),
  name: z.string(),
  /** Relative to the person's files, starting with `/`. */
  path: z.string(),
  folder: z.boolean(),
  sizeBytes: z.number().int().nullable(),
  modifiedAt: z.iso.datetime().nullable(),
  /** Nextcloud can draw a thumbnail (`GET /nextcloud/:id/preview/:fileId`). */
  preview: z.boolean(),
});
export type NextcloudEntry = z.infer<typeof nextcloudEntrySchema>;

/** `GET /nextcloud/:connectionId/files?path=`, `/shared`, `/search?q=` – folders and `.pptx` only. */
export const nextcloudListingSchema = z.object({
  /** The folder listed; `null` for "Mit mir geteilt" and search results. */
  path: z.string().nullable(),
  entries: z.array(nextcloudEntrySchema),
});
export type NextcloudListing = z.infer<typeof nextcloudListingSchema>;

/** `POST /decks/nextcloud-item` – a `.pptx` picked in the Nextcloud browser. */
export const importNextcloudItemInputSchema = z.object({
  connectionId: z.string().min(1).max(100),
  fileId: z.string().regex(/^\d+$/).max(30),
  /** Omitted → the first workspace the user may create decks in. */
  workspaceId: z.string().max(100).optional(),
});
export type ImportNextcloudItemInput = z.infer<typeof importNextcloudItemInputSchema>;

/** `DELETE /me/nextcloud/:id` – `revoked: false`: Nextcloud was unreachable, remove it there. */
export const disconnectNextcloudResultSchema = z.object({ revoked: z.boolean() });
export type DisconnectNextcloudResult = z.infer<typeof disconnectNextcloudResultSchema>;
