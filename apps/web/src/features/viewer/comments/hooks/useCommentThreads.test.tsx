import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { author, comment } from '../../lib/test-fixtures';
import { buildThreads } from '../lib/comment-selectors';
import { useCommentThreads } from './useCommentThreads';

const [open, resolved] = buildThreads([comment({ status: 'open' }), comment({ status: 'done' })]);
const threads = [open!, resolved!];
const state = {
  statusFilter: 'open' as const,
  personFilter: null,
  composingThreads: new Map<string, number>(),
};

vi.mock('../../state/viewer-data', () => ({
  useViewerData: () => ({
    threads,
    threadsBySlide: new Map([['s1', threads]]),
    gapThreads: new Map(),
    slides: [{ id: 's1' }],
    slideIndex: new Map([['s1', 0]]),
    mentionedThreadIds: new Set(),
    viewer: { author: author('me') },
  }),
}));
vi.mock('../../state/viewer-state', () => ({ useViewerState: () => state }));

describe('useCommentThreads', () => {
  it('keeps a resolved thread listed while someone here is still replying to it', () => {
    const { result, rerender } = renderHook(() => useCommentThreads());
    expect(result.current.bySlide.get('s1')).toEqual([open]);

    // Someone else resolved it while a reply (or a recording) is in progress on its card.
    state.composingThreads = new Map([[resolved!.id, 1]]);
    rerender();
    expect(result.current.bySlide.get('s1')).toEqual([open, resolved]);
    // The counts stay honest.
    expect(result.current.counts).toEqual({ all: 2, open: 1, done: 1 });
  });
});
