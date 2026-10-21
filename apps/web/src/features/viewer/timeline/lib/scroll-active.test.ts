import { describe, expect, it } from 'vitest';
import { ACTIVE_HYSTERESIS_PX, focusX, pickActiveSlide } from './scroll-active';
import { layoutTrack } from './timeline-layout';

const Q4 = Array.from({ length: 12 }, () => 16 / 9);
/** Small slides: 160px wide, 24px gaps, 184px apart from x = 16; content 2240px wide. */
const small = layoutTrack(Q4, 90);
/** Desktop default: ~981px slides, 88px gaps. */
const large = layoutTrack(Q4, 552);

const centre = (index: number, layout = small) =>
  layout.slides[index]!.x + layout.slides[index]!.w / 2;

function pick(
  layout: typeof small,
  scrollLeft: number,
  viewportW: number,
  current: number | null = null,
) {
  return pickActiveSlide({
    slides: layout.slides,
    scrollLeft,
    viewportW,
    maxScroll: layout.contentW - viewportW,
    current,
  });
}

describe('focusX', () => {
  it('sits at the left third of the viewport away from the ends', () => {
    expect(focusX(600, 900, 2000)).toBe(900);
  });

  it('moves in from the left edge at the start and out to the right edge at the end', () => {
    expect(focusX(0, 900, 2000)).toBe(0);
    expect(focusX(100, 900, 2000)).toBe(200);
    expect(focusX(2000, 900, 2000)).toBe(2900);
    expect(focusX(1700, 900, 2000)).toBe(1700 + 600);
  });
});

describe('pickActiveSlide', () => {
  it('picks the slide whose centre is closest to the left third', () => {
    // Focus at 600 + 600 / 3 = 800: slide 4 (centre 832; slide 3 at 648).
    expect(pick(small, 600, 600)).toBe(4);
    // Big slides: once the second slide fills most of the view it is active.
    expect(pick(large, 0, 1440)).toBe(0);
    expect(pick(large, 700, 1440)).toBe(1);
  });

  it('is the first slide at the very start and the last at the very end', () => {
    expect(pick(small, 0, 1000, 7)).toBe(0);
    expect(pick(small, 1, 1000, 7)).toBe(0);
    const max = small.contentW - 1000;
    expect(pick(small, max, 1000, 3)).toBe(11);
    expect(pick(small, max - 1, 1000, 3)).toBe(11);
  });

  it('moves smoothly away from the start instead of jumping to the left third', () => {
    // A few px in, the focus is still on the first slides – not on slide 2 at x ≈ 333.
    expect(pick(small, 20, 1000, 0)).toBe(0);
    expect(pick(small, 120, 1000, 0)).toBe(1);
  });

  it('keeps the current slide near a boundary (hysteresis)', () => {
    // Midpoint between slide 4 and 5 centres; focus = scrollLeft + 600 / 3.
    const boundary = (centre(4) + centre(5)) / 2 - 600 / 3;
    // Just past the midpoint: slide 5 is closer, but not by the margin – slide 4 stays.
    expect(pick(small, boundary + 5, 600, 4)).toBe(4);
    expect(pick(small, boundary - 5, 600, 5)).toBe(5);
    // Without a current slide the closest wins.
    expect(pick(small, boundary + 5, 600)).toBe(5);
    // Clearly past the margin the next slide takes over.
    expect(pick(small, boundary + ACTIVE_HYSTERESIS_PX / 2 + 1, 600, 4)).toBe(5);
  });

  it('switches to a far slide even from a stale current one', () => {
    expect(pick(small, 600, 600, 11)).toBe(4);
  });

  it('handles empty decks, unscrollable tracks and unknown current slides', () => {
    expect(
      pickActiveSlide({ slides: [], scrollLeft: 0, viewportW: 900, maxScroll: 0, current: null }),
    ).toBeNull();
    // Everything fits: scrolling decides nothing.
    expect(pick(small, 0, 3000, 6)).toBe(6);
    expect(pick(small, 0, 3000, null)).toBe(0);
    expect(pick(small, 600, 600, 42)).toBe(4);
  });

  it('follows a phone-sized track slide by slide', () => {
    const phone = layoutTrack(Q4, 343 / (16 / 9));
    const step = phone.slides[1]!.x - phone.slides[0]!.x;
    for (let i = 1; i < 11; i++) expect(pick(phone, i * step, 375, i - 1)).toBe(i);
  });
});
