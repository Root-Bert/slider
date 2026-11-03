/**
 * „Form“'s shapes in the panel beside a drawn frame (`FramePanelPreview`, marked
 * `data-frame-shapes`) – only ever one. The frame's kind chooser (`KindChooser`) never turns into
 * the shapes itself: they are picked there.
 */
export const frameShapes = () => document.querySelector<HTMLElement>('[data-frame-shapes]');

/** „Form“ taken: the focus on the first of its shapes in the panel – the row stays as it is. */
export function focusShapes() {
  frameShapes()?.querySelector<HTMLElement>('[data-shape]')?.focus({ preventScroll: true });
}
