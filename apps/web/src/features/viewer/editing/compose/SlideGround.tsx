import type { FillLayer } from '@slider/shared';
import { gradientBackground } from '../fills/gradient';
import { filledBackground, usePictureAspect } from '../fills/picture-aspect';

/** How a picture layer fills the slide, as CSS. */
const FIT: Record<string, string> = {
  fill: 'center / cover no-repeat',
  fit: 'center / contain no-repeat',
  stretch: 'center / 100% 100% no-repeat',
  tile: 'top left / auto repeat',
};

/**
 * A layer as a CSS background of a slide of `aspect` (width / height): a picture filling it cut
 * to its part („Ausschnitt“, `coverCrop`) as the picture of the layers is baked (`bakeFills`).
 */
function layerCss(
  layer: FillLayer,
  aspect: number,
  url: string | null,
  pictureAspect: number | null,
): string {
  if (layer.type === 'solid') return layer.color;
  if (layer.type === 'gradient') return gradientBackground(layer, aspect);
  if (layer.fit === 'fill') return filledBackground(url!, pictureAspect, aspect, layer.focus);
  return `${FIT[layer.fit] ?? FIT.fill} url("${url}")`;
}

function GroundLayer({
  layer,
  aspect,
  pictureUrl,
}: {
  layer: FillLayer;
  aspect: number;
  pictureUrl: (src: string) => string;
}) {
  const url = layer.type === 'image' ? pictureUrl(layer.src) : null;
  const pictureAspect = usePictureAspect(
    layer.type === 'image' && layer.fit === 'fill' ? url : null,
  );
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: layerCss(layer, aspect, url, pictureAspect),
        opacity: layer.opacity,
      }}
    />
  );
}

/**
 * A slide's own background drawn by the browser (the per-element editor, `SlideCompositor`): its
 * layers bottom first on white – as LibreOffice draws a page never see-through. Context-free, so
 * `live-parity --compose` draws exactly this.
 */
export function SlideGround({
  fills,
  aspect,
  pictureUrl,
}: {
  fills: readonly FillLayer[];
  /** The slide's width over its height. */
  aspect: number;
  /** A picture layer's address (`Pictures/…` or an upload's id). */
  pictureUrl: (src: string) => string;
}) {
  return (
    <div
      aria-hidden
      data-compose-ground=""
      style={{ position: 'absolute', inset: 0, background: '#ffffff' }}
    >
      {fills.map((layer, index) =>
        layer.visible ? (
          <GroundLayer key={index} layer={layer} aspect={aspect} pictureUrl={pictureUrl} />
        ) : null,
      )}
    </div>
  );
}
