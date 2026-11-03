import type { EditableElement, ElementTilt, Rect, SlideLayers } from '@slider/shared';
import { memo, type CSSProperties } from 'react';
import { stretched, turnedCss, type Frame } from '../live/css';
import { isTilted, tiltCss } from '../tilt/tilt-math';

const boxCss = ({ x, y, w, h }: Rect): CSSProperties => ({
  left: `${x * 100}%`,
  top: `${y * 100}%`,
  width: `${w * 100}%`,
  height: `${h * 100}%`,
});

/**
 * An element LibreOffice draws, as its picture alone (`SlideLayers`): placed where it is now
 * (`to`) from where it was drawn (`from`) – moved, stretched along its own sides, turned, tilted.
 * Stable neighbours do not rerender on each pointer move; only the dragged one changes.
 */
export const RasterItem = memo(function RasterItem({
  layer,
  element,
  from,
  to,
  tilt,
}: {
  layer: SlideLayers['layers'][number];
  element: EditableElement | undefined;
  from: Frame | undefined;
  to: Frame | undefined;
  tilt: ElementTilt | null | undefined;
}) {
  if (!layer.url || !layer.box) return null;
  const box = layer.box;
  const placed = from && to ? turnedCss(box, from, to) : boxCss(box);
  let style = placed;
  if (element && isTilted(tilt)) {
    const at = to?.bbox ?? element.bbox;
    const drawn = from && to ? stretched(box, from.bbox, at) : box;
    const tilted = tiltCss(drawn, { x: at.x + at.w / 2, y: at.y + at.h / 2 }, tilt);
    style = {
      ...placed,
      transform: [tilted.transform, placed.transform].filter(Boolean).join(' '),
      transformOrigin: tilted.transformOrigin,
    };
  }
  return (
    <img src={layer.url} alt="" draggable={false} className="absolute max-w-none" style={style} />
  );
});
