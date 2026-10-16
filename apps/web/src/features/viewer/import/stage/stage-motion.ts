import { slotState, type ImportPicture, type SlotState } from '../lib/import-skeleton';

/**
 * `import`: the deck is importing. `settle`: the slides are loaded and the viewer is mounting
 * underneath – the placeholders take the real slides' sizes and the camera pans home. `reveal`:
 * the placeholders dissolve, one after another, into the real slides right under them.
 */
export type StagePhase = 'import' | 'settle' | 'reveal';

export const EASE_OUT = 'cubic-bezier(0.2, 0.9, 0.25, 1)';
export const EASE_DEAL = 'cubic-bezier(0.16, 0.92, 0.24, 1.05)';
export const EASE_PAN = 'cubic-bezier(0.65, 0, 0.35, 1)';
export const SETTLE_TRANSITION = `left 520ms ${EASE_OUT}, width 520ms ${EASE_OUT}, height 520ms ${EASE_OUT}`;

/**
 * A slot's state on the stage. Once the viewer's data is in (`real`), slides past the import's
 * count (it was off) have nothing left to print.
 */
export function stageSlotState(index: number, picture: ImportPicture, real: boolean): SlotState {
  if (real && picture.count !== null && index >= picture.count) return 'rendered';
  return slotState(index, picture);
}
