import type { TurnedBox } from '@slider/shared';
import type { CSSProperties } from 'react';
import { elementTransform } from '../../editing/tilt/tilt-math';
import { coversSlide } from './covers-slide';

/**
 * Shared geometry for object hover, comment emphasis and the AI viewfinder: right on the element's
 * edge, in box mode as when picked.
 */
export function shapeOutlineStyle(shape: TurnedBox): CSSProperties {
  const { bbox, rotation = 0, tilt } = shape;
  return {
    left: `${bbox.x * 100}%`,
    top: `${bbox.y * 100}%`,
    width: `${bbox.w * 100}%`,
    height: `${bbox.h * 100}%`,
    transform: elementTransform(rotation, tilt),
    ...(coversSlide(shape) && { borderRadius: 'var(--radius-panel)' }),
  };
}
