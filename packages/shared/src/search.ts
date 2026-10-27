import { z } from 'zod';

/** Shorter queries find too much to be worth a search through every deck's text (BER-175). */
export const DECK_SEARCH_MIN_LENGTH = 2;
export const DECK_SEARCH_MAX_LENGTH = 100;
/** Hits listed per deck; `hitCount` still counts them all. */
export const DECK_SEARCH_HITS_PER_DECK = 3;

/**
 * Where the text was found in a deck: on a slide of its current version (its title or the text
 * of a box) or in a comment or reply. `snippet` is the text around the match, which starts at
 * `matchStart` and is `matchLength` long – the snippet's own characters, for highlighting.
 */
export const deckSearchHitSchema = z.object({
  kind: z.enum(['slide', 'comment']),
  /** The slide to open; `null` for comments between slides or on a slide no longer in the deck. */
  slideId: z.string().nullable(),
  /** 1-based number of that slide in the current version, if it is in it. */
  slideNumber: z.number().int().positive().nullable(),
  /** Who wrote the comment; `null` for slide text. */
  author: z.string().nullable(),
  snippet: z.string(),
  matchStart: z.number().int().nonnegative(),
  matchLength: z.number().int().positive(),
});
export type DeckSearchHit = z.infer<typeof deckSearchHitSchema>;

/** A deck whose text (not its title – the overview matches that itself) contains the query. */
export const deckSearchResultSchema = z.object({
  deckId: z.string(),
  hitCount: z.number().int().positive(),
  hits: z.array(deckSearchHitSchema).max(DECK_SEARCH_HITS_PER_DECK),
});
export type DeckSearchResult = z.infer<typeof deckSearchResultSchema>;

/**
 * The form both sides compare in: lower case, without accents (`é` → `e`), so "Umsatz" finds
 * "umsätze" as the title filter does.
 */
export const searchFold = (text: string): string =>
  text.toLocaleLowerCase('de').normalize('NFKD').replace(/\p{M}/gu, '');
