import { describe, expect, it, vi } from 'vitest';
import { layoutTrack } from '../lib/timeline-layout';
import { createStageRegistry } from './stage-registry';

const ids = Array.from({ length: 12 }, (_, i) => `s${i + 1}`);
const layout = layoutTrack(
  ids.map(() => 16 / 9),
  518,
);

function setup(snap = false) {
  const registry = createStageRegistry();
  const scroller = { scrollLeft: 0, clientWidth: 1440, scrollTo: vi.fn() };
  registry.setScroller(scroller as unknown as HTMLElement);
  registry.setLayout({ layout, slideIndex: new Map(ids.map((id, i) => [id, i])), snap });
  return { registry, scroller };
}

describe('stage registry reveal', () => {
  it('scrolls an off-screen slide into view with a margin, smoothly by default', () => {
    const { registry, scroller } = setup();
    registry.revealSlide('s3');
    const slide = layout.slides[2]!;
    expect(scroller.scrollTo).toHaveBeenCalledWith({
      left: slide.x + slide.w - 1440 + 48,
      behavior: 'smooth',
    });
  });

  it('jumps instantly by setting scrollLeft and leaves visible slides alone', () => {
    const { registry, scroller } = setup();
    registry.revealSlide('s1', { behavior: 'instant' });
    expect(scroller.scrollLeft).toBe(0);
    registry.revealSlide('s9', { behavior: 'instant', align: 'center' });
    const slide = layout.slides[8]!;
    expect(scroller.scrollLeft).toBeCloseTo(slide.x + slide.w / 2 - 720, 6);
    expect(scroller.scrollTo).not.toHaveBeenCalled();
  });

  it('aligns to the start on phones (snap) and ignores unknown slides', () => {
    const { registry, scroller } = setup(true);
    registry.revealSlide('s2', { behavior: 'instant' });
    expect(scroller.scrollLeft).toBeCloseTo(layout.slides[1]!.x - 16, 6);
    registry.revealSlide('nope', { behavior: 'instant' });
    expect(scroller.scrollLeft).toBeCloseTo(layout.slides[1]!.x - 16, 6);
  });
});

describe('stage registry programmatic scrolls', () => {
  it('marks reveals as in flight until they settle or the user takes over', () => {
    const { registry } = setup();
    expect(registry.isProgrammaticScroll()).toBe(false);
    registry.revealSlide('s3');
    expect(registry.isProgrammaticScroll()).toBe(true);
    registry.noteScroll();
    expect(registry.isProgrammaticScroll()).toBe(true);
    // The scroll it interrupted ends (scrollend) – this one is still on its way.
    registry.settleProgrammaticScroll();
    expect(registry.isProgrammaticScroll()).toBe(true);
    registry.endProgrammaticScroll();
    expect(registry.isProgrammaticScroll()).toBe(false);
    // Scroll events without a programmatic scroll don't start one.
    registry.noteScroll();
    expect(registry.isProgrammaticScroll()).toBe(false);
  });

  it('expires without scrollend, and a no-op reveal marks nothing', () => {
    vi.useFakeTimers();
    try {
      const { registry, scroller } = setup();
      registry.scrollTrackTo(500);
      expect(scroller.scrollLeft).toBe(500);
      expect(registry.isProgrammaticScroll()).toBe(true);
      registry.settleProgrammaticScroll();
      expect(registry.isProgrammaticScroll()).toBe(false);
      registry.scrollTrackTo(700);
      vi.advanceTimersByTime(300);
      expect(registry.isProgrammaticScroll()).toBe(false);
      registry.scrollTrackTo(700);
      expect(registry.isProgrammaticScroll()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
