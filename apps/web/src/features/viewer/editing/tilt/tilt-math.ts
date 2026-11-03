import { isTilted, TILT_DEPTH, type BoxTilt, type ElementFlip, type Rect } from '@slider/shared';
import type { CSSProperties } from 'react';

export { isTilted, projected, TILT_DEPTH } from '@slider/shared';

/*
 * An element tilted in depth (`setTilt`) as the editor draws it: turned about its centre around
 * the slide's horizontal axis (`x`, its top away) and vertical one (`y`, its right side away),
 * seen in perspective from this far in front of the slide – the same in the picture written into
 * the file (`bakeTilt`) and in the CSS that shows it while it is tilted (`tiltCss`).
 */

/**
 * The CSS transform of a box drawn where an element is – turned in its plane, then tilted in
 * depth as its picture is (`tiltCss`), about the box's centre: its frame, its outline. `cqw` of
 * a container as wide as the slide; `undefined` when it is neither turned nor tilted.
 */
export function elementTransform(
  rotation: number,
  tilt: BoxTilt | null | undefined,
): string | undefined {
  const parts = [
    isTilted(tilt)
      ? `perspective(${TILT_DEPTH * 100}cqw) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`
      : '',
    rotation ? `rotate(${rotation}deg)` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * CSS tilting a picture (at `box`, of the slide) about the element's centre (`centre`, of the
 * slide) as `bakeTilt` draws it; `cqw` of a container as wide as the slide.
 */
export function tiltCss(box: Rect, centre: { x: number; y: number }, tilt: BoxTilt): CSSProperties {
  return {
    transform: `perspective(${TILT_DEPTH * 100}cqw) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
    transformOrigin: `${((centre.x - box.x) / box.w) * 100}% ${((centre.y - box.y) / box.h) * 100}%`,
  };
}

/** Past this (degrees) a tilt goes over the edge: what shows is the element's back, mirrored. */
const EDGE = 90;

/** An angle of a tilt (degrees) folded back over the edge: within ±90, and whether it went over. */
export function folded(angle: number): { angle: number; over: boolean } {
  if (angle > EDGE) return { angle: angle - 180, over: true };
  if (angle < -EDGE) return { angle: angle + 180, over: true };
  return { angle, over: false };
}

/** A folded angle over the edge again (`folded`'s other way). */
export const unfolded = (angle: number): number => (angle <= 0 ? angle + 180 : angle - 180);

/**
 * A tilt dragged over the edge, as it is stored: the element mirrored on screen – left to right
 * when tilted over sideways (`y`), top to bottom when over its top (`x`) – and tilted back by half
 * a turn. `mirror` `null`: not over.
 */
export function overTheEdge(tilt: BoxTilt): { tilt: BoxTilt; mirror: ElementFlip | null } {
  const x = folded(tilt.x);
  const y = folded(tilt.y);
  return {
    tilt: { x: x.angle, y: y.angle },
    mirror: x.over || y.over ? { x: y.over, y: x.over } : null,
  };
}

/**
 * An element turned by `rotation` and mirrored (`flip`, its own directions) mirrored once more on
 * screen about its centre (`mirror`): its turn and mirroring then. One way only, the turn goes the
 * other way round; both ways are half a turn, which mirroring both of its own directions is too.
 */
export function mirroredOnScreen(
  rotation: number,
  flip: ElementFlip,
  mirror: ElementFlip,
): { rotation: number; flip: ElementFlip } {
  const once = mirror.x !== mirror.y;
  return {
    rotation: once ? (360 - rotation) % 360 : rotation,
    flip: { x: flip.x !== mirror.x, y: flip.y !== mirror.y },
  };
}
