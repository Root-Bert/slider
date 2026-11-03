import type { SlideTransition } from '@slider/shared';

/** What a transition is called, and a word on how it looks. */
export const TRANSITIONS: readonly { value: SlideTransition; label: string; hint: string }[] = [
  { value: 'none', label: 'Ohne', hint: 'Die Folie ist sofort da' },
  { value: 'fade', label: 'Überblenden', hint: 'Geht weich in die nächste über' },
  { value: 'fadeBlack', label: 'Über Schwarz', hint: 'Blendet aus und wieder ein' },
  { value: 'push', label: 'Schieben', hint: 'Schiebt die vorige hinaus' },
  { value: 'cover', label: 'Überdecken', hint: 'Fährt über die vorige' },
  { value: 'wipe', label: 'Wischen', hint: 'Wischt von links herein' },
  { value: 'dissolve', label: 'Auflösen', hint: 'Erscheint Stück für Stück' },
  { value: 'zoom', label: 'Aufziehen', hint: 'Öffnet sich aus der Mitte' },
  { value: 'morph', label: 'Morph', hint: 'Gleiche Elemente gleiten an ihren neuen Platz' },
];

export const transitionLabel = (transition: SlideTransition | null): string =>
  transition === null
    ? 'Eigener Übergang'
    : (TRANSITIONS.find((item) => item.value === transition)?.label ?? transition);

interface Frames {
  /** The slide coming in. */
  incoming: Keyframe[];
  /** The slide before it, under (or beside) it. */
  outgoing?: Keyframe[];
  easing?: string;
}

/**
 * The transitions as Web Animations, close to how LibreOffice and PowerPoint play them: for the
 * picker's previews (and a slide show, should it play them).
 */
export const TRANSITION_FRAMES: Record<Exclude<SlideTransition, 'none'>, Frames> = {
  fade: { incoming: [{ opacity: 0 }, { opacity: 1 }] },
  fadeBlack: {
    incoming: [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }],
    outgoing: [{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }],
    easing: 'linear',
  },
  push: {
    incoming: [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }],
    outgoing: [{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }],
  },
  cover: { incoming: [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }] },
  wipe: { incoming: [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }] },
  dissolve: { incoming: [{ opacity: 0 }, { opacity: 1 }], easing: 'steps(8, jump-end)' },
  zoom: { incoming: [{ clipPath: 'inset(50% 50% 50% 50%)' }, { clipPath: 'inset(0 0 0 0)' }] },
  // A crossfade where the slides cannot be taken apart (and in the picker's preview); the slide
  // show plays the real one (`presentation/MorphStage`).
  morph: { incoming: [{ opacity: 0 }, { opacity: 1 }] },
};

/**
 * Plays `transition` on two stacked layers; returns a stop that puts them back. Nothing moves
 * for `none` or when the system asks for reduced motion.
 */
export function playTransition(
  transition: SlideTransition,
  incoming: HTMLElement,
  outgoing: HTMLElement,
  duration = 700,
): () => void {
  if (transition === 'none' || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return () => undefined;
  }
  const frames = TRANSITION_FRAMES[transition];
  const timing: KeyframeAnimationOptions = {
    duration,
    easing: frames.easing ?? 'cubic-bezier(0.4, 0, 0.2, 1)',
    fill: 'backwards',
  };
  const animations = [
    incoming.animate(frames.incoming, timing),
    ...(frames.outgoing ? [outgoing.animate(frames.outgoing, timing)] : []),
  ];
  return () => {
    for (const animation of animations) animation.cancel();
  };
}
