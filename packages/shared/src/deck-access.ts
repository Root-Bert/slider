import { z } from 'zod';

/**
 * Who may open a review. Unrestricted (the default), every member of its workspace may; restricted,
 * only the listed accounts – plus the deck's owner and the workspace admins, who can never be
 * locked out. The source's own sharing (OneDrive, SharePoint, Nextcloud) still applies on top.
 */
export const deckAccessSchema = z.object({
  restricted: z.boolean(),
  /** Accounts allowed besides the owner and the admins; ignored while `restricted` is false. */
  userIds: z.array(z.string().min(1).max(100)).max(500),
});
export type DeckAccess = z.infer<typeof deckAccessSchema>;

/** `PUT /decks/:deckId/access` (managers and admins): replaces the whole list. */
export const updateDeckAccessInputSchema = deckAccessSchema;
export type UpdateDeckAccessInput = z.infer<typeof updateDeckAccessInputSchema>;
