import {
  CENTRED,
  coverCrop,
  focusOf,
  shownCrop,
  type EditableElement,
  type ElementPicture,
  type FillLayer,
  type PictureFocus,
} from '@slider/shared';
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import { useComposedLayers } from '@/lib/api';
import { whenPictureShown } from '../stage/shown-pictures';
import { useViewerData } from '../state/viewer-data';
import { useEditing } from './editing-context';
import { pictureUrl } from './fills/bake-fills';
import { FillOverlay } from './fills/FillOverlay';
import { holdsText } from './compose/text';
import { LiveElementView } from './live/render';
import { cropKey, groundCrop, pictureFit, useFitPicture, usePictureFit } from './picture-fit';

/** How long the browser draws a changed picture at most, should LibreOffice's never come. */
const DRAWN_AT_MOST_MS = 15_000;
/** Zoom per pixel the wheel turns. */
const WHEEL_ZOOM = 0.002;
const MAX_ZOOM = 20;

/** Where a frame lies on the slide, turned and mirrored as the element is. */
function frameStyle(element: EditableElement): CSSProperties {
  const { x, y, w, h } = element.bbox;
  const parts = [
    element.rotation ? `rotate(${element.rotation}deg)` : '',
    element.flip?.x || element.flip?.y
      ? `scale(${element.flip.x ? -1 : 1}, ${element.flip.y ? -1 : 1})`
      : '',
  ].filter(Boolean);
  return {
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: `${w * 100}%`,
    height: `${h * 100}%`,
    transform: parts.join(' ') || undefined,
  };
}

/** The whole picture placed around its frame so that `crop` of it fills the frame. */
const placed = (crop: { x: number; y: number; w: number; h: number }): CSSProperties => ({
  left: `${(-crop.x / crop.w) * 100}%`,
  top: `${(-crop.y / crop.h) * 100}%`,
  width: `${100 / crop.w}%`,
  height: `${100 / crop.h}%`,
});

/**
 * Pictures of one slide whose fit is changing: drawn by the browser – the one whose part is
 * chosen („Ausschnitt“) with all of it dimmed around its frame, those changed until LibreOffice's
 * picture shows them.
 */
