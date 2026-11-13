import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type * as ViewerStateModule from '../state/viewer-state';
import type * as StageRegistryModule from '../state/stage-registry';
import type { ViewerData } from '../state/viewer-data';
import type { ViewerState } from '../state/viewer-types';
import { createInitialState } from '../state/viewer-reducer';
import { slide } from '../lib/test-fixtures';
import { createStageRegistry } from '../state/stage-registry';
import { visibleRange, type TrackLayout } from './lib/timeline-layout';
import { Timeline } from './Timeline';
import { useTimelineRange, type TimelineWindow } from './timeline-window';

const probe = vi.hoisted(() => ({
  data: null as unknown as ViewerData,
  state: null as unknown as ViewerState,
  registry: null as unknown as ReturnType<typeof createStageRegistry>,
  parent: 0,
  minimap: 0,
  aspects: Array.from({ length: 30 }, () => 16 / 9),
  metrics: { viewportW: 1280, clientW: 1280, viewportH: 900, controlsH: 54 },
  comments: { bySlide: new Map(), byGap: new Map() },
  editing: { available: false, active: false },
  revisions: { deletedSlides: [] },
  swipe: {
    track: 0,
    moving: false,
    reach: [],
    attachBand: () => {},
    go: () => {},
    wheel: () => false,
  },
  dispatch: () => {},
}));
vi.mock('@/ui', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  useIsNarrow: () => false,
  SelectionBox: () => null,
}));
vi.mock('react-router', () => ({ useLocation: () => ({ state: null }) }));
vi.mock('@/lib/api', () => ({ useDeckCreation: () => ({ data: null }) }));
vi.mock('@/lib/marquee-select', () => ({ useMarqueeSelect: () => ({ active: false }) }));
vi.mock('../state/viewer-data', () => ({ useViewerData: () => probe.data }));
vi.mock('../state/viewer-state', async (original) => ({
  ...(await original<typeof ViewerStateModule>()),
  useViewerState: () => probe.state,
  useViewerDispatch: () => probe.dispatch,
}));
vi.mock('../state/stage-registry', async (original) => ({
  ...(await original<typeof StageRegistryModule>()),
  useStageRegistry: () => probe.registry,
}));
vi.mock('../state/frame-format', () => ({
  useFrameAspects: () => ({ aspectRatios: probe.aspects }),
}));
vi.mock('../state/revision-data', () => ({ useRevisionData: () => probe.revisions }));
vi.mock('../editing/editing-context', () => ({ useEditing: () => probe.editing }));
vi.mock('../comments/hooks/useCommentThreads', () => ({ useCommentThreads: () => probe.comments }));
vi.mock('./hooks/useTimelineMetrics', () => ({
  useTimelineMetrics: () => {
    probe.parent++;
    return probe.metrics;
  },
}));
vi.mock('./hooks/useTrackSwipe', () => ({ useTrackSwipe: () => probe.swipe }));
vi.mock('./hooks/useFoldProgress', () => ({ useFoldProgress: () => 1 }));
vi.mock('./hooks/useHandleRoom', () => ({ useHandleRoom: () => {} }));
vi.mock('./hooks/useTimelineWheel', () => ({ useTimelineWheel: () => {} }));
vi.mock('./hooks/useHandPan', () => ({ useHandPan: () => {} }));
vi.mock('./hooks/useZoomToggle', () => ({ useZoomToggle: () => {} }));
vi.mock('./hooks/useScrollActiveSlide', () => ({ useScrollActiveSlide: () => {} }));
vi.mock('./hooks/useVariantFlow', () => ({ useVariantFlow: () => {} }));
vi.mock('../connectors/ConnectorLines', () => ({ ConnectorLines: () => null }));
vi.mock('../comments/CommentSelectionBar', () => ({ CommentSelectionBar: () => null }));
vi.mock('./VariantSheet', () => ({ VariantSheet: () => null }));
vi.mock('./Minimap', () => ({
  Minimap: () => {
    probe.minimap++;
    return null;
  },
}));
vi.mock('./SplitHandle', () => ({
  SplitHandle: ({ onDrag }: { onDrag: (value: number) => void }) => (
    <input aria-label="Test split" onChange={(event) => onDrag(Number(event.target.value))} />
  ),
}));
vi.mock('./Track', () => ({ Track: (props: WindowProps) => <Windowed {...props} name="track" /> }));
vi.mock('./CommentColumns', () => ({
  CommentColumns: (props: WindowProps) => <Windowed {...props} name="comments" />,
}));

interface WindowProps {
  layout: TrackLayout;
  window: TimelineWindow;
}
function Windowed({ layout, window: store, name }: WindowProps & { name: string }) {
  const range = useTimelineRange(store);
  return (
    <output
      data-window={name}
      data-range={`${range.first}:${range.last}`}
      style={{ height: layout.h }}
    />
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('updates the actual timeline window without rerendering its controls, including during resize anchoring', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1280);
  probe.data = {
    slides: probe.aspects.map((_, index) => slide(`s${index}`, index)),
    slideIndex: new Map(probe.aspects.map((_, index) => [`s${index}`, index])),
    variantsOf: new Map(),
    viewer: { author: { color: 'blue' } },
    deck: { id: 'deck' },
  } as unknown as ViewerData;
  probe.state = createInitialState({ activeSlideId: null });
  probe.registry = createStageRegistry();
  const { container, getByLabelText } = render(<Timeline controls={<span>Controls</span>} />);
  const scroller = container.querySelector<HTMLElement>('[data-timeline]')!;
  const assertRange = () => {
    const expected = visibleRange(probe.registry.getLayout()!.layout, scroller.scrollLeft, 1280);
    for (const output of container.querySelectorAll('[data-window]'))
      expect(output.getAttribute('data-range')).toBe(`${expected.first}:${expected.last}`);
  };
  assertRange();
  const baseline = { parent: probe.parent, minimap: probe.minimap };
  for (let step = 0; step < 60; step++) {
    fireEvent.change(getByLabelText('Test split'), {
      target: { value: String((step % 2 ? 70 - step : 10 + step) / 100) },
    });
    assertRange();
  }
  expect(probe.parent - baseline.parent).toBe(60);
  expect(probe.minimap - baseline.minimap).toBe(60);
  const afterResize = { parent: probe.parent, minimap: probe.minimap };
  act(() => {
    scroller.scrollLeft = 9000;
    scroller.dispatchEvent(new Event('scroll'));
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
  assertRange();
  expect(probe.parent).toBe(afterResize.parent);
  expect(probe.minimap).toBe(afterResize.minimap);
});
