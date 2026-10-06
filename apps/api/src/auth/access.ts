import { eq } from 'drizzle-orm';
import type { Viewer } from '@slider/shared';
import type { Executor } from '../db/client';
import { decks, type DeckRow } from '../db/schema';
import { forbidden, notFound } from '../http/errors';

/** `view` ⊂ `comment` ⊂ `own`. */
export type DeckRight = 'view' | 'comment' | 'own';

export const deckNotFound = () => notFound('Diese Präsentation gibt es nicht (mehr).');

/**
 * Loads a deck the viewer may act on, or throws.
 * Owners get 404 for other people's decks (no existence leak); guests get 403 outside their deck.
 */
export async function requireDeckAccess(
  db: Executor,
  viewer: Viewer,
  deckId: string,
  right: DeckRight,
): Promise<DeckRow> {
  if (viewer.kind === 'guest') {
    if (viewer.deckId !== deckId || right === 'own') throw forbidden();
    if (right === 'comment' && viewer.role !== 'comment') {
      throw forbidden('Mit diesem Link kannst du nur ansehen, nicht kommentieren.');
    }
  }
  const [deck] = await db.select().from(decks).where(eq(decks.id, deckId));
  if (!deck) throw deckNotFound();
  if (viewer.kind === 'owner' && deck.ownerId !== viewer.author.id) throw deckNotFound();
  return deck;
}

/** For routes that only make sense for the owner, like the deck overview. */
export function requireOwner(viewer: Viewer): asserts viewer is Extract<Viewer, { kind: 'owner' }> {
  if (viewer.kind !== 'owner') throw forbidden();
}
