import { and, eq, isNull, notInArray } from 'drizzle-orm';
import {
  clamp01,
  shapeRefAt,
  type Anchor,
  type Author,
  type CommentStatus,
  type Shape,
} from '@slider/shared';
import type { ParsedComment, ParsedCommentAnchor } from '@slider/pptx';
import { externalAuthor } from '../authors';
import type { Executor } from '../db/client';
import { comments, deletedPptxComments, type CommentRow } from '../db/schema';

/** The slide a PowerPoint comment belongs to, looked up by its `sldId`. */
export interface ImportedSlide {
  slideId: string;
  shapes: Shape[];
}

/** What one import did to the PowerPoint comments of a deck (roots and replies alike). */
export interface PptxCommentCounts {
  inserted: number;
  /** Text or status changed in PowerPoint. */
  updated: number;
  /** Deleted in PowerPoint: flagged `removed_in_source_at`, never deleted. */
  removed: number;
  /** Deleted earlier, back in the file now. */
  restored: number;
  /** Comments seen in this file. */
  total: number;
}

interface Desired {
  externalId: string;
  slideId: string;
  parentExternalId: string | null;
  author: Author;
  body: string;
  anchor: Anchor;
  /** Status in PowerPoint; replies have none of their own (always `open`). */
  externalStatus: CommentStatus;
  createdAt: Date;
}

/**
 * Maps PowerPoint comments (modern and legacy) onto Slider comments, idempotently (BER-114).
 *
 * - Keyed by `(deck_id, 'pptx', external_id)`; rows are only written when something changed, so
 *   re-importing the same file leaves every row (and its `updated_at`) as it is.
 * - Status: PowerPoint wins only when the status changed *in PowerPoint* since the last import;
 *   a comment resolved in Slider stays resolved while the file still says "open".
 * - Comments missing from the file are flagged `removed_in_source_at` – never deleted, so app
 *   replies on them survive. A comment that reappears is unflagged.
 * - Comments deleted in Slider leave a tombstone (`deleted_pptx_comments`) and stay deleted.
 *
 * `slidesBySldId` maps the file's `sldId`s to Slider slides (after slide matching). Call it only
 * after the whole file parsed, ideally in the transaction that publishes the new revision.
 */
export async function upsertPptxComments(
  db: Executor,
  deckId: string,
  parsed: readonly ParsedComment[],
  slidesBySldId: ReadonlyMap<number, ImportedSlide>,
  now: Date,
): Promise<PptxCommentCounts> {
  // Deleted in Slider: never brought back, though the file still has them (replies of a deleted
  // root are skipped below, as their parent is missing).
  const tombstones = await db
    .select({ externalId: deletedPptxComments.externalId })
    .from(deletedPptxComments)
    .where(eq(deletedPptxComments.deckId, deckId));
  const deleted = new Set(tombstones.map((row) => row.externalId));
  const desired = toDesired(parsed, slidesBySldId, now).filter(
    (item) => !deleted.has(item.externalId),
  );
  const existing = await db
    .select()
    .from(comments)
    .where(and(eq(comments.deckId, deckId), eq(comments.source, 'pptx')));
  const byExternalId = new Map(existing.map((row) => [row.externalId, row]));
  const idByExternalId = new Map(existing.map((row) => [row.externalId ?? '', row.id]));
  const counts: PptxCommentCounts = {
    inserted: 0,
    updated: 0,
    removed: 0,
    restored: 0,
    total: desired.length,
  };

  // Roots come before their replies in `desired`, so parent ids are known in time.
  for (const item of desired) {
    const parentId =
      item.parentExternalId === null ? null : (idByExternalId.get(item.parentExternalId) ?? null);
    if (item.parentExternalId !== null && parentId === null) continue;
    const row = byExternalId.get(item.externalId);
    if (!row) {
      const id = await insert(db, deckId, item, parentId, now);
      idByExternalId.set(item.externalId, id);
      counts.inserted += 1;
      continue;
    }
    const change = diff(row, item, parentId, now);
    if (!change) continue;
    await db.update(comments).set(change.set).where(eq(comments.id, row.id));
    if (change.contentChanged) counts.updated += 1;
    if (change.restored) counts.restored += 1;
  }

  const seen = desired.map((item) => item.externalId);
  const removed = await db
    .update(comments)
    .set({ removedInSourceAt: now, updatedAt: now })
    .where(
      and(
        eq(comments.deckId, deckId),
        eq(comments.source, 'pptx'),
        isNull(comments.removedInSourceAt),
        ...(seen.length > 0 ? [notInArray(comments.externalId, seen)] : []),
      ),
    )
    .returning({ id: comments.id });
  counts.removed = removed.length;
  return counts;
}

