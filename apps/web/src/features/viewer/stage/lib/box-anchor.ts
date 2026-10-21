import { shapeRefForRect, type Anchor, type Shape } from '@slider/shared';

/** A comment on a whole PowerPoint box – a click on it in box mode, or C while it is outlined. */
export const boxAnchor = (shape: Shape): Anchor => ({
  type: 'rect',
  rect: shape.bbox,
  shapeRef: shapeRefForRect(shape, shape.bbox),
});
