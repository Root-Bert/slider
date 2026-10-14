import type { ImportState } from '@slider/shared';

/**
 * What the import stage shows of the deck while it imports: the viewer's own layout (track,
 * minimap, controls row) built from placeholder slides that fill in as the import goes on.
 * Pure; the stage in `components/ImportStage.tsx` animates it.
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

/** Ghost comment cards appear under these columns (never the first – the status card is there). */
export const hasGhostComment = (index: number) => index > 0 && index % 3 !== 2;

// ── Timing of the stage's intro and outro ──────────────────────────────────

/** Intro: placeholder slides are dealt onto the track this far apart … */
export const DEAL_STAGGER = 110;
export const DEAL_MS = 820;
/** … the chrome (minimap, controls row, status card) builds up behind them. */
export const CHROME_DELAY = 260;
/** Outro: slides dissolve left to right this far apart; `REVEAL_MS` covers the whole outro. */
export const REVEAL_STAGGER = 80;
export const REVEAL_SLOTS_MAX = 6;
export const REVEAL_MS = 220 + REVEAL_SLOTS_MAX * REVEAL_STAGGER + 560;
/** The intro's last deal has landed by then; the outro never starts earlier. */
export const INTRO_MS = 7 * DEAL_STAGGER + DEAL_MS;
