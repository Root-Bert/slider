import { inArray } from 'drizzle-orm';
import type { DeckPlace } from '@slider/shared';
import { cloudNodes, type DeckRow } from '../db/schema';
import type { Executor } from '../db/client';
import { ancestorsOf, baseAccess, cloudContext } from './cloud/context';

/**
 * Where each presentation lies in the files, in words – as far as `userId` sees that place: an
 * area they are in, or their own files. One they only reach through the presentation's own
 * access says nothing: the folders above it are not theirs to read.
 */
export async function deckPlaceWords(
  db: Executor,
  userId: string,
  rows: readonly Pick<DeckRow, 'id' | 'workspaceId' | 'cloudNodeId'>[],
): Promise<Map<string, DeckPlace>> {
  const placed = rows.filter((row) => row.cloudNodeId);
  const result = new Map<string, DeckPlace>();
  if (placed.length === 0) return result;
  const nodes = await db
    .select()
    .from(cloudNodes)
    .where(
      inArray(
        cloudNodes.id,
        placed.flatMap((row) => (row.cloudNodeId ? [row.cloudNodeId] : [])),
      ),
    );
  const nodeOf = new Map(nodes.map((node) => [node.id, node]));
  const contexts = new Map<string, Awaited<ReturnType<typeof cloudContext>>>();
  // Presentations in one folder share the way up to it.
  const above = new Map<string, string[]>();
  for (const row of placed) {
    const node = row.cloudNodeId ? nodeOf.get(row.cloudNodeId) : undefined;
    if (!node) continue;
    let ctx = contexts.get(row.workspaceId);
    if (!ctx) {
      ctx = await cloudContext(db, row.workspaceId, userId);
      contexts.set(row.workspaceId, ctx);
    }
    if (!baseAccess(ctx, node)) continue;
    let folders: string[] = [];
    if (node.parentId) {
      const known = above.get(node.parentId);
      folders = known ?? (await ancestorsOf(db, node)).reverse().map((each) => each.name);
      above.set(node.parentId, folders);
    }
    const top = node.areaId ? (ctx.areas.get(node.areaId)?.row.name ?? '') : 'Meine Dateien';
    result.set(row.id, {
      words: [top, ...folders].filter(Boolean).join(' › '),
      folderId: node.parentId,
      areaId: node.areaId,
    });
  }
  return result;
}
