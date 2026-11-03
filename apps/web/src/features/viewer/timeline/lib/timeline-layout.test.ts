import { describe, expect, it } from 'vitest';
import {
  COLUMN_SPACING,
  columnSpans,
  computeTrackGeometry,
  slideHeightAt,
  TRACK_PAD_TOP,
  type TrackLayout,
} from './timeline-layout';

// Five slides 200px wide, 20px gaps between them.
const layout: TrackLayout = {
  h: 112,
  slides: [0, 1, 2, 3, 4].map((i) => ({ x: 16 + i * 220, w: 200 })),
  gaps: [0, 1, 2, 3, 4].map((i) => ({ x: 216 + i * 220, w: 20 })),
  contentW: 16 + 5 * 220 + 16,
};
const none = () => false;

describe('columnSpans', () => {
  it('grows a column with wider cards into free room, centred, never into a neighbour’s', () => {
    // No wider cards: as wide as its slide.
    expect(columnSpans(layout, (i) => (i === 2 ? 100 : 0), none)[2]).toEqual({ x: 456, w: 200 });
    expect(columnSpans(layout, (i) => (i === 2 ? 360 : 0), none)[2]).toEqual({ x: 376, w: 360 });

    // Halfway to the next column with comments, leaving room between them.
    const apart = columnSpans(layout, (i) => (i === 0 || i === 3 ? 1000 : 0), none);
    const left = apart[0]!;
    const right = apart[3]!;
    expect(right.x - (left.x + left.w)).toBe(COLUMN_SPACING);
    expect(left.x).toBe(16);
    expect(right.x + right.w).toBe(layout.contentW - 16);

    // Never below its slide next to a neighbour.
    const close = columnSpans(layout, (i) => (i === 1 || i === 2 ? 600 : 0), none);
    expect(close[1]!.x + close[1]!.w).toBe(436);
    expect(close[2]!.x).toBe(456);

    // Clear of a gap with comments.
    const span = columnSpans(
      layout,
      (i) => (i === 2 ? 600 : 0),
      (i) => i === 2,
    )[2]!;
    expect(span.x + span.w).toBeLessThanOrEqual(layout.gaps[2]!.x);
  });
});

describe('computeTrackGeometry', () => {
  const CONTROLS_H = 120;
  const MINIMAP_H = 56;
  // What is left below the band at `split` – minimap shown or folded (its row then freed).
  const commentH = (
    viewportW: number,
    viewportH: number,
    minimap: boolean,
    split: number | null,
  ) => {
    const freedH = minimap ? 0 : MINIMAP_H;
    const geo = computeTrackGeometry({
      aspectRatios: [16 / 9],
      viewportW,
      viewportH,
      controlsH: CONTROLS_H,
      freedH,
      narrow: false,
    });
    return viewportH - (TRACK_PAD_TOP + slideHeightAt(split, geo) + CONTROLS_H - freedH);
  };

  it('lets the handle close the comment area, kept where it is when the minimap folds', () => {
    for (const [w, h] of [
      [1920, 1080],
      [1440, 900],
      [1280, 1000],
    ] as const) {
      expect(commentH(w, h, true, 1)).toBe(0);
      expect(commentH(w, h, false, 1)).toBe(0);
    }
    expect(commentH(1440, 900, false, 0.5)).toBe(commentH(1440, 900, true, 0.5));

    // The default stays within the width.
    const geo = computeTrackGeometry({
      aspectRatios: [16 / 9],
      viewportW: 1280,
      viewportH: 1400,
      controlsH: CONTROLS_H,
      narrow: false,
    });
    expect(geo.hDefault * (16 / 9)).toBeLessThanOrEqual(1280);
  });
});
