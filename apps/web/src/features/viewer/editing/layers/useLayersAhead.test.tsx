import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SlideLayers } from '@slider/shared';
import { useLayersAhead } from './useLayersAhead';
import { layerFrames } from '../live/layer-frames';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  seq: 1,
  x: 0.1,
  slides: [{ id: 'slide' }],
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ fetchQuery: mocks.fetch }),
}));
vi.mock('@/lib/api', () => ({ slideLayersQuery: () => ({}), isStandInSlide: () => false }));
vi.mock('../../state/viewer-data', () => ({
  useViewerData: () => ({ deck: { id: 'deck' }, slides: mocks.slides }),
}));
vi.mock('../../state/viewer-state', () => ({
  useViewerState: () => ({ activeSlideId: 'slide' }),
}));
vi.mock('../editing-context', () => ({
  useEditing: () => ({
    available: true,
    state: {
      seq: mocks.seq,
      slides: [
        {
          slideId: 'slide',
          elements: [
            { id: 'sl1', bbox: { x: mocks.x, y: 0, w: 0.4, h: 0.3 }, rotation: 0, flip: null },
          ],
        },
      ],
    },
  }),
}));
afterEach(() => vi.useRealTimers());

it('captures prefetched geometry even when an edit cancelled the original run before it finished', async () => {
  vi.useFakeTimers();
  mocks.seq = 1;
  mocks.x = 0.1;
  let finish!: (data: SlideLayers) => void;
  mocks.fetch.mockReturnValue(
    new Promise<SlideLayers>((resolve) => {
      finish = resolve;
    }),
  );
  const { rerender } = renderHook(() => useLayersAhead());
  await act(async () => {
    vi.advanceTimersByTime(0);
  });
  mocks.seq = 2;
  mocks.x = 0.7;
  rerender();
  const pictures: SlideLayers = { seq: 1, background: '/background', layers: [] };
  await act(async () => {
    finish(pictures);
  });
  // Neither rendering surface saw step 1. The prefetch must have saved its original frame.
  expect(layerFrames(pictures, { seq: 2, slides: [] }, 'slide')?.get('sl1')?.bbox.x).toBe(0.1);
});
