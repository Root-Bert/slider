import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CursorLayer } from './CursorLayer';

const live = vi.hoisted(() => ({
  snapshot: { connected: true, peers: new Map<string, unknown>() },
  lastMoved: new Map<string, number>(),
}));
const slideBox = document.createElement('div');
const scroller = document.createElement('div');
const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
slideBox.getBoundingClientRect = () => rect(100, 100, 200, 100);
scroller.getBoundingClientRect = () => rect(0, 0, 1000, 800);

vi.mock('./lib/live-store', () => ({
  useLiveSnapshot: () => live.snapshot,
  getLiveSnapshot: () => live.snapshot,
  lastMoved: live.lastMoved,
}));
vi.mock('../state/stage-registry', () => ({
  useStageRegistry: () => ({ getScroller: () => scroller, getSlideElement: () => slideBox }),
}));
vi.mock('../state/viewer-state', () => ({
  useViewerState: () => ({ threadPanelOpen: false, deletedPanelOpen: false }),
}));
vi.mock('../hooks/useColorOverrides', () => ({ useColorOverrides: () => new Map() }));

const author = { id: 'a', name: 'Anna Beispiel', type: 'user', color: 'blue' };
const peer = (cursor: unknown) => ({ connectionId: 'p1', author, cursor });

let frames = 0;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  frames = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames += 1;
    return setTimeout(() => callback(performance.now()), 16) as unknown as number;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  live.lastMoved.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const cursorElement = () => document.querySelector<HTMLElement>('[aria-hidden] > [aria-hidden]')!;

describe('CursorLayer', () => {
  it('stops its frame loop while the others have no cursor on a slide', () => {
    live.snapshot = { connected: true, peers: new Map([['p1', peer(null)]]) };
    render(<CursorLayer />);
    advance(1_000);
    const settled = frames;
    advance(5_000);
    expect(frames).toBe(settled);
    expect(settled).toBeLessThan(40);
  });

  it('places a resting cursor, then sleeps until its name is due to fold away', () => {
    live.lastMoved.set('p1', performance.now());
    live.snapshot = {
      connected: true,
      peers: new Map([['p1', peer({ slideId: 's1', point: { x: 0.5, y: 0.5 } })]]),
    };
    render(<CursorLayer />);
    advance(1_000);
    expect(cursorElement().style.transform).toBe('translate3d(200px, 150px, 0)');
    expect(cursorElement().hasAttribute('data-visible')).toBe(true);
    expect(cursorElement().hasAttribute('data-idle')).toBe(false);
    const settled = frames;
    advance(1_000);
    expect(frames).toBe(settled);

    advance(1_500);
    expect(cursorElement().hasAttribute('data-idle')).toBe(true);
    const idle = frames;
    advance(5_000);
    expect(frames).toBe(idle);
  });

  it('wakes up for a scroll', () => {
    live.snapshot = {
      connected: true,
      peers: new Map([['p1', peer({ slideId: 's1', point: { x: 0, y: 0 } })]]),
    };
    render(<CursorLayer />);
    advance(5_000);
    slideBox.getBoundingClientRect = () => rect(50, 100, 200, 100);
    const before = frames;
    act(() => {
      document.dispatchEvent(new Event('scroll'));
    });
    advance(1_000);
    expect(frames).toBeGreaterThan(before);
    expect(cursorElement().style.transform).toBe('translate3d(50px, 100px, 0)');
  });
});
