import type { DeletedSlide } from '@slider/shared';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RevisionProvider } from './RevisionProvider';

const deleted = vi.hoisted(() => ({
  current: { data: undefined as DeletedSlide[] | undefined, isPlaceholderData: false },
}));
const dispatch = vi.fn();

vi.mock('@/lib/api', () => ({
  useDeckStatus: () => ({ data: undefined }),
  useDeletedSlides: () => deleted.current,
  useInvalidateRevision: () => vi.fn(),
  useInvalidateSlideImages: () => vi.fn(),
  useLatestDiff: () => ({ data: undefined }),
  useRevisionDiffs: () => [],
  useRevisions: () => ({ data: undefined }),
}));
vi.mock('./viewer-data', () => ({
  useViewerData: () => ({
    deck: { id: 'd1', currentRevisionId: 'r2', revisionNumber: 2, sync: null, source: 'upload' },
    slides: [],
    threads: [],
  }),
}));
vi.mock('./viewer-state', () => ({ useViewerDispatch: () => dispatch }));

const close = { type: 'deletedPanelSet', open: false };
const tree = (
  <RevisionProvider>
    <span />
  </RevisionProvider>
);

beforeEach(() => {
  dispatch.mockClear();
});

describe('RevisionProvider', () => {
  it('closes the deleted-slides panel once the current revision has no deleted slides left', () => {
    deleted.current = { data: [], isPlaceholderData: false };
    render(tree);
    expect(dispatch).toHaveBeenCalledWith(close);
  });

  it('keeps it while the list loads or still lists slides', () => {
    deleted.current = { data: undefined, isPlaceholderData: false };
    const { rerender } = render(tree);
    // The previous revision's list, shown while the new one loads, says nothing yet.
    deleted.current = { data: [], isPlaceholderData: true };
    rerender(tree);
    deleted.current = { data: [{ slideId: 'gone' } as DeletedSlide], isPlaceholderData: false };
    rerender(tree);
    expect(dispatch).not.toHaveBeenCalledWith(close);
  });
});