export function PictureFitLayer({ slideId, color }: { slideId: string; color: string }) {
  const editing = useEditing();
  const { deck, slides } = useViewerData();
  const { cropping, pending } = usePictureFit();
  const slideSrc = slides.find((slide) => slide.id === slideId)?.imageUrl ?? null;
  const elements = editing.elementsOf(slideId);
  const drawn = [...pending].filter(
    ([id, entry]) => entry.slideId === slideId && id !== cropping?.elementId,
  );
  const drawnKey = drawn.map(([id, entry]) => `${id}:${entry.serial}`).join();
  // The composed slide's pictures of its elements (the same as `SlideCompositor`'s).
  const parts = useComposedLayers(deck.id, slideId, editing.state?.seq, editing.active).data;

  // Done once the slide shows a picture made after the change – a shape's fill once the composed
  // slide shows its element's new picture (`FillsDrawn`).
  useEffect(() => {
    const stops = drawn.map(([id, entry]) =>
      slideSrc && slideSrc !== entry.since && !(entry.fills && parts)
        ? whenPictureShown(slideSrc, () => pictureFit.drawn(id))
        : () => undefined,
    );
    const timer = window.setTimeout(() => {
      for (const [id] of drawn) pictureFit.drawn(id);
    }, DRAWN_AT_MOST_MS);
    return () => {
      for (const stop of stops) stop();
      window.clearTimeout(timer);
    };
    // `drawnKey` holds the entries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideSrc, drawnKey, !parts]);

  const aspectOf = (element: EditableElement) =>
    (element.bbox.w * editing.pageSize.width) /
    Math.max(1e-6, element.bbox.h * editing.pageSize.height);
  // The slide's background: the whole slide its frame.
  const ground = !!cropping?.fill && cropping.elementId === groundCrop(slideId);
  const croppingElement = ground
    ? ({ id: cropping.elementId, bbox: WHOLE_SLIDE, rotation: 0, flip: null } as EditableElement)
    : cropping
      ? elements.find(
          (element) => element.id === cropping.elementId && (cropping.fill || element.picture?.src),
        )
      : undefined;
  // A shape's picture fill: its layer's picture, as a picture element's.
  const croppingPicture: ElementPicture | undefined = cropping?.fill
    ? {
        src: cropping.fill.src,
        aspect: null,
        fit: cropping.fill.fit === 'fill' ? 'fill' : 'stretch',
        focus: cropping.fill.focus,
      }
    : croppingElement?.picture;
  return (
    <>
      {drawn.map(([id, entry]) => {
        const element = elements.find((item) => item.id === id);
        if (element && entry.fills)
          return (
            <FillsDrawn
              key={`${id}:${entry.serial}`}
              element={element}
              fills={entry.fills}
              layerUrl={
                parts
                  ? (parts.layers.find((layer) => layer.elementId === id)?.url ?? null)
                  : undefined
              }
            />
          );
        const picture = element?.picture;
        if (!element || !picture?.src || !picture.aspect) return null;
        return (
          <div
            key={id}
            aria-hidden
            data-picture-fit={id}
            className="pointer-events-none absolute overflow-hidden"
            style={frameStyle(element)}
          >
            <img
              src={pictureUrl(deck.id, picture.src)}
              alt=""
              draggable={false}
              className="absolute max-w-none"
              style={placed(shownCrop(picture, aspectOf(element)))}
            />
          </div>
        );
      })}
      {croppingElement && croppingPicture?.src && (
        <CropOnSlide
          key={cropKey(croppingElement.id, cropping?.fill?.layer)}
          cropKey={cropKey(croppingElement.id, cropping?.fill?.layer)}
          element={croppingElement}
          picture={croppingPicture}
          take={cropping?.fill?.take}
          ground={ground}
          slideId={slideId}
          color={color}
          frameAspect={aspectOf(croppingElement)}
          focus={cropping?.focus ?? null}
        />
      )}
    </>
  );
}

const WHOLE_SLIDE = { x: 0, y: 0, w: 1, h: 1 };

/** A picture placed so that `crop` of it fills its frame (`placed`), cut to what lies beyond it. */
function beyond(crop: { x: number; y: number; w: number; h: number }): string {
  const pct = (value: number) => `${Math.round(value * 1e6) / 1e4}%`;
  const [x1, y1, x2, y2] = [crop.x, crop.y, crop.x + crop.w, crop.y + crop.h].map(pct);
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x1} ${y1}, ${x1} ${y2}, ${x2} ${y2}, ${x2} ${y1}, ${x1} ${y1})`;
}

/**
 * „Ausschnitt“: the part of a picture its frame shows, chosen on the slide as in Figma – the whole
 * picture dimmed around the frame, dragged to move it, the wheel zooms; Esc, ↵ or a click beside
 * it takes the part (the picture then fills its frame). The slide's background (`ground`): the
 * slide is the frame, the background itself follows (`useCroppedGround`) under what lies on it.
 */
function CropOnSlide({
  element,
  picture,
  take,
  cropKey: mine,
  ground = false,
  slideId,
  color,
  frameAspect,
  focus: chosen,
}: {
  element: EditableElement;
  /** Its picture – a picture element's, or a layer of its fill's. */
  picture: ElementPicture;
  /** Takes the part chosen for a layer of its fill (else the picture element's `setImageFit`). */
  take?: (focus: PictureFocus) => void;
  /** Which part this is (`cropKey`): taken only while it is the one being chosen. */
  cropKey: string;
  /** The slide's background (the slide's own drawing shows it, not this layer). */
  ground?: boolean;
  slideId: string;
  color: string;
  frameAspect: number;
  focus: PictureFocus | null;
}) {
  const { deck } = useViewerData();
  const editing = useEditing();
  const fit = useFitPicture(slideId);
  const [natural, setNatural] = useState<number | null>(null);
  const aspect = picture.aspect ?? natural;
  const start = picture.fit === 'fill' ? (picture.focus ?? CENTRED) : CENTRED;
  const focus = chosen ?? start;
  const crop = aspect ? coverCrop(aspect, frameAspect, focus) : null;
  const layerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; focus: PictureFocus } | null>(null);

  // Taken as chosen: filled, the part shown – a change only when there is one (taken before
  // the choosing ends: what is drawn goes from the part chosen to the part taken in one frame).
  // Nothing chosen (opened and left, a double click on the way to typing): its fit stays as it is
  // – „Strecken“ is not turned into „Füllen“.
  const done = () => {
    if (pictureFit.croppingKey() !== mine) return;
    const next = aspect
      ? focusOf(aspect, frameAspect, coverCrop(aspect, frameAspect, focus))
      : null;
    const same =
      !next ||
      chosen === null ||
      (picture.fit === 'fill' &&
        Math.abs(next.x - start.x) < 1e-4 &&
        Math.abs(next.y - start.y) < 1e-4 &&
        Math.abs(next.zoom - start.zoom) < 1e-4);
    if (next && !same) {
      if (take) take(next);
      else fit(element, 'fill', next);
    }
    pictureFit.crop(null);
  };

  // Picked no more (another element, the slide): taken as it is. The background has no pick.
  const picked = ground || editing.selectedElement?.id === element.id;
  const finish = useEffectEvent(done);
  useEffect(() => {
    if (!picked) finish();
  }, [picked]);

  // ↵ takes the part and, on a shape one can type in, starts its text – here, not left to the
  // editor's ↵: whose listener comes first changes with its renders.
  const typeOn = useEffectEvent(() => {
    if (take && !ground && element.live !== null)
      editing.startText({ slideId, elementId: element.id });
  });
  useEffect(() => {
    pictureFit.finishWith(() => finish());
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Enter') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish();
      if (event.key === 'Enter') typeOn();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      pictureFit.finishWith(null);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  const set = (next: PictureFocus) => {
    if (!aspect) return;
    // Pushed back inside the picture: the frame never shows beyond it.
    pictureFit.focus(focusOf(aspect, frameAspect, coverCrop(aspect, frameAspect, next)));
  };

  // The wheel zooms – not passive, so the page neither scrolls nor zooms meanwhile.
  const wheel = useEffectEvent((event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    set({
      ...focus,
      zoom: Math.min(MAX_ZOOM, Math.max(1, focus.zoom * Math.exp(-event.deltaY * WHEEL_ZOOM))),
    });
  });
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const onWheel = (event: WheelEvent) => wheel(event);
    layer.addEventListener('wheel', onWheel, { passive: false });
    return () => layer.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Nothing marked by the drag (the browser would tint the pictures as a selection).
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, moved: false, focus };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const from = drag.current;
    const layer = layerRef.current;
    if (!from || !layer || !aspect) return;
    const box = layer.getBoundingClientRect();
    // Screen px to the slide's own, then into the frame's turned (and mirrored) axes.
    const scale = box.width / Math.max(1, layer.offsetWidth);
    const sx = (event.clientX - from.x) / scale;
    const sy = (event.clientY - from.y) / scale;
    if (!from.moved && Math.hypot(sx, sy) < 3) return;
    from.moved = true;
    const turn = (-element.rotation * Math.PI) / 180;
    let dx = sx * Math.cos(turn) - sy * Math.sin(turn);
    let dy = sx * Math.sin(turn) + sy * Math.cos(turn);
    if (element.flip?.x) dx = -dx;
    if (element.flip?.y) dy = -dy;
    const startCrop = coverCrop(aspect, frameAspect, from.focus);
    const pictureWidth = (element.bbox.w * layer.offsetWidth) / startCrop.w;
    const pictureHeight = (element.bbox.h * layer.offsetHeight) / startCrop.h;
    set({
      ...from.focus,
      x: from.focus.x - dx / pictureWidth,
      y: from.focus.y - dy / pictureHeight,
    });
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const from = drag.current;
    drag.current = null;
    if (from && !from.moved && !(event.target as HTMLElement).closest('[data-crop-frame]')) done();
  };

  return (
    <div
      ref={layerRef}
      data-picture-crop={element.id}
      className="absolute inset-0 z-(--z-raised) cursor-move touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.stopPropagation();
        done();
      }}
    >
      <div data-crop-frame="" className="absolute" style={frameStyle(element)}>
        {crop && ground ? (
          // The slide's background: all of the picture dimmed beyond the slide (a CSS background:
          // the slide's own picture stays the largest on screen) – on it the slide draws the part
          // itself (`useCroppedGround`), under what lies on it.
          <div
            data-crop-beyond=""
            className="pointer-events-none absolute opacity-35"
            style={{
              ...placed(crop),
              background: `center / 100% 100% no-repeat url("${pictureUrl(deck.id, picture.src!)}")`,
              clipPath: beyond(crop),
            }}
          />
        ) : crop ? (
          <>
            {/* All of it, dimmed beyond the frame. */}
            <img
              src={pictureUrl(deck.id, picture.src!)}
              alt=""
              draggable={false}
              className="pointer-events-none absolute max-w-none opacity-35"
              style={placed(crop)}
            />
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <img
                src={pictureUrl(deck.id, picture.src!)}
                alt=""
                draggable={false}
                className="absolute max-w-none"
                style={placed(crop)}
              />
            </div>
          </>
        ) : (
          // Its proportions read from the picture itself first.
          <img
            src={pictureUrl(deck.id, picture.src!)}
            alt=""
            className="invisible absolute"
            onLoad={(event) =>
              setNatural(
                event.currentTarget.naturalWidth / Math.max(1, event.currentTarget.naturalHeight),
              )
            }
          />
        )}
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-px border-2"
          style={{ borderColor: color }}
        />
      </div>
    </div>
  );
}

/**
 * A shape's fill as set, drawn over it in its area (`FillOverlay`) until LibreOffice's picture of
 * it shows: its layers as the picture of them is baked (`bakeFills`) – a picture filled cut as
 * `coverCrop` says.
 */
function FillsDrawn({
  element,
  fills,
  layerUrl,
}: {
  element: EditableElement;
  fills: readonly FillLayer[];
  /** The composed slide's picture of the element now (`undefined`: not composed). */
  layerUrl: string | null | undefined;
}) {
  const { deck } = useViewerData();
  const editing = useEditing();
  // The element's picture when its model took these layers (they are baked first): the next one
  // is LibreOffice's of them – done once it is decoded and shown.
  const taken = sameFills(element.look?.fills ?? [], fills);
  const [before, setBefore] = useState<string | null | undefined>(undefined);
  if (taken && before === undefined && layerUrl !== undefined) setBefore(layerUrl);
  useEffect(() => {
    if (before === undefined || !layerUrl || layerUrl === before) return;
    let cancelled = false;
    let frame = 0;
    const image = new Image();
    image.src = layerUrl;
    const done = () => {
      if (cancelled) return;
      // Its picture swapped in (`useSettledLayer` decodes it too): gone a frame after.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => pictureFit.drawn(element.id));
      });
    };
    image.decode().then(done, done);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [before, layerUrl, element.id]);
  const url = (src: string) => pictureUrl(deck.id, src);
  // Its text over the fill, as the composed slide draws it over LibreOffice's picture (hidden
  // while typed in: the editor's own text shows then).
  const text = element.live && holdsText(element.live) ? element.live : null;
  return (
    <>
      <FillOverlay element={element} fills={fills} page={editing.pageSize} pictureUrl={url} />
      {text && (
        <div aria-hidden className="pointer-events-none contents">
          <LiveElementView
            element={element}
            live={text}
            textOnly
            prompt="room"
            style={editing.textEditing === element.id ? { visibility: 'hidden' } : undefined}
          />
        </div>
      )}
    </>
  );
}

/** Whether the element's layers are `fills` – a picture of them uploaded counted the same. */
function sameFills(own: readonly FillLayer[], fills: readonly FillLayer[]): boolean {
  // Keys sorted: the file's reading of them has its own order.
  const sorted = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([name, item]) => [name, sorted(item)]),
          )
        : value;
  const key = (layers: readonly FillLayer[]) =>
    JSON.stringify(
      sorted(layers.map((layer) => (layer.type === 'image' ? { ...layer, src: '' } : layer))),
    );
  return key(own) === key(fills);
}
