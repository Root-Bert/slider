import { withChildren, type EditableElement, type LiveElement } from '@slider/shared';
import type { Misspelling } from './useMisspellings';

/** Marks a word's box carries (`useSlideContextMenu` finds the word under a right click by it). */
export const MISSPELT_WORD_ATTR = 'data-misspelt-word';
/** …its element, and which time the word is misspelt in its text, from 0 (`fixWord`). */
export const MISSPELT_ELEMENT_ATTR = 'data-misspelt-element';
export const MISSPELT_AT_ATTR = 'data-misspelt-at';

/**
 * The elements whose misspelt words can be underlined where they stand: their text is the
 * browser's to lay out (`live`), as in Bearbeiten – flat on the slide (a turned text's words would
 * lie askew). The others keep their box marked and their words named (`GuideLayer`).
 */
export function underlinable(
  elements: readonly EditableElement[],
  misspellings: readonly Misspelling[],
): (EditableElement & { live: LiveElement })[] {
  if (misspellings.length === 0) return [];
  const wrong = new Set(misspellings.map(({ shape }) => shape.id));
  return withChildren(elements).filter(
    (element): element is EditableElement & { live: LiveElement } =>
      wrong.has(element.id) &&
      element.live !== null &&
      !element.live.placeholder &&
      element.rotation === 0 &&
      element.tilt === null,
  );
}
