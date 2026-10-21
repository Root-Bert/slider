import { z } from 'zod';

/**
 * Google Drive as a source (BER-119). Slider asks Google only for `drive.file`: it sees the files
 * a person picks in Google's own file picker page (BER-158), nothing else of their Drive. Tokens
 * stay on the server.
 */

/** `GET /me/google` – a Google account connected for file access. */
export const googleConnectionSchema = z.object({
  id: z.string(),
  /** The Google address, for display; `null` if Google did not tell. */
  account: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  /** Reviews that keep themselves up to date through this account. */
  deckCount: z.number().int(),
  /** Google refused its sign-in (access removed, expired): connect it again. */
  needsReconnect: z.boolean(),
});
export type GoogleConnection = z.infer<typeof googleConnectionSchema>;

/** `POST /decks/google-item` – a file picked in Google's picker. */
export const importGoogleItemInputSchema = z.object({
  connectionId: z.string().min(1).max(100),
  fileId: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .max(200),
  /** Omitted → the first workspace the user may create decks in. */
  workspaceId: z.string().max(100).optional(),
});
export type ImportGoogleItemInput = z.infer<typeof importGoogleItemInputSchema>;

/** Google Slides – exported as PowerPoint for the import. */
export const GOOGLE_SLIDES_MIME = 'application/vnd.google-apps.presentation';
