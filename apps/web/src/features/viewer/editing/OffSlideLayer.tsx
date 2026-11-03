import type { Rect, SlideLayers } from '@slider/shared';
import { useState } from 'react';
import { useSlideLayers } from '@/lib/api';
import { useViewerData } from '../state/viewer-data';
import { useEditing } from './editing-context';
import { usePreviewAmong } from './preview-store';

/** Lies wholly on the slide (a rounding error over its edge is none). */
const onSlide = ({ x, y, w, h }: Rect) =>
  x > -1e-3 && y > -1e-3 && x + w < 1 + 1e-3 && y + h < 1 + 1e-3;

type Pictures = ReadonlyMap<string, { url: string; box: Rect; bbox: Rect }>;

const percent = (share: number) => `${share * 100}%`;

/**
 * The rounded corners' points, clockwise from the top-left corner's arc: each corner's centre lies
 * one radius inside, a point is the corner plus `dx`/`dy` radii.
 */
const ARC = [
  { right: false, bottom: false, from: 180, sx: 1, sy: 1 },
  { right: true, bottom: false, from: 270, sx: -1, sy: 1 },
  { right: true, bottom: true, from: 0, sx: -1, sy: -1 },
  { right: false, bottom: true, from: 90, sx: 1, sy: -1 },
].flatMap(({ right, bottom, from, sx, sy }) =>
  Array.from({ length: 7 }, (_, i) => {
    const angle = ((from + 15 * i) * Math.PI) / 180;
    return { right, bottom, dx: sx + Math.cos(angle), dy: sy + Math.sin(angle) };
  }),
);

/**
 * The frame with the slide cut out (`hole`, in percent of the frame), its corners rounded as the
 * slide's (`--radius-panel`): an even-odd polygon, each corner a few points on its arc.
 */
function roundedHole(hole: Rect): string {
  const at = (percentage: number, radii: number) =>
    `calc(${percentage}% ${radii < 0 ? '-' : '+'} var(--radius-panel) * ${Math.abs(radii).toFixed(4)})`;
  const points = ARC.map(
    ({ right, bottom, dx, dy }) =>
      `${at(right ? hole.x + hole.w : hole.x, dx)} ${at(bottom ? hole.y + hole.h : hole.y, dy)}`,
  );
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${points.join(', ')}, ${points[0]})`;
}

/**
 * What lies off the slide, zoomed out (for whoever can edit the deck – reviewing too): each element's picture where it reaches
 * beyond the slide's edge, slightly soft (kept in the file, but no one sees it there) – the slide's own picture shows the rest. Drawn
 * whole by the server (`slideLayers`); one moved since keeps its last picture, moved along.
 * `frame`: the part of the slide's coordinates its frame shows (wider than the slide).
 */
export function OffSlideLayer({ slideId, frame }: { slideId: string; frame: Rect }) {
  const editing = useEditing();
  const { deck } = useViewerData();
  const seq = editing.state?.seq;
  const elements = editing.available ? editing.elementsOf(slideId) : [];
  const preview = usePreviewAmong(elements.map((element) => element.id));
  const boxOf = (id: string, bbox: Rect) => (preview?.elementId === id ? preview.rect : bbox);
  const off = elements.filter((element) => !onSlide(boxOf(element.id, element.bbox)));
  const { data } = useSlideLayers(deck.id, slideId, seq, {
    enabled: off.length > 0,
    // Looked at now: not behind the slides drawn ahead.
    priority: 'interactive',
  });
  // Each element's last picture, with where the element lay when it was drawn – taken over
  // when a step's pictures come (while that step is the one shown).
  const [known, setKnown] = useState<{ from: SlideLayers | null; pictures: Pictures }>({
    from: null,
    pictures: new Map(),
  });
  if (data && data.seq === seq && known.from !== data) {
    const pictures = new Map(known.pictures);
    for (const layer of data.layers) {
      const element = elements.find((item) => item.id === layer.elementId);
      if (!element || !layer.url || !layer.box) pictures.delete(layer.elementId);
      else pictures.set(layer.elementId, { url: layer.url, box: layer.box, bbox: element.bbox });
    }
    setKnown({ from: data, pictures });
  }
  if (off.length === 0) return null;
  // The slide, cut out of the frame with its rounded corners: only what lies around it shows –
  // whatever its picture is doing (fading in, swapped).
  const clipPath = roundedHole({
    x: (-frame.x / frame.w) * 100,
    y: (-frame.y / frame.h) * 100,
    w: 100 / frame.w,
    h: 100 / frame.h,
  });
  return (
    <div
      aria-hidden
      data-off-slide={slideId}
      className="pointer-events-none absolute"
      style={{
        left: percent(frame.x),
        top: percent(frame.y),
        width: percent(frame.w),
        height: percent(frame.h),
        clipPath,
      }}
    >
      {off.map((element) => {
        const picture = known.pictures.get(element.id);
        if (!picture) return null;
        const now = boxOf(element.id, element.bbox);
        // Resized since: its picture would be stretched – it waits for its new one.
        if (Math.abs(now.w - picture.bbox.w) > 1e-4 || Math.abs(now.h - picture.bbox.h) > 1e-4) {
          return null;
        }
        const box = {
          x: picture.box.x + now.x - picture.bbox.x,
          y: picture.box.y + now.y - picture.bbox.y,
          w: picture.box.w,
          h: picture.box.h,
        };
        const place = {
          left: percent((box.x - frame.x) / frame.w),
          top: percent((box.y - frame.y) / frame.h),
          width: percent(box.w / frame.w),
          height: percent(box.h / frame.h),
        };
        return (
          <img
            key={element.id}
            src={picture.url}
            alt=""
            draggable={false}
            // Slightly soft: not quite part of the slide.
            className="absolute max-w-none blur-[1.5px]"
            style={place}
          />
        );
      })}
    </div>
  );
}