function toDesired(
  parsed: readonly ParsedComment[],
  slidesBySldId: ReadonlyMap<number, ImportedSlide>,
  now: Date,
): Desired[] {
  const result: Desired[] = [];
  const seen = new Set<string>();
  const push = (item: Desired) => {
    // Duplicate ids in a broken file: the first one wins, like the unique key would.
    if (seen.has(item.externalId)) return;
    seen.add(item.externalId);
    result.push(item);
  };
  for (const comment of parsed) {
    const slide = slidesBySldId.get(comment.sldId);
    if (!slide) continue;
    push({
      externalId: comment.externalId,
      slideId: slide.slideId,
      parentExternalId: null,
      author: externalAuthor(comment.author.name),
      body: comment.text,
      anchor: toAnchor(comment.anchor, slide.shapes),
      externalStatus: comment.status,
      createdAt: parseDate(comment.createdAt, now),
    });
    for (const reply of comment.replies) {
      push({
        externalId: `${comment.externalId}/${reply.externalId}`,
        slideId: slide.slideId,
        parentExternalId: comment.externalId,
        author: externalAuthor(reply.author.name),
        body: reply.text,
        anchor: { type: 'slide' },
        externalStatus: 'open',
        createdAt: parseDate(reply.createdAt, now),
      });
    }
  }
  return result;
}

const resolution = (status: CommentStatus, now: Date) =>
  status === 'done'
    ? { status, resolvedAt: now, resolvedBy: null }
    : { status, resolvedAt: null, resolvedBy: null };

async function insert(
  db: Executor,
  deckId: string,
  item: Desired,
  parentId: string | null,
  now: Date,
): Promise<string> {
  const [row] = await db
    .insert(comments)
    .values({
      id: crypto.randomUUID(),
      deckId,
      slideId: item.slideId,
      parentId,
      author: item.author,
      body: item.body,
      anchor: item.anchor,
      strokes: [],
      ...resolution(item.externalStatus, now),
      source: 'pptx',
      externalId: item.externalId,
      externalStatus: item.externalStatus,
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
    })
    .returning({ id: comments.id });
  if (!row) throw new Error('Comment insert returned no row');
  return row.id;
}

/** The update for an existing row, or `null` when it already matches the file. */
function diff(
  row: CommentRow,
  item: Desired,
  parentId: string | null,
  now: Date,
): { set: Partial<CommentRow>; contentChanged: boolean; restored: boolean } | null {
  const set: Partial<CommentRow> = {};
  let visible = false;
  if (row.slideId !== item.slideId) set.slideId = item.slideId;
  if (row.parentId !== parentId) set.parentId = parentId;
  if (!sameJson(row.author, item.author)) set.author = item.author;
  if (!sameJson(row.anchor, item.anchor)) set.anchor = item.anchor;
  if (Object.keys(set).length > 0) visible = true;

  const bodyChanged = row.body !== item.body;
  if (bodyChanged) set.body = item.body;

  // PowerPoint wins only when its status changed since the last import. Rows from before
  // BER-114 have no external status: then only "done" in PowerPoint is taken over.
  const pptStatusChanged =
    row.externalStatus === null
      ? item.externalStatus === 'done'
      : row.externalStatus !== item.externalStatus;
  const statusChanged = pptStatusChanged && row.status !== item.externalStatus;
  if (statusChanged) Object.assign(set, resolution(item.externalStatus, now));
  if (row.externalStatus !== item.externalStatus) set.externalStatus = item.externalStatus;

  const restored = row.removedInSourceAt !== null;
  if (restored) set.removedInSourceAt = null;

  if (Object.keys(set).length === 0) return null;
  const contentChanged = bodyChanged || statusChanged;
  // Bookkeeping alone (external status recorded) does not count as an edit.
  if (contentChanged || restored || visible) set.updatedAt = now;
  return { set, contentChanged, restored };
}

/** Deep equality for JSON values, independent of key order (jsonb reorders keys). */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const bKeys = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) =>
    sameJson((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/** Object anchors become a frame around the shape that follows it across revisions (BER-115). */
export function toAnchor(anchor: ParsedCommentAnchor, shapes: readonly Shape[]): Anchor {
  switch (anchor.type) {
    case 'slide':
      return { type: 'slide' };
    case 'point': {
      const point = { x: clamp01(anchor.point.x), y: clamp01(anchor.point.y) };
      return { type: 'point', point, shapeRef: shapeRefAt(shapes, point) };
    }
    case 'shape': {
      const shape = shapes.find((candidate) => candidate.id === anchor.shapeId);
      if (!shape) return { type: 'slide' };
      return {
        type: 'rect',
        rect: shape.bbox,
        shapeRef: { shapeId: shape.id, offset: { x: 0.5, y: 0.5 } },
      };
    }
  }
}

function parseDate(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}
