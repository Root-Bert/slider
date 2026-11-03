import {
  clampRect,
  hitTestShapes,
  type Point,
  type Shape,
  type Slide,
  type TurnedBox,
} from '@slider/shared';
import { useMemo } from 'react';
import { useEditing } from '../../editing/editing-context';

/** A box on the slide that box mode outlines and a comment can attach to. */
export interface SlideBox extends TurnedBox {
  id: string;
  name: string;
}

/**
 * The boxes of a slide – the same in review and while editing, so hovering marks the same areas
 * in both: for whoever can edit the deck, its elements as they are now (also where they reach
 * beyond the slide, a text growing with its text as high as it is drawn, an edit shown before the
 * slide's new picture is there); else the slide's boxes as the file has them.
 */
export function useSlideBoxes(slide: Slide): readonly SlideBox[] {
  const editing = useEditing();
  const elements = editing.available ? editing.elementsOf(slide.id) : null;
  // A box growing with its text: as high as it is drawn (`EditLayer`).
  const heights = (elements ?? []).map((element) =>
    element.live?.autoGrow ? editing.heightOf(element.id) : null,
  );
  const heightsKey = heights.join();
  // Kept while nothing changed: the slide's marks (`AnnotationLayer`, memo) take them.
  return useMemo(
    () =>
      elements === null
        ? slide.shapes
        : elements.flatMap(({ id, name, bbox, rotation, tilt }, at) => {
            if (bbox.w <= 0 || bbox.h <= 0) return [];
            const height = heights[at] ?? null;
            return [
              { id, name, bbox: height === null ? bbox : { ...bbox, h: height }, rotation, tilt },
            ];
          }),
    // `heights` is read through `heightsKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [elements, heightsKey, slide.shapes],
  );
}

/** The box under a point – the smallest, as a click picks it (`hitTestShapes`). */
export const slideBoxAt = (slide: Slide, boxes: readonly SlideBox[], point: Point) =>
  hitTestShapes(boxes, point, slide.aspectRatio);

/**
 * The box as a comment attaches to it: where it lies now, cut at the slide's edge (anchors live on
 * the slide), with the slide's text of it.
 */
export function shapeOfBox(slide: Slide, box: SlideBox): Shape {
  const shape = slide.shapes.find((item) => item.id === box.id);
  // Reviewing (no elements): the slide's own box.
  if (shape === box) return shape;
  return {
    id: box.id,
    name: box.name,
    bbox: clampRect(box.bbox),
    text: shape?.text ?? '',
    ...(box.rotation ? { rotation: box.rotation } : {}),
    ...(box.tilt ? { tilt: { x: box.tilt.x, y: box.tilt.y } } : {}),
  };
}
