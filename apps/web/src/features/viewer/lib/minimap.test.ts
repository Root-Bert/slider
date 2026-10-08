import { describe, expect, it } from 'vitest';
import {
  BRACKET_MIN_W,
  EDGE_MAX_SPEED,
  EDGE_ZONE,
  edgeScrollSpeed,
  bracketFor,
  followScrollLeft,
  layoutMinimap,
  minimapAsTrack,
  scrollLeftForBracket,
  THUMB_GAP,
  THUMB_GAP_MAX,
  THUMB_MAX_H_NARROW,
} from './minimap';
import { layoutTrack } from './timeline-layout';

const deck = (n: number) => Array.from({ length: n }, () => 16 / 9);

describe('minimap thumbnails', () => {
  it('uses the Figma size when the deck fits', () => {
    const mini = layoutMinimap(deck(4), 1376);
    expect(mini.h).toBe(64);
    expect(mini.slides[0]!.w).toBe(114);
    expect(mini.slides[1]!.x).toBe(114 + THUMB_GAP_MAX);
    expect(mini.contentW).toBe(4 * 114 + 3 * THUMB_GAP_MAX);
    expect(mini.scrolls).toBe(false);
  });

  it('widens the gaps so a capped row ends flush with the right edge', () => {
    // 16 slides at 1968px: thumbnails stop at 64px high, 31px are left over.
    const mini = layoutMinimap(deck(16), 1968);
    expect(mini.h).toBe(64);
    expect(mini.gap).toBeGreaterThan(THUMB_GAP);
    expect(mini.gap).toBeLessThanOrEqual(THUMB_GAP_MAX);
    expect(mini.contentW).toBeCloseTo(1968);
  });

  it('shrinks the thumbnails so the whole deck fits the width', () => {
    const mini = layoutMinimap(deck(12), 1376);
    expect(mini.h).toBeLessThan(64);
    expect(mini.slides[0]!.w).toBeGreaterThanOrEqual(64);
    expect(mini.contentW).toBeCloseTo(1376);
    expect(mini.scrolls).toBe(false);
  });

  it('floors thumbnails at 64px wide and scrolls instead', () => {
    const mini = layoutMinimap(deck(120), 1376);
    expect(mini.slides[0]!.w).toBeGreaterThanOrEqual(64);
    expect(mini.slides[0]!.w).toBeLessThan(70);
    expect(mini.scrolls).toBe(true);
    expect(mini.contentW).toBeGreaterThan(1376);
  });

  it('caps the height on phones and keeps mixed aspect ratios', () => {
    const mini = layoutMinimap([16 / 9, 4 / 3], 1000, THUMB_MAX_H_NARROW);
    expect(mini.h).toBe(40);
    expect(mini.slides[0]!.w).toBe(71);
    expect(mini.slides[1]!.w).toBe(53);
  });

  it('handles an empty deck', () => {
    expect(layoutMinimap([], 500)).toMatchObject({ slides: [], contentW: 0, scrolls: false });
  });
});

describe('viewport bracket', () => {
  const track = layoutTrack(deck(12), 300);
  const mini = minimapAsTrack(layoutMinimap(deck(12), 1376));

  it('frames exactly the slides in view', () => {
    const second = track.slides[1]!;
    const third = track.slides[2]!;
    const bracket = bracketFor(track, mini, second.x, third.x + third.w - second.x);
    expect(bracket.left).toBeCloseTo(mini.slides[1]!.x, 6);
    expect(bracket.left + bracket.width).toBeCloseTo(mini.slides[2]!.x + mini.slides[2]!.w, 6);
    expect(bracket.all).toBe(false);
  });

  it('maps a point inside a slide to the same fraction of its thumbnail', () => {
    const slide = track.slides[5]!;
    const thumb = mini.slides[5]!;
    const bracket = bracketFor(track, mini, slide.x + slide.w * 0.25, slide.w * 0.5);
    expect(bracket.left).toBeCloseTo(thumb.x + thumb.w * 0.25, 6);
    expect(bracket.width).toBeCloseTo(thumb.w * 0.5, 6);
  });

  it('stays inside the row at both ends and keeps a minimum width', () => {
    const start = bracketFor(track, mini, 0, 500);
    expect(start.left).toBe(0);
    const end = bracketFor(track, mini, track.contentW - 500, 500);
    expect(end.left + end.width).toBeCloseTo(mini.contentW, 6);
    const tiny = bracketFor(track, mini, track.contentW - 2, 2);
    expect(tiny.width).toBe(BRACKET_MIN_W);
    expect(tiny.left + tiny.width).toBeCloseTo(mini.contentW, 6);
  });

  it('reports when the whole track is in view', () => {
    expect(bracketFor(track, mini, 0, track.contentW).all).toBe(true);
  });

  it('round-trips: dragging the bracket centre scrolls the track back to it', () => {
    const viewportW = 1000;
    const scrollLeft = track.slides[4]!.x + 37;
    const bracket = bracketFor(track, mini, scrollLeft, viewportW);
    const back = scrollLeftForBracket(track, mini, bracket.left + bracket.width / 2, viewportW);
    // The centre maps exactly; edges may differ only through the piecewise-linear gaps.
    expect(Math.abs(back - scrollLeft)).toBeLessThan(track.gaps[0]!.w);
  });

  it('clamps dragging to the track ends', () => {
    expect(scrollLeftForBracket(track, mini, -50, 1000)).toBe(0);
    expect(scrollLeftForBracket(track, mini, mini.contentW + 50, 1000)).toBe(track.contentW - 1000);
  });
});

describe('following the bracket', () => {
  it('leaves the row alone while the bracket is in view', () => {
    expect(followScrollLeft(300, 100, 200, 600, 2000)).toBe(200);
  });
  it('scrolls the bracket into view with a margin', () => {
    expect(followScrollLeft(900, 100, 200, 600, 2000)).toBe(900 + 100 - 600 + 24);
    expect(followScrollLeft(100, 100, 200, 600, 2000)).toBe(100 - 24);
  });
  it('aligns a bracket wider than the row to its start and clamps', () => {
    expect(followScrollLeft(500, 700, 0, 600, 2000)).toBe(476);
    expect(followScrollLeft(10, 50, 200, 600, 2000)).toBe(0);
  });
});

describe('edge auto-scroll while dragging', () => {
  const row = { left: 100, right: 1100 };
  it('does nothing away from the edges', () => {
    expect(edgeScrollSpeed(600, row)).toBe(0);
    expect(edgeScrollSpeed(100 + EDGE_ZONE, row)).toBe(0);
  });
  it('scrolls towards the edge, faster closer to it', () => {
    expect(edgeScrollSpeed(110, row)).toBeLessThan(0);
    expect(edgeScrollSpeed(1090, row)).toBeGreaterThan(0);
    expect(edgeScrollSpeed(1095, row)).toBeGreaterThan(edgeScrollSpeed(1080, row));
  });
  it('caps the speed past the edge', () => {
    expect(edgeScrollSpeed(2000, row)).toBe(EDGE_MAX_SPEED);
    expect(edgeScrollSpeed(-500, row)).toBe(-EDGE_MAX_SPEED);
  });
  it('shrinks the zone for a narrow row', () => {
    expect(edgeScrollSpeed(150, { left: 100, right: 200 })).toBe(0);
  });
});
