import type { Slide } from '@slider/shared';
import type { ShowBox } from './show-times';

/*
 * The presenter view (notes, next slide, timer) in one window and the audience's slide show in
 * another, kept on the same step over a BroadcastChannel per deck: either one moves, the other
 * follows; either one ends, both end.
 */

/** The search parameter that opens a deck's viewer as the audience's window. */
export const AUDIENCE_PARAM = 'present';
export const AUDIENCE_VALUE = 'audience';

export type ShowMessage =
  /** Where the show is now: a slide (`null` with `ended`: the end screen), black or not. */
  | { type: 'at'; slideId: string | null; ended: boolean; black: boolean }
  /** The audience's window just opened: tell it where the show is. */
  | { type: 'hello' }
  /** A box drawn on the slide (`show-times.ts`). */
  | { type: 'box'; box: ShowBox }
  /** The drawn boxes cleared. */
  | { type: 'clear' }
  /** The audience's window was closed (it can be opened again). */
  | { type: 'gone' }
  /** The show is over. */
  | { type: 'end' };

/**
 * Posted by the presenter view to the audience's window with the right to go fullscreen handed
 * over (capability delegation, where the browser has it): it then fills its screen.
 */
export const FULLSCREEN_MESSAGE = 'slider-show:fullscreen';

export const showChannelName = (deckId: string) => `slider-show:${deckId}`;

/** A message from the channel, or `null` for anything else. */
export function parseShowMessage(data: unknown): ShowMessage | null {
  if (!data || typeof data !== 'object') return null;
  const message = data as Record<string, unknown>;
  if (
    message.type === 'hello' ||
    message.type === 'gone' ||
    message.type === 'end' ||
    message.type === 'clear'
  )
    return { type: message.type };
  if (message.type === 'box') {
    const box = message.box as Record<string, unknown> | null;
    const share = (value: unknown) => typeof value === 'number' && value >= 0 && value <= 1;
    if (
      box &&
      typeof box.id === 'string' &&
      typeof box.slideId === 'string' &&
      share(box.x) &&
      share(box.y) &&
      share(box.w) &&
      share(box.h) &&
      (box.until === null || typeof box.until === 'number')
    ) {
      const { id, slideId, x, y, w, h, until } = box as unknown as ShowBox;
      return { type: 'box', box: { id, slideId, x, y, w, h, until } };
    }
    return null;
  }
  if (
    message.type === 'at' &&
    (typeof message.slideId === 'string' || message.slideId === null) &&
    typeof message.ended === 'boolean' &&
    typeof message.black === 'boolean'
  ) {
    return { type: 'at', slideId: message.slideId, ended: message.ended, black: message.black };
  }
  return null;
}

/** Step `index` of `slides` (`slides.length`: the end screen) as a message. */
export function atMessage(slides: readonly Slide[], index: number, black: boolean): ShowMessage {
  const ended = index >= slides.length;
  return { type: 'at', slideId: ended ? null : (slides[index]?.id ?? null), ended, black };
}

/** The step a message stands for in `slides`; `null`: a slide this window does not show. */
export function atIndex(
  slides: readonly Slide[],
  message: Extract<ShowMessage, { type: 'at' }>,
): number | null {
  if (message.ended) return slides.length;
  const index = slides.findIndex((slide) => slide.id === message.slideId);
  return index < 0 ? null : index;
}

/** The presenter's stopwatch: time gathered before, and since when it runs (`null`: paused). */
export interface Stopwatch {
  gathered: number;
  since: number | null;
}

export const stopwatchStarted = (now: number): Stopwatch => ({ gathered: 0, since: now });

export const stopwatchElapsed = (watch: Stopwatch, now: number) =>
  watch.gathered + (watch.since === null ? 0 : Math.max(0, now - watch.since));

/** Paused, or running again from where it stood. */
export const stopwatchToggled = (watch: Stopwatch, now: number): Stopwatch =>
  watch.since === null
    ? { gathered: watch.gathered, since: now }
    : { gathered: stopwatchElapsed(watch, now), since: null };

/** Back to 0, running or paused as it was. */
export const stopwatchReset = (watch: Stopwatch, now: number): Stopwatch => ({
  gathered: 0,
  since: watch.since === null ? null : now,
});

/** „4:05“, „1:02:03“ past an hour. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}
