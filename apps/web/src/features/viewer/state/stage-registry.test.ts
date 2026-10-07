import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStageRegistry } from './stage-registry';

/** Just enough of a scroll container for the registry: one slide at x=500, listeners, scrolling. */
function fakeScroller() {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const scroller = {
    scrollLeft: 0,
    scrollTo: vi.fn(),
    getBoundingClientRect: () => ({ left: 0 }),
    querySelector: () => ({ getBoundingClientRect: () => ({ left: 500 }) }),
    addEventListener: (type: string, listener: (event: Event) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => {
      listeners.get(type)?.delete(listener);
    },
    fire: (type: string, event: Partial<WheelEvent> = {}) => {
      for (const listener of listeners.get(type) ?? []) listener(event as Event);
    },
  };
  return scroller;
}

describe('stage registry scroll target', () => {
  beforeEach(() => {
    vi.stubGlobal('CSS', { escape: (value: string) => value });
    vi.stubGlobal('getComputedStyle', () => ({ scrollPaddingLeft: '32px' }));
    vi.stubGlobal('window', { onscrollend: null, setTimeout, clearTimeout });
    vi.stubGlobal('WheelEvent', class {});
  });
  afterEach(() => vi.unstubAllGlobals());

  const setup = () => {
    const registry = createStageRegistry();
    const scroller = fakeScroller();
    registry.setScroller(scroller as unknown as HTMLElement);
    return { registry, scroller };
  };

  it('remembers where a smooth scroll is heading until it ends', () => {
    const { registry, scroller } = setup();
    registry.scrollToSlide('s6');
    expect(scroller.scrollTo).toHaveBeenCalledWith({ left: 468, behavior: 'smooth' });
    expect(registry.getScrollTarget()).toBe('s6');
    scroller.fire('scrollend');
    expect(registry.getScrollTarget()).toBeNull();
  });

  it('forgets the target when the user takes over, but not on a zoom wheel', () => {
    const { registry, scroller } = setup();
    registry.scrollToSlide('s6');
    scroller.fire('wheel', { ctrlKey: false, metaKey: false });
    expect(registry.getScrollTarget()).toBeNull();

    registry.scrollToSlide('s6');
    scroller.fire('wheel', Object.assign(new WheelEvent('wheel'), { ctrlKey: true }));
    expect(registry.getScrollTarget()).toBe('s6');
  });

  it('jumps instantly by setting scrollLeft, which aborts a running smooth scroll', () => {
    const { registry, scroller } = setup();
    registry.scrollToSlide('s6');
    registry.scrollToSlide('s6', 'instant');
    expect(scroller.scrollLeft).toBe(468);
    expect(scroller.scrollTo).toHaveBeenCalledTimes(1);
    expect(registry.getScrollTarget()).toBeNull();
  });
});
