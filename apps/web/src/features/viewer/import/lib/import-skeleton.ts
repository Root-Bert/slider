import type { ImportState } from '@slider/shared';

/**
 * What the import stage shows of the deck while it imports: the viewer's own layout (track,
 * minimap, controls row) built from placeholder slides that fill in as the import goes on.
 * Pure; the stage in `../ImportStage.tsx` animates it.
 */
export interface ImportPicture {
  /** Number of slides once the import knows it; `null` before – the track shows ghost slides. */
  count: number | null;
  /** Slides rendered so far (the first `rendered` slots are filled). */
  rendered: number;
  /** Slot being rendered right now, -1 if none. */
  current: number;
  /** PowerPoint comments are being imported (or already are): ghost comment cards appear. */
  comments: boolean;
  failed: boolean;
}

export function importPicture(state: ImportState, slideCount: number): ImportPicture {
  const known = slideCount > 0 ? slideCount : null;
  switch (state.status) {
    case 'ready':
      return { count: known, rendered: known ?? 0, current: -1, comments: true, failed: false };
    case 'failed':
      return { count: known, rendered: 0, current: -1, comments: false, failed: true };
    case 'queued':
      return { count: known, rendered: 0, current: -1, comments: false, failed: false };
    case 'running': {
      if (state.step === 'comments') {
        return { count: known, rendered: known ?? 0, current: -1, comments: true, failed: false };
      }
      if (state.step !== 'rendering') {
        return { count: known, rendered: 0, current: -1, comments: false, failed: false };
      }
      const count = state.progress?.total || known;
      const rendered = Math.min(state.progress?.done ?? 0, count ?? 0);
      return {
        count,
        rendered,
        current: count !== null && rendered < count ? rendered : -1,
        comments: false,
        failed: false,
      };
    }
  }
}

export type SlotState = 'ghost' | 'pending' | 'current' | 'rendered';

export function slotState(index: number, picture: ImportPicture): SlotState {
  if (picture.count === null) return 'ghost';
  if (index < picture.rendered) return 'rendered';
  return index === picture.current ? 'current' : 'pending';
}

/** Abstract slide content a rendered placeholder shows – a title slide first, then a mix. */
export type SlideSketch = 'cover' | 'bullets' | 'chart' | 'columns';

const BODY_SKETCHES: readonly SlideSketch[] = ['bullets', 'chart', 'bullets', 'columns'];

export const slideSketch = (index: number): SlideSketch =>
  index === 0 ? 'cover' : BODY_SKETCHES[(index * 7 + 3) % BODY_SKETCHES.length]!;

// ── Timing of the stage's intro and outro ──────────────────────────────────

/** Intro: once the slides are counted, the first `DEALT_MAX` placeholders are dealt onto the track this far apart … */
export const DEAL_STAGGER = 260;
export const DEALT_MAX = 8;
export const DEAL_MS = 1700;
/** … the minimap's thumbnails pop up behind them. */
export const CHROME_DELAY = 600;
/** The controls row builds up right away, while the page cross-fades in. */
export const CONTROLS_DELAY = 180;
/** A placeholder shows its slide rendered once it has landed (the deal eases out by then) … */
export const LAND_MS = Math.round(DEAL_MS * 0.55);
/** … one after another, this far apart at the least, each print fading in over `PRINT_MS`. */
export const PRINT_STAGGER = 140;
export const PRINT_MS = 700;
/** More slides than this rendered at once: the rest print together (they are off-screen anyway). */
export const PRINT_CASCADE_MAX = 8;
/** Outro: the real slides appear left to right this far apart; `REVEAL_MS` covers the whole outro. */
export const REVEAL_STAGGER = 300;
export const REVEAL_SLOTS_MAX = 6;
export const REVEAL_MS = 220 + REVEAL_SLOTS_MAX * REVEAL_STAGGER + 640;
/** The intro's last deal has landed by then; the outro never starts earlier. */
export const INTRO_MS = (DEALT_MAX - 1) * DEAL_STAGGER + DEAL_MS;
/** After the intro, while the import runs, the minimap's thumbnails bounce in a wave this far apart, once per `WAVE_MS`. */
export const WAVE_STAGGER = 70;
export const WAVE_MS = 2600;

/** Ms from the slides being counted until slide `index`'s placeholder has landed on the track. */
export const landsAt = (index: number) => Math.min(index, DEALT_MAX - 1) * DEAL_STAGGER + LAND_MS;

/**
 * The picture as the stage shows it: the first `printed` rendered slides only. The stage prints
 * slides one after another, so a burst of progress (or the import finishing at once) never
 * flips every placeholder at the same moment; the next slide to print shows as in progress.
 */
export function printedPicture(picture: ImportPicture, printed: number): ImportPicture {
  if (picture.count === null || printed >= picture.rendered) return picture;
  return { ...picture, rendered: printed, current: printed };
}
