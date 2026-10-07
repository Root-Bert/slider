import { createHash } from 'node:crypto';
import { and, eq, notExists } from 'drizzle-orm';
import { clamp01, type Rect, type Shape } from '@slider/shared';
import type { ParsedShape } from '@slider/pptx';
import type { Executor } from '../db/client';
import { comments, slides, slideVersions } from '../db/schema';

/** SHA-256 as lower-case hex. */
export const sha256Hex = (data: Uint8Array | string): string =>
  createHash('sha256').update(data).digest('hex');

/**
 * Deletes slides of the deck that belong to no revision any more – but never a slide that has
 * comments: `comments.slide_id` cascades, and comments must never disappear (BER-109).
 */
export async function deleteOrphanSlides(db: Executor, deckId: string): Promise<void> {
  const versions = db
    .select({ id: slideVersions.id })
    .from(slideVersions)
    .where(eq(slideVersions.slideId, slides.id));
  const commented = db
    .select({ id: comments.id })
    .from(comments)
    .where(eq(comments.slideId, slides.id));
  await db
    .delete(slides)
    .where(and(eq(slides.deckId, deckId), notExists(versions), notExists(commented)));
}

export function toShape(shape: ParsedShape): Shape {
  return { id: shape.id, name: shape.name, bbox: clampRect(shape.bbox), text: shape.text };
}

/** Shapes may hang off the slide; anchors only live on it. */
function clampRect(rect: Rect): Rect {
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  return {
    x,
    y,
    w: Math.max(0, Math.min(rect.w - (x - rect.x), 1 - x)),
    h: Math.max(0, Math.min(rect.h - (y - rect.y), 1 - y)),
  };
}
