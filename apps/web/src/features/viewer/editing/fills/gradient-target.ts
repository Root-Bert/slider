import type { FillLayer } from '@slider/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { GradientLayer } from './gradient';

/*
 * The gradient being changed in a panel – a slide's background, an element's fill – and where it
 * lies on its slide, so the slide draws its handles over it (`GradientHandles`): the line it runs
 * along with its colours on it, as a design tool has them. One at a time: the panel open last.
 */

export interface GradientTarget {
  slideId: string;
  /** What the gradient fills, as fractions of the slide – before it is turned. */
  box: { x: number; y: number; w: number; h: number };
  /** Turned clockwise by this many degrees around the box's centre. */
  rotation: number;
  layer: GradientLayer;
  /** The stop picked – its colour shows in the panel. */
  picked: number;
  change: (layer: FillLayer, coalesce?: string) => void;
  pick: (index: number) => void;
}

/** Where a gradient lies: its slide, box and turn. */
export type GradientPlace = Pick<GradientTarget, 'slideId' | 'box' | 'rotation'>;

let current: { owner: object; target: GradientTarget } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The gradient whose handles show on `slideId`, if any. */
export function useGradientTarget(slideId: string): GradientTarget | null {
  return useSyncExternalStore(
    subscribe,
    () => (current?.target.slideId === slideId ? current.target : null),
    () => null,
  );
}

/** Shows `target`'s handles while the caller is mounted (`null`: none of its own). */
export function useShowGradientHandles(target: GradientTarget | null): void {
  const [owner] = useState(() => ({}));
  useEffect(() => {
    if (target) current = { owner, target };
    else if (current?.owner === owner) current = null;
    else return;
    notify();
  });
  useEffect(
    () => () => {
      if (current?.owner !== owner) return;
      current = null;
      notify();
    },
    [owner],
  );
}
