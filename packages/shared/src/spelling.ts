import { z } from 'zod';

/*
 * The spell check's own words: a word one said is right („Passt so“ on a misspelt word) goes
 * into the account's dictionary (`/me/words`) and into the workspace's of the deck
 * (`/workspaces/:id/words`) – both shown under „Wörter“ in the Bibliothek. A word either
 * knows is no longer marked.
 */

/** Longer is no word but a pasted sentence. */
export const SPELLING_WORD_MAX_LENGTH = 64;
/** Per account and per workspace – a dictionary, not a store. */
export const SPELLING_WORDS_MAX = 5000;

export const spellingWordInputSchema = z.object({
  word: z
    .string()
    .trim()
    .min(2, 'Ein Wort hat mindestens zwei Zeichen.')
    .max(SPELLING_WORD_MAX_LENGTH, 'Das ist zu lang für ein Wort.')
    .refine((word) => !/\s/.test(word), 'Bitte nur ein Wort, ohne Leerzeichen.'),
});
export type SpellingWordInput = z.infer<typeof spellingWordInputSchema>;

export const spellingWordSchema = z.object({
  word: z.string(),
  createdAt: z.string(),
  /** Workspace words: who said it is right; `null` once they are gone. Own words: always `null`. */
  addedBy: z.string().nullable(),
});
export type SpellingWord = z.infer<typeof spellingWordSchema>;
