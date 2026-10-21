import { and, asc, eq } from 'drizzle-orm';
import type { DeckFolder } from '@slider/shared';
import type { Executor } from '../db/client';
import { deckFolders, type DeckFolderRow } from '../db/schema';
import { notFound } from '../http/errors';
import { requireRole } from './workspaces/roles';

/** Members and up sort decks into folders; viewers and reviewers only see them. */
const FOLDER_ROLE = 'member';
const FOLDER_RIGHTS_MESSAGE = 'Ordner verwalten dürfen Mitglieder und Admins.';

const folderNotFound = () => notFound('Diesen Ordner gibt es nicht (mehr).');

export const toFolderDto = (row: DeckFolderRow): DeckFolder => ({
  id: row.id,
  workspaceId: row.workspaceId,
  name: row.name,
  createdAt: row.createdAt.toISOString(),
});

/** The workspace's folders, by name. */
export async function listFolders(
  db: Executor,
  userId: string,
  workspaceId: string,
): Promise<DeckFolder[]> {
  await requireRole(db, workspaceId, userId);
  const rows = await db
    .select()
    .from(deckFolders)
    .where(eq(deckFolders.workspaceId, workspaceId))
    .orderBy(asc(deckFolders.name));
  return rows.map(toFolderDto);
}

export async function createFolder(
  db: Executor,
  userId: string,
  workspaceId: string,
  name: string,
  now: Date,
): Promise<DeckFolder> {
  await requireRole(db, workspaceId, userId, FOLDER_ROLE, FOLDER_RIGHTS_MESSAGE);
  const [row] = await db
    .insert(deckFolders)
    .values({ id: crypto.randomUUID(), workspaceId, name, createdBy: userId, createdAt: now })
    .returning();
  if (!row) throw new Error('Folder insert returned nothing');
  return toFolderDto(row);
}

/** The folder, if it belongs to that workspace – for moving a deck into it. */
export async function findFolder(
  db: Executor,
  workspaceId: string,
  folderId: string,
): Promise<DeckFolderRow> {
  const [row] = await db
    .select()
    .from(deckFolders)
    .where(and(eq(deckFolders.id, folderId), eq(deckFolders.workspaceId, workspaceId)));
  if (!row) throw folderNotFound();
  return row;
}

async function requireFolder(db: Executor, userId: string, folderId: string) {
  const [row] = await db.select().from(deckFolders).where(eq(deckFolders.id, folderId));
  if (!row) throw folderNotFound();
  await requireRole(db, row.workspaceId, userId, FOLDER_ROLE, FOLDER_RIGHTS_MESSAGE);
  return row;
}

export async function renameFolder(
  db: Executor,
  userId: string,
  folderId: string,
  name: string,
): Promise<DeckFolder> {
  await requireFolder(db, userId, folderId);
  const [row] = await db
    .update(deckFolders)
    .set({ name })
    .where(eq(deckFolders.id, folderId))
    .returning();
  if (!row) throw folderNotFound();
  return toFolderDto(row);
}

/** Deletes the folder only; its decks stay, outside any folder (`on delete set null`). */
export async function deleteFolder(db: Executor, userId: string, folderId: string): Promise<void> {
  await requireFolder(db, userId, folderId);
  await db.delete(deckFolders).where(eq(deckFolders.id, folderId));
}
