import { act, render } from '@testing-library/react';
import { createRef, memo } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AccountAuthor } from '@slider/shared';
import { slide } from '../lib/test-fixtures';
import { ViewerStoreProvider } from './ViewerStoreProvider';
import { useSlideZoom, useViewerStore } from './viewer-store';
import { useZoomToggle } from '../timeline/hooks/useZoomToggle';
import { useViewerDispatch, useViewerState } from './viewer-state';
import { deriveViewerData } from './viewer-data';
import { useTimelineWheel } from '../timeline/hooks/useTimelineWheel';
import { computeTrackGeometry } from '../timeline/lib/timeline-layout';

afterEach(() => vi.unstubAllGlobals());

it('draws only the moved slide during zoom and resets views when frames or revisions change', () => {
  const slides = [slide('s1', 0), slide('s2', 1)];
  const owner: AccountAuthor = { id: 'a1', name: 'Test', type: 'owner', color: 'blue' };
  const data = deriveViewerData(
    {
      id: 'd1',
      workspaceId: 'w1',
      title: 'Test',
      fileName: 'test.odp',
      source: 'upload',
      owner,
      createdAt: '2026-11-05T12:00:00Z',
      updatedAt: '2026-11-05T12:00:00Z',
      archivedAt: null,
      revisionNumber: 1,
      slideCount: slides.length,
      openCommentCount: 0,
      thumbnailUrl: null,
      participants: [],
      import: { status: 'ready' },
      permissions: { canManage: true, canComment: true },
    },
    slides,
    [],
    { kind: 'owner', author: owner },
  );
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const scrollerRef = createRef<HTMLDivElement>();
  const anchorRef = { current: null };
  const geometry = computeTrackGeometry({
    aspectRatios: [16 / 9],
    viewportW: 1200,
    viewportH: 800,
    controlsH: 100,
    narrow: false,
  });
  let store!: ReturnType<typeof useViewerStore>;
  let dispatch!: ReturnType<typeof useViewerDispatch>;
  let unrelatedRenders = 0;
  const renders = { s1: 0, s2: 0 };
  const Unrelated = memo(function Unrelated() {
    useViewerState();
    unrelatedRenders++;
    return null;
  });
  const Picture = memo(function Picture({ id }: { id: keyof typeof renders }) {
    const zoom = useSlideZoom(id);
    renders[id]++;
    return <output data-slide={id}>{zoom?.scale ?? 1}</output>;
  });
  function Controls() {
    store = useViewerStore();
    useZoomToggle(true);
    useTimelineWheel({ scrollerRef, anchorRef, geometry, enabled: true });
    dispatch = useViewerDispatch();
    return null;
  }
  const children = (
    <>
      <Controls />
      <div ref={scrollerRef}>
        <div
          data-slide-frame="s1"
          ref={(node) => {
            if (node) node.getBoundingClientRect = () => new DOMRect(100, 100, 600, 300);
          }}
        />
      </div>
      {Array.from({ length: 13 }, (_, key) => (
        <Unrelated key={key} />
      ))}
      <Picture id="s1" />
      <Picture id="s2" />
    </>
  );
  const { container, rerender } = render(
    <ViewerStoreProvider data={data} initialSlideId="s1">
      {children}
    </ViewerStoreProvider>,
  );
  const set = (
    slideId: string,
    zoom: { slideId: string; scale: number; x: number; y: number } | null,
  ) => dispatch({ type: 'slideZoomChanged', slideId, zoom });
  const get = (id: string) => store.getState().slideZooms.get(id) ?? null;
  const twice = () =>
    act(() => {
      for (let tap = 0; tap < 2; tap++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
        window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
      }
    });
  const before = { unrelated: unrelatedRenders, ...renders };
  for (let frame = 0; frame < 60; frame++) {
    act(() => set('s1', { slideId: 's1', scale: 2 + frame / 100, x: 0, y: 0 }));
  }
  expect(unrelatedRenders).toBe(before.unrelated);
  expect(renders.s2).toBe(before.s2);
  expect(renders.s1 - before.s1).toBe(60);
  expect(container.querySelector('[data-slide="s1"]')?.textContent).toBe('2.59');
  act(() => set('s1', { ...get('s1')! }));
  expect(renders.s1 - before.s1).toBe(60);

  // Keyboard reset and restore retain the exact view without a broad render on zoom frames.
  twice();
  expect(get('s1')).toBeNull();
  twice();
  expect(get('s1')?.scale).toBe(2.59);

  act(() => dispatch({ type: 'wideFramesToggled' }));
  expect(get('s1')).toBeNull();
  expect(container.querySelector('[data-slide="s1"]')?.textContent).toBe('1');

  const frame = container.querySelector('[data-slide-frame]')!;
  const paint = () =>
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(0));
    });
  const wheel = (options: WheelEventInit) => {
    // happy-dom's WheelEvent omits modifier/delta fields; provide the browser event contract.
    const event = Object.assign(new Event('wheel', { bubbles: true, cancelable: true }), {
      clientX: 400,
      clientY: 250,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      deltaX: 0,
      deltaY: 0,
      deltaMode: 0,
      ...options,
    });
    act(() => {
      frame.dispatchEvent(event);
    });
    return event;
  };
  const unrelatedBeforeGestures = unrelatedRenders;
  // Real wheel handlers accumulate across frames even though the timeline does not re-render.
  expect(wheel({ ctrlKey: true, deltaY: -20 }).defaultPrevented).toBe(true);
  paint();
  const firstScale = get('s1')!.scale;
  expect(firstScale).toBeGreaterThan(1);
  wheel({ ctrlKey: true, deltaY: -20 });
  paint();
  const gestureStart = get('s1')!.scale;
  expect(gestureStart).toBeGreaterThan(firstScale);
  const gesture = (type: string, scale: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { scale, clientX: 400, clientY: 250 });
    act(() => {
      frame.dispatchEvent(event);
    });
    return event;
  };
  // Safari reports scale relative to gesturestart, rather than an incremental wheel delta.
  gesture('gesturestart', 1);
  gesture('gesturechange', 1.1);
  paint();
  expect(get('s1')!.scale).toBeCloseTo(gestureStart * 1.1);
  gesture('gesturechange', 1.2);
  paint();
  expect(get('s1')!.scale).toBeCloseTo(gestureStart * 1.2);
  gesture('gestureend', 1.2);
  const left = get('s1')!.x;
  wheel({ deltaX: 20 });
  paint();
  expect(get('s1')!.x).toBeGreaterThan(left);
  expect(unrelatedRenders).toBe(unrelatedBeforeGestures);
  act(() => set('s1', null));
  expect(wheel({ deltaX: 20 }).defaultPrevented).toBe(false);

  act(() => {
    set('s1', { slideId: 's1', scale: 2, x: 0, y: 0 });
    set('s2', { slideId: 's2', scale: 3, x: 0, y: 0 });
  });
  const next = { ...data, slides: [slides[1]!], slideIndex: new Map([['s2', 0]]) };
  rerender(
    <ViewerStoreProvider data={next} initialSlideId="s1">
      {children}
    </ViewerStoreProvider>,
  );
  expect(get('s1')).toBeNull();
  expect(get('s2')?.scale).toBe(3);
});
