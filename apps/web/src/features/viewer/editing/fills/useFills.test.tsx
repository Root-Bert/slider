import { act, renderHook } from '@testing-library/react';
import type { EditableElement, FillLayer } from '@slider/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFillRefresh, useSetFills } from './useFills';

const mocks = vi.hoisted(() => ({
  deckId: 'a',
  apply: vi.fn(),
  upload: vi.fn(),
  bake: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ useUploadEditImage: () => ({ mutateAsync: mocks.upload }) }));
vi.mock('../../state/viewer-data', () => ({
  useViewerData: () => ({ deck: { id: mocks.deckId } }),
}));
vi.mock('../../state/viewer-toast', () => ({ useViewerToast: () => vi.fn() }));
vi.mock('../editing-context', () => ({
  useEditing: () => ({ apply: mocks.apply, pageSize: { width: 16, height: 9 } }),
}));
vi.mock('./bake-fills', () => ({ bakeFills: mocks.bake, rememberUpload: vi.fn() }));

const element = {
  id: 'sl1',
  bbox: { x: 0, y: 0, w: 0.5, h: 0.5 },
} as EditableElement;
const solid: FillLayer[] = [{ type: 'solid', color: '#ff0000', opacity: 1, visible: true }];
const composite: FillLayer[] = [
  { type: 'image', src: 'picture', fit: 'fill', opacity: 1, visible: true },
];
let finish: (file: File) => void;
beforeEach(() => {
  vi.useFakeTimers();
  mocks.deckId = 'a';
  mocks.apply.mockReset().mockResolvedValue(true);
  mocks.upload.mockReset().mockResolvedValue({ imageId: 'uploaded' });
  mocks.bake.mockReset().mockImplementation(
    () =>
      new Promise<File>((resolve) => {
        finish = resolve;
      }),
  );
});
afterEach(() => vi.useRealTimers());

it('does not start an obsolete queued bake after another controls instance replaces it', async () => {
  const first = renderHook(() => useSetFills());
  const second = renderHook(() => useSetFills());
  let pending!: Promise<void>;
  act(() => {
    pending = first.result.current(element, composite);
  });
  await act(async () => {
    await second.result.current(element, solid);
  });
  await act(async () => {
    vi.advanceTimersByTime(350);
    await pending;
  });
  expect(mocks.bake).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.apply).toHaveBeenCalledTimes(1);
});

it('does not let a resize bake overwrite a newer fill from another controls instance', async () => {
  const first = renderHook(() => useSetFills());
  const second = renderHook(() => useSetFills());
  let pending!: Promise<void>;
  act(() => {
    pending = first.result.current(element, composite);
  });
  await act(async () => {
    vi.advanceTimersByTime(350);
  });
  await act(async () => {
    await second.result.current(element, solid);
  });
  await act(async () => {
    finish(new File([], 'fill.png'));
    await pending;
  });
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.apply).toHaveBeenCalledTimes(1);
});

it('keeps identical element ids in different decks independent', async () => {
  const first = renderHook(() => useSetFills());
  let pending!: Promise<void>;
  act(() => {
    pending = first.result.current(element, composite);
  });
  await act(async () => {
    vi.advanceTimersByTime(350);
  });
  mocks.deckId = 'b';
  const second = renderHook(() => useSetFills());
  await act(async () => {
    await second.result.current(element, solid);
  });
  await act(async () => {
    finish(new File([], 'fill.png'));
    await pending;
  });
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(mocks.apply).toHaveBeenCalledTimes(2);
});

it('retries a resize refresh after a manual bake using the earlier size finishes', async () => {
  const manual = renderHook(() => useSetFills());
  let pending!: Promise<void>;
  act(() => {
    pending = manual.result.current(element, composite);
  });
  await act(async () => {
    vi.advanceTimersByTime(350);
  });
  const resized = {
    ...element,
    bbox: { ...element.bbox, w: 0.8 },
    look: { fills: composite, fillAspect: 16 / 9 },
  } as EditableElement;
  const refresh = renderHook(() => useFillRefresh(resized));
  await act(async () => {
    vi.advanceTimersByTime(350);
  });
  expect(mocks.bake).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish(new File([], 'fill.png'));
    await pending;
  });
  await act(async () => {
    vi.advanceTimersByTime(350);
  });
  expect(mocks.bake).toHaveBeenCalledTimes(2);
  // Settle the refresh too so no background work survives this test.
  await act(async () => {
    finish(new File([], 'resized.png'));
  });
  refresh.unmount();
});
