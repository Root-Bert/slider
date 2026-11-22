import {
  ENTRANCE_SECONDS,
  type EditableElement,
  type Entrance,
  type SlideLayers,
} from '@slider/shared';

/*
 * Entrances in the slide show: the slide taken apart as for the morph (its page, each element
 * alone), the elements that come in hidden until their turn – each after the one before (the
 * longest of those together) or with it, by itself as the slide comes, no clicks.
 */

type Box = { x: number; y: number; w: number; h: number };

export interface EntranceLayer {
  url: string;
  box: Box;
  /** How it comes in and when (seconds after the slide is there); `null`: there from the start. */
  entrance: (Pick<Entrance, 'effect' | 'from'> & { delay: number }) | null;
}

export interface EntrancePlan {
  background: string;
  /** Bottom first. */
  layers: EntranceLayer[];
  /** Seconds until the last is in. */
  seconds: number;
}

type EntranceElement = Pick<EditableElement, 'id' | 'entrance'>;

/** The slide's entrances as they play – `null` when nothing on it comes in. */
export function entrancePlan(
  layers: SlideLayers,
  elements: readonly EntranceElement[],
): EntrancePlan | null {
  const drawn = new Set(
    layers.layers.flatMap((layer) => (layer.url && layer.box ? [layer.elementId] : [])),
  );
  const coming = elements
    .filter((element) => element.entrance && drawn.has(element.id))
    .sort((a, b) => a.entrance!.order - b.entrance!.order);
  if (coming.length === 0) return null;
  const delays = new Map<string, number>();
  let start = 0;
  let end = 0;
  coming.forEach((element, at) => {
    if (at === 0 || element.entrance!.start !== 'with') start = end;
    delays.set(element.id, start);
    end = Math.max(end, start + ENTRANCE_SECONDS);
  });
  const byId = new Map(coming.map((element) => [element.id, element.entrance!]));
  return {
    background: layers.background,
    layers: layers.layers.flatMap((layer) => {
      if (!layer.url || !layer.box) return [];
      const entrance = byId.get(layer.elementId);
      return [
        {
          url: layer.url,
          box: layer.box,
          entrance: entrance
            ? {
                effect: entrance.effect,
                ...(entrance.from && { from: entrance.from }),
                delay: delays.get(layer.elementId)!,
              }
            : null,
        },
      ];
    }),
    seconds: end,
  };
}

const percent = (value: number) => `${value * 100}%`;

/** Keyframes for a layer at `box` coming in so (as LibreOffice plays its presets). */
export function entranceFrames(
  entrance: NonNullable<EntranceLayer['entrance']>,
  box: Box,
): Keyframe[] {
  switch (entrance.effect) {
    case 'appear':
      return [
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: 0.01 },
        { opacity: 1, offset: 0.02 },
        { opacity: 1 },
      ];
    case 'fade':
      return [{ opacity: 0 }, { opacity: 1 }];
    case 'rise':
      return [
        { opacity: 0, top: percent(box.y + 0.05) },
        { opacity: 1, top: percent(box.y) },
      ];
    case 'fly': {
      const from = entrance.from ?? 'bottom';
      return from === 'left' || from === 'right'
        ? [{ left: percent(from === 'left' ? -box.w : 1) }, { left: percent(box.x) }]
        : [{ top: percent(from === 'top' ? -box.h : 1) }, { top: percent(box.y) }];
    }
    case 'zoom':
      return [
        { opacity: 0, transform: 'scale(0)' },
        { opacity: 1, transform: 'scale(1)' },
      ];
    case 'wipe':
      return [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }];
  }
}
