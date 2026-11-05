import type { Slide } from '@slider/shared';

/*
 * How long each slide was on while presenting – counted on the stopwatch (`show-sync.ts`), so
 * only while it runs – and the drawn boxes' fading.
 */

/** From `at` (stopwatch time, ms) on, `slideId` was shown (`null`: the end screen). */
export interface SlideMark {
  slideId: string | null;
  at: number;
}

/** Each slide's time on screen, summed over its visits, up to `total` (the stopwatch's end). */
export function slideDurations(marks: readonly SlideMark[], total: number): Map<string, number> {
  const times = new Map<string, number>();
  marks.forEach((mark, i) => {
    if (mark.slideId === null) return;
    const until = Math.min(total, marks[i + 1]?.at ?? total);
    const spent = Math.max(0, until - mark.at);
    times.set(mark.slideId, (times.get(mark.slideId) ?? 0) + spent);
  });
  return times;
}

export interface ShowSummaryRow {
  slide: Slide;
  /** 1-based, as the show counted it. */
  number: number;
  ms: number;
  /** Never on screen while presenting. */
  skipped: boolean;
}

/** The overview after the show: every slide shown in it, its time, which were never on. */
export function showSummaryRows(
  slides: readonly Slide[],
  marks: readonly SlideMark[],
  total: number,
): ShowSummaryRow[] {
  const times = slideDurations(marks, total);
  const seen = new Set(marks.map((mark) => mark.slideId));
  return slides.map((slide, i) => ({
    slide,
    number: i + 1,
    ms: times.get(slide.id) ?? 0,
    skipped: !seen.has(slide.id),
  }));
}

/** How long a drawn box stays: seconds, or until the slide changes. */
export type BoxStay = 2 | 5 | 10 | 30 | 'slide';
export const BOX_STAYS: readonly BoxStay[] = [2, 5, 10, 30, 'slide'];
export const DEFAULT_BOX_STAY: BoxStay = 5;
/** The fade at the end of a box's stay. */
export const BOX_FADE_MS = 600;

/** A box drawn while presenting, in shares of the slide; `until`: when it is gone (ms epoch). */
export interface ShowBox {
  id: string;
  slideId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  until: number | null;
}

/** How visible a box is at `now`: 1 until its fade, 0 once gone. */
export function boxOpacity(box: ShowBox, now: number): number {
  if (box.until === null) return 1;
  return Math.max(0, Math.min(1, (box.until - now) / BOX_FADE_MS));
}

export const parseBoxStay = (value: unknown): BoxStay =>
  BOX_STAYS.includes(value as BoxStay) ? (value as BoxStay) : DEFAULT_BOX_STAY;
