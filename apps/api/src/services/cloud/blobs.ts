import { eq, inArray } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { cloudNodes, cloudVersions, deckMaterials } from '../../db/schema';
import { blobKeys } from '../../storage/blob-storage';
import type { BlobDeletion } from '../blob-deletions';

/**
 * A presentation's own file (`blobKeys.pptx`): its file in Cloud points at it instead of holding
 * a copy (`followDeckFile`). Such bytes are Slider's – Cloud never deletes or counts them.
 */
export const isDeckKey = (key: string) => key.startsWith('decks/');

/**
 * Every byte of these files – read before their rows go. A file's versions, small pictures and
 * PDFs lie under its own prefix; a version that arrived as an upload of the same name was stored
 * before it was known whose it is, under a key of its own, so those are named one by one.
 */
export async function fileBlobs(
  db: Executor,
  workspaceId: string,
  fileIds: readonly string[],
): Promise<BlobDeletion[]> {
  const deletions: BlobDeletion[] = [];
  for (let at = 0; at < fileIds.length; at += 500) {
    const ids = fileIds.slice(at, at + 500);
    const versions = await db
      .select({ nodeId: cloudVersions.nodeId, key: cloudVersions.storageKey })
      .from(cloudVersions)
      .where(inArray(cloudVersions.nodeId, ids));
    for (const id of ids) {
      deletions.push({
        store: 'storage',
        key: blobKeys.cloudNodePrefix(workspaceId, id),
        prefix: true,
      });
    }
    for (const version of versions) {
      if (isDeckKey(version.key)) continue;
      if (!version.key.startsWith(blobKeys.cloudNodePrefix(workspaceId, version.nodeId))) {
        deletions.push({ store: 'storage', key: version.key, prefix: false });
      }
    }
    // A text document's board „Material“: its files lie in the media store, the rows go with
    // the document.
    const boards = await db
      .selectDistinct({ documentId: deckMaterials.documentId })
      .from(deckMaterials)
      .where(inArray(deckMaterials.documentId, ids));
    deletions.push(...boardBlobs(boards));
  }
  return deletions;
}

const boardBlobs = (rows: readonly { documentId: string | null }[]): BlobDeletion[] =>
  rows.flatMap(({ documentId }) =>
    documentId
      ? [{ store: 'media', key: blobKeys.documentMaterialsPrefix(documentId), prefix: true }]
      : [],
  );

/** The files on the boards of all of a workspace's text documents – read before it is deleted. */
export async function workspaceBoardBlobs(
  db: Executor,
  workspaceId: string,
): Promise<BlobDeletion[]> {
  const boards = await db
    .selectDistinct({ documentId: deckMaterials.documentId })
    .from(deckMaterials)
    .innerJoin(cloudNodes, eq(cloudNodes.id, deckMaterials.documentId))
    .where(eq(cloudNodes.workspaceId, workspaceId));
  return boardBlobs(boards);
}
