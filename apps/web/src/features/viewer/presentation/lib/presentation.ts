import type { Slide } from '@slider/shared';

/**
 * The slides a presentation shows: like PowerPoint without the hidden ones, even while the
 * viewer shows them (H). A deck with nothing but hidden slides shows them all.
 */
export function presentedSlides(slides: readonly Slide[]): Slide[] {
  const shown = slides.filter((slide) => !slide.hidden);
  return shown.length > 0 ? shown : [...slides];
}

/**
 * Where the presentation starts: on the active slide – a hidden one hands over to the next one
 * shown, at the end of the deck to the one before.
 */
export function presentationStart(
  slides: readonly Slide[],
  presented: readonly Slide[],
  activeSlideId: string | null,
): number {
  const at = slides.findIndex((slide) => slide.id === activeSlideId);
  if (at < 0) return 0;
  const after = slides.slice(at).find((slide) => presented.includes(slide));
  const before = slides
    .slice(0, at)
    .reverse()
    .find((slide) => presented.includes(slide));
  const index = presented.indexOf((after ?? before)!);
  return Math.max(0, index);
}

export type PresentationKey =
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'first' }
  | { type: 'last' }
  | { type: 'black' }
  | { type: 'digit'; digit: number }
  | { type: 'exit' };

/**
 * PowerPoint's keys during a slide show: forward with →, ↓, Page Down, Space, Enter or N, back
 * with ←, ↑, Page Up, Backspace or P, Home/End, B or . for a black screen, a number then Enter
 * jumps to that slide, Esc ends. `null`: not a presentation key.
 */
export function presentationKey(key: string): PresentationKey | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
    case ' ':
    case 'Enter':
    case 'n':
    case 'N':
      return { type: 'next' };
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
    case 'Backspace':
    case 'p':
    case 'P':
      return { type: 'previous' };
    case 'Home':
      return { type: 'first' };
    case 'End':
      return { type: 'last' };
    case 'b':
    case 'B':
    case '.':
      return { type: 'black' };
    case 'Escape':
      return { type: 'exit' };
    default:
      return /^[0-9]$/.test(key) ? { type: 'digit', digit: Number(key) } : null;
  }
}
