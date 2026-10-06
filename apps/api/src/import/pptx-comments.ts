import { sql } from 'drizzle-orm';
import { clamp01, shapeRefAt, type Anchor, type Shape } from '@slider/shared';
import type { ParsedComment, ParsedCommentAnchor } from '@slider/pptx';
import { externalAuthor } from '../authors';
import type { Executor } from '../db/client';
import { comments, type NewCommentRow } from '../db/schema';

/** The slide a PowerPoint comment belongs to, looked up by its `sldId`. */
export interface ImportedSlide {
  slideId: string;
  shapes: Shape[];
}

/**
 * Maps PowerPoint comments (modern and legacy) onto Slider comments (BER-114).
 * Upserts on `(deck_id, source, external_id)`, so importing the same file twice
 * changes nothing. Returns the number of comments written, replies included.
 */
export async function upsertPptxComments(
  db: Executor,
  deckId: string,
  parsed: readonly ParsedComment[],
  slidesBySldId: ReadonlyMap<number, ImportedSlide>,
  now: Date,
): Promise<number> {
  let written = 0;
  for (const comment of parsed) {
    const slide = slidesBySldId.get(comment.sldId);
    if (!slide) continue;

    const parentId = await upsert(db, {
      deckId,
      slideId: slide.slideId,
      parentId: null,
      externalId: comment.externalId,
      author: externalAuthor(comment.author.name),
      body: comment.text,
      anchor: toAnchor(comment.anchor, slide.shapes),
      status: comment.status,
      createdAt: parseDate(comment.createdAt, now),
    });
    written += 1;

    for (const reply of comment.replies) {
      await upsert(db, {
        deckId,
        slideId: slide.slideId,
        parentId,
        externalId: `${comment.externalId}/${reply.externalId}`,
        author: externalAuthor(reply.author.name),
        body: reply.text,
        anchor: { type: 'slide' },
        status: 'open',
        createdAt: parseDate(reply.createdAt, now),
      });
      written += 1;
    }
  }
  return written;
}

type PptxCommentInput = Required<
  Pick<
    NewCommentRow,
    | 'deckId'
    | 'slideId'
    | 'parentId'
    | 'externalId'
    | 'author'
    | 'body'
    | 'anchor'
    | 'status'
    | 'createdAt'
  >
>;

async function upsert(db: Executor, input: PptxCommentInput): Promise<string> {
  const [row] = await db
    .insert(comments)
    .values({
      ...input,
      id: crypto.randomUUID(),
      source: 'pptx',
      strokes: [],
      updatedAt: input.createdAt,
    })
    .onConflictDoUpdate({
      target: [comments.deckId, comments.source, comments.externalId],
      // Status is left alone: resolving a comment in Slider must survive a re-import.
      set: {
        slideId: sql`excluded.slide_id`,
        parentId: sql`excluded.parent_id`,
        author: sql`excluded.author`,
        body: sql`excluded.body`,
        anchor: sql`excluded.anchor`,
      },
    })
    .returning({ id: comments.id });
  if (!row) throw new Error('Upsert returned no row');
  return row.id;
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
