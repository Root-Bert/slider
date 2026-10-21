import type { CSSProperties } from 'react';
import { cn } from '@/ui';
import type { SlideSketch } from '../lib/import-skeleton';
import { STAGE_TONE } from './stage-tones';

/** One piece of sketched content, in % of the slide so it scales with the track. */
interface Part {
  tone: 'bar' | 'soft' | 'dot';
  box: readonly [left: number, top: number, width: number, height: number];
}

const TITLE: Part = { tone: 'bar', box: [7, 10, 44, 7] };

/** The pieces in the order they are drawn: title first, then top to bottom, left to right. */
const PARTS: Record<SlideSketch, readonly Part[]> = {
  cover: [
    { tone: 'bar', box: [24, 38, 52, 9] },
    { tone: 'soft', box: [32, 53, 36, 4] },
  ],
  bullets: [
    TITLE,
    ...[64, 52, 70, 42].flatMap((width, i): Part[] => [
      { tone: 'dot', box: [8, 31.5 + i * 12, 1.6, 2.8] },
      { tone: 'soft', box: [12, 31 + i * 12, width, 3.8] },
    ]),
  ],
  chart: [
    TITLE,
    ...[26, 38, 32, 50, 44, 60].map((height, i): Part => ({
      tone: 'bar',
      box: [8 + i * 7.4, 86 - height, 5, height],
    })),
    ...[30, 24, 28].map((width, i): Part => ({ tone: 'soft', box: [60, 34 + i * 11, width, 3.8] })),
  ],
  columns: [
    TITLE,
    { tone: 'soft', box: [7, 28, 41, 60] },
    { tone: 'bar', box: [11, 36, 22, 5] },
    { tone: 'soft', box: [52, 28, 41, 60] },
    { tone: 'bar', box: [56, 36, 22, 5] },
  ],
};

const TONE: Record<Part['tone'], string> = {
  bar: cn('rounded-mark', STAGE_TONE.sketchBar),
  soft: cn('rounded-mark', STAGE_TONE.sketchSoft),
  dot: cn('rounded-full', STAGE_TONE.sketchBar),
};

/**
 * Abstract slide content. Every piece is its own element (`data-part`, `--k` = its place in the
 * drawing order), so the stage's choreography can build the slide up piece by piece.
 */
export function Sketch({ kind }: { kind: SlideSketch }) {
  return PARTS[kind].map(({ tone, box: [left, top, width, height] }, k) => (
    <span
      key={k}
      data-part
      className={cn('absolute', TONE[tone])}
      style={
        {
          left: `${left}%`,
          top: `${top}%`,
          width: `${width}%`,
          height: `${height}%`,
          '--k': k,
        } as CSSProperties
      }
    />
  ));
}
