import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Workspace, WorkspaceRole } from '@slider/shared';
import type { Executor } from '../../db/client';
import { decks, workspaceMembers, workspaces, type WorkspaceRow } from '../../db/schema';
import type { AppDeps } from '../../deps';
import { badRequest } from '../../http/errors';
import { blobKeys, fileUrl } from '../../storage/blob-storage';
import { deleteDeck } from '../decks';
import {
  canCreateWorkspace,
  OWN_WORKSPACE_LIMIT_MESSAGE,
  planLimit,
  workspaceUsages,
} from '../plans';
import { requireRole, workspaceNotFound } from './roles';

/** What reading workspaces with their usage needs. */
type WorkspaceDeps = Pick<AppDeps, 'db' | 'config' | 'clock'>;

export const PERSONAL_WORKSPACE_NAME = 'Meine Organisation';

// ── Workspaces ──────────────────────────────────────────────────────────────

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'workspace';

async function uniqueSlug(db: Executor, name: string): Promise<string> {
  const base = slugify(name);
  const taken = new Set(
    (
      await db
        .select({ slug: workspaces.slug })
        .from(workspaces)
        .where(sql`${workspaces.slug} = ${base} or ${workspaces.slug} like ${`${base}-%`}`)
    ).map((row) => row.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * Founds an organisation for `userId` (BER-130: on a limited instance one per account, as long
 * as it exists). Joining
 * others by invitation is unlimited.
 */
export async function foundWorkspace(
  deps: Pick<AppDeps, 'db' | 'clock' | 'config'>,
  userId: string,
  name: string,
): Promise<WorkspaceRow> {
  return deps.db.transaction(async (tx) => {
    if (!(await canCreateWorkspace(tx, deps.config, userId)))
      throw planLimit(OWN_WORKSPACE_LIMIT_MESSAGE);
    return createWorkspace(tx, userId, name, deps.clock.now());
  });
}

/** Creates a workspace with `userId` as its creator and admin – no limits; see {@link foundWorkspace}. */
export async function createWorkspace(
  db: Executor,
  userId: string,
  name: string,
  now = new Date(),
): Promise<WorkspaceRow> {
  const [row] = await db
    .insert(workspaces)
    .values({
      id: crypto.randomUUID(),
      name,
      slug: await uniqueSlug(db, name),
      createdAt: now,
      createdBy: userId,
    })
    .returning();
  if (!row) throw new Error('Workspace insert returned no row');
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: row.id, userId, role: 'admin', createdAt: now });
  return row;
}

/**
 * The user's first workspace; creates "Meine Organisation" when they have none. Only for the dev
 * owner and the very first account, which adopts the dev owner's decks – everyone else founds or
 * joins an organisation in the onboarding (BER-130).
 */
export async function ensurePersonalWorkspace(
  db: Executor,
  userId: string,
  now = new Date(),
): Promise<string> {
  const [first] = await db
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaceMembers.createdAt))
    .limit(1);
  if (first) return first.id;
  return (await createWorkspace(db, userId, PERSONAL_WORKSPACE_NAME, now)).id;
}

/**
 * Where a new deck goes: the given workspace (member or more required), else the first one the
 * user may create decks in (old clients send no `workspaceId`).
 */
export async function resolveUploadWorkspace(
  deps: AppDeps,
  userId: string,
  workspaceId: string | undefined,
): Promise<string> {
  if (workspaceId) {
    await requireRole(
      deps.db,
      workspaceId,
      userId,
      'member',
      'Als Reviewer kannst du in dieser Organisation keine Präsentationen anlegen.',
    );
    return workspaceId;
  }
  const [first] = await deps.db
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.userId, userId), inArray(workspaceMembers.role, ['admin', 'member'])),
    )
    .orderBy(asc(workspaceMembers.createdAt))
    .limit(1);
  if (first) return first.id;
  throw badRequest('Erstelle zuerst eine Organisation oder tritt einer bei.');
}

