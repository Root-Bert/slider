import type { Point, VoiceContext, VoicePointer } from '@slider/shared';

/*
 * What was on screen while the person spoke: sampled a few times a second (the slide in front,
 * where the pointer is and on which element, what is picked), summed up per piece of speech –
 * so „das hier“ can be told from the pointer, and the slide it is about from the one in front.
 */

export interface ContextSample {
  atMs: number;
  activeSlideId: string | null;
  pointer: { slideId: string; point: Point; shapeId: string | null } | null;
  selection: { slideId: string; elementId: string } | null;
}

/** Samples kept: the last minutes are enough for any piece. */
const KEPT_MS = 3 * 60_000;
/** A piece's context reaches this far before its start and after its end. */
const LEAD_MS = 600;
const TRAIL_MS = 300;
/** Pointer places named per piece at most. */
const MAX_POINTER = 6;

export class ContextTracker {
  private samples: ContextSample[] = [];

  add(sample: ContextSample): void {
    this.samples.push(sample);
    const oldest = sample.atMs - KEPT_MS;
    while (this.samples.length > 0 && this.samples[0]!.atMs < oldest) this.samples.shift();
  }

  /** What was on screen from `startMs` to `endMs`; the latest sample when none fall in between. */
  summarize(startMs: number, endMs: number): VoiceContext {
    const from = startMs - LEAD_MS;
    const to = endMs + TRAIL_MS;
    let window = this.samples.filter((sample) => sample.atMs >= from && sample.atMs <= to);
    if (window.length === 0) window = this.samples.slice(-1);
    const slides: { slideId: string; ms: number }[] = [];
    const pointer = new Map<string, { entry: VoicePointer; x: number; y: number; n: number }>();
    for (const [index, sample] of window.entries()) {
      // A sample stands for the time until the next one.
      const next = window[index + 1];
      const ms = Math.max(
        0,
        Math.round((next?.atMs ?? Math.min(to, sample.atMs + 100)) - sample.atMs),
      );
      if (sample.activeSlideId) {
        const slide = slides.find((entry) => entry.slideId === sample.activeSlideId);
        if (slide) slide.ms += ms;
        else slides.push({ slideId: sample.activeSlideId, ms });
      }
      if (sample.pointer) {
        const key = `${sample.pointer.slideId}\u0000${sample.pointer.shapeId ?? ''}`;
        const known = pointer.get(key) ?? {
          entry: {
            slideId: sample.pointer.slideId,
            shapeId: sample.pointer.shapeId,
            point: sample.pointer.point,
            ms: 0,
          },
          x: 0,
          y: 0,
          n: 0,
        };
        known.entry.ms += ms;
        known.x += sample.pointer.point.x;
        known.y += sample.pointer.point.y;
        known.n += 1;
        pointer.set(key, known);
      }
    }
    const last = window.at(-1) ?? null;
    return {
      slides: slides.map((entry) => ({ ...entry, ms: Math.min(entry.ms, 600_000) })),
      pointer: [...pointer.values()]
        .map(({ entry, x, y, n }) => ({
          ...entry,
          ms: Math.min(entry.ms, 600_000),
          point: { x: clampUnit(x / n), y: clampUnit(y / n) },
        }))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, MAX_POINTER),
      selection: window.findLast((sample) => sample.selection)?.selection ?? null,
      activeSlideId: last?.activeSlideId ?? null,
    };
  }
}

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));
