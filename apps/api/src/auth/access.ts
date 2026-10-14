import { eq } from 'drizzle-orm';
import type { DeckPermissions, Viewer, WorkspaceRole } from '@slider/shared';
import type { Executor } from '../db/client';
import { decks, type DeckRow } from '../db/schema';
import { forbidden, notFound } from '../http/errors';
import { deckPermissions, getRole, rolesOf } from '../services/workspaces';

/** `view` ⊂ `comment` ⊂ `own` (= manage: rename, delete, share, new versions). */
export type DeckRight = 'view' | 'comment' | 'own';

export const VIEWER_COMMENT_MESSAGE =
  'Als Betrachter kannst du nur ansehen. Zum Kommentieren braucht es eine andere Rolle in der Organisation.';

export const deckNotFound = () => notFound('Diese Präsentation gibt es nicht (mehr).');

/** What the caller may do with decks, for `Deck.permissions` in lists. */
export type DeckViewerAccess = {
  kind: 'user';
  userId: string;
  roles: ReadonlyMap<string, WorkspaceRole>;
};

export async function viewerAccess(db: Executor, viewer: Viewer): Promise<DeckViewerAccess> {
  return { kind: 'user', userId: viewer.author.id, roles: await rolesOf(db, viewer.author.id) };
}

export function permissionsFor(
  access: DeckViewerAccess | undefined,
  deck: Pick<DeckRow, 'workspaceId' | 'ownerId'>,
): DeckPermissions {
  if (!access) return { canManage: false, canComment: false };
  return deckPermissions(access.roles.get(deck.workspaceId) ?? null, deck.ownerId, access.userId);
}

/**
 * Loads a deck the viewer may act on, with their permissions, or throws.
 * Accounts that are not members of the deck's workspace get 404 (no existence leak); members
 * without the right get 403. There are no guests (only members see decks).
 */
export async function deckAccess(
  db: Executor,
  viewer: Viewer,
  deckId: string,
  right: DeckRight,
): Promise<{ deck: DeckRow; permissions: DeckPermissions }> {
  const [deck] = await db.select().from(decks).where(eq(decks.id, deckId));
  if (!deck) throw deckNotFound();
  const role = await getRole(db, deck.workspaceId, viewer.author.id);
  if (!role) throw deckNotFound();
  const permissions = deckPermissions(role, deck.ownerId, viewer.author.id);
  if (right === 'own' && !permissions.canManage) {
    throw forbidden('Das dürfen nur die Person, die die Präsentation angelegt hat, und Admins.');
  }
  if (right === 'comment' && !permissions.canComment) throw forbidden(VIEWER_COMMENT_MESSAGE);
  return { deck, permissions };
}

export async function requireDeckAccess(
  db: Executor,
  viewer: Viewer,
  deckId: string,
  right: DeckRight,
): Promise<DeckRow> {
  return (await deckAccess(db, viewer, deckId, right)).deck;
}

/**
 * For routes only signed-in accounts may use (decks overview, workspaces). `kind: 'owner'` is
 * the signed-in account – what it may do is decided by workspace roles.
 */
export function requireOwner(viewer: Viewer): asserts viewer is Extract<Viewer, { kind: 'owner' }> {
  if (viewer.kind !== 'owner') throw forbidden();
}