/** Workspace rows with the caller's role → DTOs with member count, plan and usage. */
async function toWorkspaceDtos(
  deps: WorkspaceDeps,
  rows: { workspace: WorkspaceRow; role: WorkspaceRole }[],
): Promise<Workspace[]> {
  const usages = await workspaceUsages(
    deps.db,
    deps.config,
    rows.map((row) => row.workspace),
    deps.clock.now(),
  );
  return rows.map(({ workspace, role }) => {
    const usage = usages.get(workspace.id);
    if (!usage) throw new Error(`No usage for workspace ${workspace.id}`);
    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      logoUrl: workspace.logoKey ? fileUrl(workspace.logoKey) : null,
      createdAt: workspace.createdAt.toISOString(),
      role,
      memberCount: usage.members,
      plan: workspace.plan,
      usage,
    };
  });
}

/** The user's workspaces in the order they joined them. */
export async function listWorkspaces(deps: WorkspaceDeps, userId: string): Promise<Workspace[]> {
  const rows = await deps.db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaceMembers.createdAt), asc(workspaces.name));
  return toWorkspaceDtos(deps, rows);
}

export async function getWorkspace(
  deps: WorkspaceDeps,
  userId: string,
  workspaceId: string,
): Promise<Workspace> {
  const role = await requireRole(deps.db, workspaceId, userId);
  const [row] = await deps.db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!row) throw workspaceNotFound();
  const [dto] = await toWorkspaceDtos(deps, [{ workspace: row, role }]);
  if (!dto) throw workspaceNotFound();
  return dto;
}

export async function renameWorkspace(
  deps: WorkspaceDeps,
  userId: string,
  workspaceId: string,
  name: string,
): Promise<Workspace> {
  await requireRole(deps.db, workspaceId, userId, 'admin');
  await deps.db.update(workspaces).set({ name }).where(eq(workspaces.id, workspaceId));
  return getWorkspace(deps, userId, workspaceId);
}

/** PNG, JPEG or WebP by their magic bytes – the browser's `type` is not trusted. */
function logoExtension(bytes: Uint8Array): 'png' | 'jpg' | 'webp' | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  return null;
}

const LOGO_ADMIN_ONLY = 'Nur Admins können das Logo ändern.';

/** Admins only. Replaces the logo; the old file is removed after the switch. */
export async function setWorkspaceLogo(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  bytes: Uint8Array,
): Promise<Workspace> {
  await requireRole(deps.db, workspaceId, userId, 'admin', LOGO_ADMIN_ONLY);
  const extension = logoExtension(bytes);
  if (!extension) throw badRequest('Das Logo muss ein PNG-, JPEG- oder WebP-Bild sein.');
  const key = blobKeys.workspaceLogo(workspaceId, extension);
  await deps.storage.put(key, bytes);
  await replaceLogoKey(deps, workspaceId, key);
  return getWorkspace(deps, userId, workspaceId);
}

/** Admins only. Back to the monogram. */
export async function removeWorkspaceLogo(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
): Promise<Workspace> {
  await requireRole(deps.db, workspaceId, userId, 'admin', LOGO_ADMIN_ONLY);
  await replaceLogoKey(deps, workspaceId, null);
  return getWorkspace(deps, userId, workspaceId);
}

async function replaceLogoKey(deps: AppDeps, workspaceId: string, key: string | null) {
  const [row] = await deps.db
    .select({ logoKey: workspaces.logoKey })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  await deps.db.update(workspaces).set({ logoKey: key }).where(eq(workspaces.id, workspaceId));
  if (row?.logoKey) await deps.storage.delete(row.logoKey);
}

/** Admins only. Deletes every deck with its files, then the workspace (members, invites). */
export async function deleteWorkspace(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
): Promise<void> {
  await requireRole(
    deps.db,
    workspaceId,
    userId,
    'admin',
    'Nur Admins können eine Organisation löschen.',
  );
  const deckRows = await deps.db
    .select({ id: decks.id })
    .from(decks)
    .where(eq(decks.workspaceId, workspaceId));
  for (const deck of deckRows) await deleteDeck(deps, deck.id);
  await deps.storage.deletePrefix(blobKeys.workspacePrefix(workspaceId));
  await deps.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
}
