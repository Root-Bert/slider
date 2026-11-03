import { isTilted, type TurnedBox } from '@slider/shared';

/** Off by less than this (of the slide) at each edge, a box still spans it. */
const EDGE = 0.002;

/**
 * Whether a box spans the whole slide, lying flat on it: its outline takes the slide's rounded
 * corners (`--radius-panel`), not a mark's.
 */
export function coversSlide({ bbox, rotation = 0, tilt }: TurnedBox): boolean {
  return (
    !rotation &&
    !isTilted(tilt) &&
    bbox.x <= EDGE &&
    bbox.y <= EDGE &&
    bbox.x + bbox.w >= 1 - EDGE &&
    bbox.y + bbox.h >= 1 - EDGE
  );
}
