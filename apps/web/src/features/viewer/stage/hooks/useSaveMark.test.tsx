import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSaveMark } from './useSaveMark';

const update = { mutateAsync: vi.fn() };
const showToast = vi.fn();

vi.mock('@/lib/api', () => ({ useUpdateComment: () => update }));
vi.mock('../../state/viewer-toast', () => ({ useViewerToast: () => showToast }));

beforeEach(() => {
  update.mutateAsync.mockReset();
  showToast.mockClear();
});

describe('useSaveMark', () => {
  it('ends the drag once stored, without a message', async () => {
    update.mutateAsync.mockResolvedValue({});
    const done = vi.fn();
    const { result } = renderHook(() => useSaveMark('d1'));
    result.current({ commentId: 'c1', move: { dx: 0.1, dy: 0 } }, done);
    await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(update.mutateAsync).toHaveBeenCalledWith({ commentId: 'c1', move: { dx: 0.1, dy: 0 } });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('says why a mark snapped back when the save failed', async () => {
    update.mutateAsync.mockRejectedValue(new Error('Keine Berechtigung'));
    const done = vi.fn();
    const { result } = renderHook(() => useSaveMark('d1'));
    result.current({ commentId: 'c1', move: { dx: 0.1, dy: 0 } }, done);
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith('Keine Berechtigung', 'danger'));
    expect(done).toHaveBeenCalledOnce();
  });
});
