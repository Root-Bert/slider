import { eq } from 'drizzle-orm';
import type { DeckPermissions, ReviewLinkRole, Viewer, WorkspaceRole } from '@slider/shared';
import type { Executor } from '../db/client';
import { decks, type DeckRow } from '../db/schema';
import { forbidden, notFound } from '../http/errors';
import { deckPermissions, getRole, rolesOf } from '../services/workspaces';

/** `view` ⊂ `comment` ⊂ `own` (= manage: rename, delete, share, new versions). */
export type DeckRight = 'view' | 'comment' | 'own';

export const deckNotFound = () => notFound('Diese Präsentation gibt es nicht (mehr).');

/**
 * Guests only look (BER-130): commenting is for members of the organisation, whatever role an
 * old review link was created with.
 */
const GUEST_PERMISSIONS: DeckPermissions = { canManage: false, canComment: false };
export const GUEST_COMMENT_MESSAGE =
  'Zum Kommentieren brauchst du ein Konto in dieser Organisation. Mit diesem Link kannst du nur ansehen.';

/** What the caller may do with decks, for `Deck.permissions` in lists. */
export type DeckViewerAccess =
  | { kind: 'guest'; role: ReviewLinkRole }
  | { kind: 'user'; userId: string; roles: ReadonlyMap<string, WorkspaceRole> };

export async function viewerAccess(db: Executor, viewer: Viewer): Promise<DeckViewerAccess> {
  if (viewer.kind === 'guest') return { kind: 'guest', role: viewer.role };
  return { kind: 'user', userId: viewer.author.id, roles: await rolesOf(db, viewer.author.id) };
}

export function permissionsFor(
  access: DeckViewerAccess | undefined,
  deck: Pick<DeckRow, 'workspaceId' | 'ownerId'>,
): DeckPermissions {
  if (!access) return { canManage: false, canComment: false };
  if (access.kind === 'guest') return GUEST_PERMISSIONS;
  return deckPermissions(access.roles.get(deck.workspaceId) ?? null, deck.ownerId, access.userId);
}

/**
 * Loads a deck the viewer may act on, with their permissions, or throws.
 * Accounts that are not members of the deck's workspace get 404 (no existence leak); members
 * without the right get 403. Guests get 403 outside their deck.
 */
export async function deckAccess(
  db: Executor,
  viewer: Viewer,
  deckId: string,
  right: DeckRight,
): Promise<{ deck: DeckRow; permissions: DeckPermissions }> {
  if (viewer.kind === 'guest') {
    if (viewer.deckId !== deckId || right === 'own') throw forbidden();
    if (right === 'comment') throw forbidden(GUEST_COMMENT_MESSAGE);
  }
  const [deck] = await db.select().from(decks).where(eq(decks.id, deckId));
  if (!deck) throw deckNotFound();
  if (viewer.kind === 'guest') {
    return { deck, permissions: GUEST_PERMISSIONS };
  }

  const role = await getRole(db, deck.workspaceId, viewer.author.id);
  if (!role) throw deckNotFound();
  const permissions = deckPermissions(role, deck.ownerId, viewer.author.id);
  if (right === 'own' && !permissions.canManage) {
    throw forbidden('Das dürfen nur die Person, die die Präsentation angelegt hat, und Admins.');
  }
  if (right === 'comment' && !permissions.canComment) throw forbidden();
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
