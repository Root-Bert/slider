import type { Author, Comment, Slide } from '@slider/shared';

/** Small builders for unit tests of the viewer's pure modules. */

export const author = (id: string, overrides: Partial<Author> = {}): Author => ({
  id,
  name: `Person ${id}`,
  type: 'guest',
  color: 'blue',
  avatarUrl: null,
  ...overrides,
});

let sequence = 0;

export function comment(overrides: Partial<Comment> = {}): Comment {
  sequence += 1;
  const createdAt = new Date(Date.UTC(2026, 9, 1, 12, sequence)).toISOString();
  return {
    id: `c${sequence}`,
    deckId: 'd1',
    slideId: 's1',
    parentId: null,
    author: author('a1'),
    body: 'Text',
    anchor: { type: 'point', point: { x: 0.5, y: 0.5 }, shapeRef: null },
    strokes: [],
    status: 'open',
    resolvedBy: null,
    resolvedAt: null,
    source: 'app',
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

export const slide = (id: string, position: number, overrides: Partial<Slide> = {}): Slide => ({
  id,
  deckId: 'd1',
  position,
  title: null,
  hidden: false,
  aspectRatio: 16 / 9,
  imageUrl: `/files/${id}.png`,
  thumbnailUrl: `/files/${id}-thumb.png`,
  shapes: [],
  openCommentCount: 0,
  ...overrides,
});
