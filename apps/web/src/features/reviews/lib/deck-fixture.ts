import type { Author, Deck } from '@slider/shared';

/** Test helper: a ready deck with sensible defaults. Only imported by `*.test.ts`. */
export const owner: Author = {
  id: 'u1',
  name: 'Robert Hofmann',
  type: 'owner',
  color: 'blue',
  avatarUrl: null,
};

export function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    workspaceId: 'w1',
    title: 'Q4 Strategie',
    fileName: 'Q4 Strategie.pptx',
    source: 'onedrive',
    owner,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    archivedAt: null,
    revisionNumber: 1,
    slideCount: 12,
    openCommentCount: 0,
    thumbnailUrl: null,
    participants: [],
    import: { status: 'ready' },
    permissions: { canManage: true, canComment: true },
    ...overrides,
  };
}
