import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { DeckPermissions, Viewer, WorkspaceRole } from '@slider/shared';
import type { Executor } from '../db/client';
import { deckAccessGrants, decks, type DeckRow } from '../db/schema';
import { forbidden, notFound } from '../http/errors';
import {
  deckPermissions,
  membership,
  rolesOf,
  workspaceBlocked,
} from '../services/workspaces/roles';

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
 * Whether a deck restricted to selected accounts (`decks.restricted_at`) lets `userId` in: its
 * owner, the workspace admins and the accounts on its list always; unrestricted decks everyone.
 * `role` is the caller's role in the deck's workspace.
 */
async function passesRestriction(
  db: Executor,
  deck: DeckRow,
  userId: string,
  role: WorkspaceRole,
): Promise<boolean> {
  if (!deck.restrictedAt || role === 'admin' || deck.ownerId === userId) return true;
  const [grant] = await db
    .select({ userId: deckAccessGrants.userId })
    .from(deckAccessGrants)
    .where(and(eq(deckAccessGrants.deckId, deck.id), eq(deckAccessGrants.userId, userId)));
  return grant !== undefined;
}

/**
 * The decks a restriction doesn't keep from the caller, as a condition on `decks` – what
 * {@link deckAccess} decides per deck, for lists in one query. Membership is checked apart.
 */
export function openToViewer(access: DeckViewerAccess): SQL {
  const adminOf = [...access.roles].flatMap(([id, role]) => (role === 'admin' ? [id] : []));
  return or(
    isNull(decks.restrictedAt),
    eq(decks.ownerId, access.userId),
    adminOf.length > 0 ? inArray(decks.workspaceId, adminOf) : undefined,
    sql`exists (select 1 from ${deckAccessGrants} where ${deckAccessGrants.deckId} = ${decks.id} and ${deckAccessGrants.userId} = ${access.userId})`,
  )!;
}

/** What a deck access check reads. */
export interface DeckAccessDeps {
  db: Executor;
}

/**
 * Loads a deck the viewer may act on, with their permissions, or throws.
 * Accounts that are not members of the deck's workspace get 404 (no existence leak), and so do
 * members a restricted deck keeps out ({@link passesRestriction}); members without the right
 * get 403, and so does everyone in a blocked workspace (BER-167). There are no guests (only
 * members see decks). The workspace alone decides – also for a deck linked from OneDrive,
 * SharePoint, Nextcloud or Google Drive: Slider reads such a file with the account of whoever
 * linked it, never with the viewer's (BER-165). Narrowing it is "Zugriff einschränken".
 */
export async function deckAccess(
  { db }: DeckAccessDeps,
  viewer: Viewer,
  deckId: string,
  right: DeckRight,
): Promise<{ deck: DeckRow; permissions: DeckPermissions }> {
  const [deck] = await db.select().from(decks).where(eq(decks.id, deckId));
  if (!deck) throw deckNotFound();
  const member = await membership(db, deck.workspaceId, viewer.author.id);
  if (!member) throw deckNotFound();
  if (member.blocked) throw workspaceBlocked();
  const { role } = member;
  if (!(await passesRestriction(db, deck, viewer.author.id, role))) throw deckNotFound();
  const permissions = deckPermissions(role, deck.ownerId, viewer.author.id);
  if (right === 'own' && !permissions.canManage) {
    throw forbidden('Das dürfen nur die Person, die die Präsentation angelegt hat, und Admins.');
  }
  if (right === 'comment' && !permissions.canComment) throw forbidden(VIEWER_COMMENT_MESSAGE);
  return { deck, permissions };
}

export async function requireDeckAccess(
  deps: DeckAccessDeps,
  viewer: Viewer,
  deckId: string,
  right: DeckRight,
): Promise<DeckRow> {
  return (await deckAccess(deps, viewer, deckId, right)).deck;
}

/**
 * For routes only signed-in accounts may use (decks overview, workspaces). `kind: 'owner'` is
 * the signed-in account – what it may do is decided by workspace roles.
 */
export function requireOwner(viewer: Viewer): asserts viewer is Extract<Viewer, { kind: 'owner' }> {
  if (viewer.kind !== 'owner') throw forbidden();
}
