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
      // `total` counts the hidden slides too: the visible count (known since parsing) comes first.
      const count = known ?? (state.progress?.total || null);
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
/** A placeholder has landed by then (the deal eases out). */
export const LAND_MS = Math.round(DEAL_MS * 0.55);
/** A slide's sketch builds up once, when its turn comes – the longest sketch takes this long (index.css). */
export const BUILD_MS = 150 + 9 * 80 + 640;
/** Outro: the camera's glide home, then … */
export const HOME_MS = 900;
/**
 * … the real slides appear, one after another – each on the track and in the minimap at once,
 * up to the `APPEAR_SLOTS_MAX`th; all further ones come with that one – and then the stage, by
 * then a copy of the viewer, leaves.
 */
export const APPEAR_MS = 450;
export const APPEAR_STAGGER = 140;
export const APPEAR_SLOTS_MAX = 20;
export const appearDelay = (index: number) =>
  Math.min(index, APPEAR_SLOTS_MAX - 1) * APPEAR_STAGGER;
export const LEAVE_MS = 250;
export const REVEAL_MS = appearDelay(APPEAR_SLOTS_MAX - 1) + APPEAR_MS + LEAVE_MS;
/** Without motion: a plain cross-fade. */
export const REVEAL_PLAIN_MS = 600;
/** The intro's last deal has landed by then. */
export const INTRO_MS = (DEALT_MAX - 1) * DEAL_STAGGER + DEAL_MS;
/** After the intro, while the import runs, the thumbnail of the slide at work bounces once per `WAVE_MS`. */
export const WAVE_MS = 1500;

// ── The tour ─────────────────────────────────────────────────────────────

/*
 * The renderer reports nothing while it works (LibreOffice converts the whole deck in one go,
 * then the progress races to the end within a second), so the stage does not follow it. Once the
 * slides are counted it tours the deck on its own clock: one slide after another builds up and
 * prints, the camera following – paced to fill a typical import, a little quicker for long decks.
 */
const TOUR_TARGET_MS = 16_500;
const TOUR_DWELL_MIN = 1500;
const TOUR_DWELL_MAX = 3300;

/** How long the tour stays on each of `count` slides. */
export const tourDwell = (count: number) =>
  Math.min(TOUR_DWELL_MAX, Math.max(TOUR_DWELL_MIN, Math.round(TOUR_TARGET_MS / count)));

/**
 * When the tour prints slide `index`, every slide getting the same time. The first slide is at
 * work from the moment the stage shows (`shownAt`, still a ghost) – its time counts from there,
 * but the camera only moves on once the second slide has landed (`countedAt`: dealt from then).
 */
export function tourPrintAt(index: number, shownAt: number, countedAt: number, dwell: number) {
  const start = Math.max(shownAt, countedAt + DEAL_STAGGER + LAND_MS - dwell);
  return start + (index + 1) * dwell;
}

/**
 * The picture as the stage shows it: the tour's first `printed` slides printed, the next one at
 * work. Once the import is `done` nothing new starts – no slide waits for the tour any more.
 */
export function tourPicture(picture: ImportPicture, printed: number, done: boolean): ImportPicture {
  if (picture.count === null || picture.failed) return picture;
  const rendered = Math.min(printed, picture.count);
  return {
    ...picture,
    rendered,
    current: !done && rendered < picture.count ? rendered : -1,
  };
}
