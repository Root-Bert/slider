/*
 * Editing chrome drawn on top of the slide image: resize handles, pin rings, name tags. It sits on
 * whatever the slide shows – white paper as often as a dark photo – so it is pure white with an
 * accent edge, not one of the translucent `fg` tokens (which vanish on a white slide). This module
 * is the one place that white lives (design-system exception); the classes are spelled out so
 * Tailwind sees them.
 */

/** A corner handle of a box on the slide (draft box, own boxes, text boxes). */
export const HANDLE_CLASS = 'absolute size-3 touch-none rounded-mark bg-white';

/** Accent edge around a {@link HANDLE_CLASS} handle. */
export const handleRing = (color: string): string => `0 0 0 1.5px ${color}`;

/** Halo around a lit (emphasised or dragged) frame on the slide. */
export const frameHalo = (color: string): string =>
  `0 0 0 3px color-mix(in srgb, ${color} 30%, transparent)`;

/** The dot of a comment pin: white ring, lifted off the slide. */
export const PIN_DOT_RING = 'shadow-[0_0_0_2px_white,var(--shadow-mark)]';

/** The draft's pin: white ring plus a soft white halo (it is still being placed). */
export const DRAFT_PIN_RING = 'shadow-[0_0_0_2px_white,0_0_0_6px_var(--color-surface-4)]';

/**
 * The author's first name on top of a box being edited, on their accent fill. White on every
 * accent, like the comment counts (`CountBubble`). Callers add padding and behaviour.
 */
export const NAME_TAG_CLASS =
  'absolute -top-6 -left-0.5 rounded-t-thumb rounded-br-thumb py-0.5 text-caption leading-4 font-medium whitespace-nowrap text-white';

/** Text of a label chip on an accent fill over the slide (PowerPoint box names). */
export const ON_MARK_TEXT = 'text-white';
