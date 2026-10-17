import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildThreads } from '../../comments/lib/comment-selectors';
import { comment } from '../../lib/test-fixtures';
import { usePreviousView } from './usePreviousView';

const [thread] = buildThreads([comment({ slideId: 's1' })]);
const versions = {
  data: undefined as unknown,
  isError: false,
  isFetching: false,
};
const dispatch = vi.fn();
const showToast = vi.fn();

vi.mock('@/lib/api', () => ({ useSlideVersions: () => versions }));
vi.mock('../../state/viewer-data', () => ({
  useViewerData: () => ({
    deck: { id: 'd1', currentRevisionId: 'r2' },
    threadById: new Map([[thread!.id, thread]]),
  }),
}));
vi.mock('../../state/revision-data', () => ({
  // The slide changed after the comment was written.
  useRevisionData: () => ({ modifiedAt: new Map([['s1', '2030-01-01T00:00:00.000Z']]) }),
}));
vi.mock('../../state/viewer-state', () => ({
  useViewerState: () => ({ previousView: { slideId: 's1', threadId: thread!.id } }),
  useViewerDispatch: () => dispatch,
}));
vi.mock('../../state/viewer-toast', () => ({ useViewerToast: () => showToast }));

beforeEach(() => {
  Object.assign(versions, { data: undefined, isError: false, isFetching: true });
  dispatch.mockClear();
  showToast.mockClear();
});

describe('usePreviousView', () => {
  it('is loading while the versions are fetched', () => {
    const { result } = renderHook(() => usePreviousView());
    expect(result.current).toMatchObject({ slideId: 's1', version: undefined });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('closes with a toast when the versions cannot be loaded, instead of "Alt …" for good', () => {
    Object.assign(versions, { isError: true, isFetching: false });
    const { result } = renderHook(() => usePreviousView());
    expect(result.current).toBeNull();
    expect(dispatch).toHaveBeenCalledWith({ type: 'previousViewSet', view: null });
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('alte Version'), 'danger');
  });

  it('waits while a failed request is tried again', () => {
    Object.assign(versions, { isError: true, isFetching: true });
    renderHook(() => usePreviousView());
    expect(dispatch).not.toHaveBeenCalled();
  });
});
