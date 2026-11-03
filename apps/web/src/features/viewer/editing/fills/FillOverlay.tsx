import { coverCrop, isTilted, type EditableElement, type FillLayer } from '@slider/shared';
import type { CSSProperties } from 'react';
import { tiltCss } from '../tilt/tilt-math';
import { fillArea } from '../picture-fit';
import { layerBackground } from './bake-fills';
import { usePictureAspect } from './picture-aspect';

/** The whole picture placed around its box so that `crop` of it fills the box. */
const placed = (crop: { x: number; y: number; w: number; h: number }): CSSProperties => ({
  position: 'absolute',
  left: `${(-crop.x / crop.w) * 100}%`,
  top: `${(-crop.y / crop.h) * 100}%`,
  width: `${100 / crop.w}%`,
  height: `${100 / crop.h}%`,
  maxWidth: 'none',
});

/**
 * A shape's fill layers drawn by the browser over its area (`fillArea`) as LibreOffice shows the
 * picture of them baked (`bakeFills`, of the shape's proportions): laid over the area's bounds,
 * cut to it inside its line, tilted as the element is. Context-free, so `live-parity --compose`
 * draws exactly this.
 */
export function FillOverlay({
  element,
  fills,
  page,
  pictureUrl,
}: {
  element: EditableElement;
  fills: readonly FillLayer[];
  /** The slide's size (cm). */
  page: { width: number; height: number };
  /** A layer's picture's address. */
  pictureUrl: (src: string) => string;
}) {
  const area = fillArea(element, page);
  if (!area) return null;
  const { box } = area;
  // Baked in the shape's own proportions, stretched over the bounds.
  const frameAspect = (element.bbox.w * page.width) / Math.max(1e-6, element.bbox.h * page.height);
  const centre = { x: element.bbox.x + element.bbox.w / 2, y: element.bbox.y + element.bbox.h / 2 };
  return (
    <div
      aria-hidden
      data-picture-fit={element.id}
      style={{
        position: 'absolute',
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`,
        overflow: 'hidden',
        pointerEvents: 'none',
        maskImage: area.mask,
        maskSize: '100% 100%',
        maskRepeat: 'no-repeat',
        WebkitMaskImage: area.mask,
        WebkitMaskSize: '100% 100%',
        WebkitMaskRepeat: 'no-repeat',
        ...(isTilted(element.tilt) && tiltCss(box, centre, element.tilt)),
      }}
    >
      {fills.map((layer, index) =>
        !layer.visible ? null : layer.type === 'image' && layer.fit !== 'tile' ? (
          <LayerPicture
            key={index}
            src={pictureUrl(layer.src)}
            layer={layer}
            frameAspect={frameAspect}
          />
        ) : (
          <span
            key={index}
            style={{
              position: 'absolute',
              inset: 0,
              background: layerBackground(layer, pictureUrl, frameAspect),
              opacity: layer.opacity,
            }}
          />
        ),
      )}
    </div>
  );
}

/** A layer's picture placed in its frame as baked: cut (`coverCrop`), inside it or stretched. */
function LayerPicture({
  src,
  layer,
  frameAspect,
}: {
  src: string;
  layer: Extract<FillLayer, { type: 'image' }>;
  frameAspect: number;
}) {
  const aspect = usePictureAspect(layer.fit === 'stretch' ? null : src);
  const crop =
    layer.fit === 'stretch' || !aspect
      ? { x: 0, y: 0, w: 1, h: 1 }
      : layer.fit === 'fill'
        ? coverCrop(aspect, frameAspect, layer.focus)
        : // Inside it: the frame a part of the picture's box around it.
          aspect > frameAspect
          ? { x: 0, y: (1 - aspect / frameAspect) / 2, w: 1, h: aspect / frameAspect }
          : { x: (1 - frameAspect / aspect) / 2, y: 0, w: frameAspect / aspect, h: 1 };
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      style={{
        ...placed(crop),
        opacity: layer.opacity,
        ...(!aspect && layer.fit !== 'stretch' && { visibility: 'hidden' }),
      }}
    />
  );
}
