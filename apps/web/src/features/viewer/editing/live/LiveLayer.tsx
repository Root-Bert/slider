import type { EditableElement, LiveElement, Rect } from '@slider/shared';
import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { cn } from '@/ui';
import { useEditing, type LiveCutout } from '../editing-context';
import './office-fonts.css';
import { liveLayerStyle, PT_PER_CM } from './css';
import { LiveElementView } from './render';

/** A change that left the slide's picture as it was: drawn live no longer than this. */
const SAME_PICTURE_MS = 1500;

/**
 * A slide while one of its texts is typed in or just changed (the live editor): LibreOffice's
 * picture of the slide without that text, and the text drawn by the browser over it – as it is
 * now, so a change shows at once. Once the slide's new picture (`src`) has loaded, the slide is
 * that picture alone again. Any other time this draws nothing: the slide shows as it is.
 */
export function LiveLayer({
  slideId,
  src,
  rounded,
}: {
  slideId: string;
  src: string;
  rounded: string;
}) {
  const editing = useEditing();
  const element = editing.active ? editing.liveOn(slideId) : null;
  // An element just deleted: the slide without it until its new picture is there.
  const gone = editing.active && !element ? editing.goneOn(slideId) : null;
  const elementId = element?.id ?? gone;
  const background = element ? editing.backgroundOf(element.id) : null;
  const awaited = elementId ? editing.awaitedPicture(elementId) : null;
  const { pictureCame } = editing;
  const waitingFor = awaited?.src;
  const settled = awaited?.settled ?? false;

  // The new picture: shown once it has loaded, so the old one never flashes up in between.
  useEffect(() => {
    if (!elementId || waitingFor === undefined) return;
    if (src === waitingFor) {
      if (!settled) return;
      const timer = window.setTimeout(() => pictureCame(elementId), SAME_PICTURE_MS);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    const image = new Image();
    image.onload = image.onerror = () => {
      if (!cancelled) pictureCame(elementId);
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [elementId, waitingFor, settled, src, pictureCame]);

  // A cutout draws the element whole – its look and place as they are now; else its text
  // is drawn over the slide with that text left out.
  const cut = elementId ? editing.cutoutOf(elementId) : null;
  const picture = cut?.cutout.backdrop ?? background;
  if (gone && cut) {
    return (
      <div
        data-live-layer={slideId}
        aria-hidden
        className={cn('pointer-events-none absolute inset-0 overflow-hidden select-none', rounded)}
      >
        <img
          src={cut.cutout.backdrop}
          alt=""
          draggable={false}
          className="absolute inset-0 size-full"
        />
        <Above cut={cut} />
      </div>
    );
  }
  if (!element?.live || !picture) return null;
  return (
    <div
      data-live-layer={slideId}
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 overflow-hidden select-none', rounded)}
      style={liveLayerStyle(editing.pageSize.width * PT_PER_CM)}
    >
      <img src={picture} alt="" draggable={false} className="absolute inset-0 size-full" />
      <LiveItem element={element} live={element.live} cut={cut} />
    </div>
  );
}

function LiveItem({
  element,
  live,
  cut,
}: {
  element: EditableElement;
  live: LiveElement;
  cut: LiveCutout | null;
}) {
  const editing = useEditing();
  const ref = useRef<HTMLDivElement>(null);
  const preview = editing.preview?.elementId === element.id ? editing.preview.rect : null;
  const shown = preview
    ? { ...element, bbox: live.autoGrow ? { ...preview, h: element.bbox.h } : preview }
    : element;
  const { measure } = editing;
  // A box that grows with its text is as high as the browser draws it: the frame follows.
  useLayoutEffect(() => {
    const node = ref.current;
    const layer = node?.parentElement;
    if (!node || !layer || !live.autoGrow) return;
    const update = () => measure(element.id, node.offsetHeight / Math.max(1, layer.offsetHeight));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    observer.observe(layer);
    return () => {
      observer.disconnect();
      measure(element.id, null);
    };
  }, [element.id, live.autoGrow, measure]);
  return (
    <>
      {cut && live.fill && <CutoutMask cut={cut} part="fill" color={live.fill} to={shown.bbox} />}
      {cut && live.stroke && (
        <CutoutMask cut={cut} part="stroke" color={live.stroke.color} to={shown.bbox} />
      )}
      <LiveElementView
        ref={ref}
        element={shown}
        live={live}
        textOnly
        prompt
        // Typed in on the edit layer above: shown there, not twice.
        style={editing.textEditing === element.id ? { visibility: 'hidden' } : undefined}
      />
      {/* What lies over the element stays over it. */}
      {cut && <Above cut={cut} />}
    </>
  );
}

/** What lies over an element on its slide, as LibreOffice drew it (its cutout's `above`). */
function Above({ cut }: { cut: LiveCutout }) {
  const { above, aboveBox } = cut.cutout;
  if (!above || !aboveBox) return null;
  return (
    <img
      src={above}
      alt=""
      draggable={false}
      className="absolute"
      style={{
        left: `${aboveBox.x * 100}%`,
        top: `${aboveBox.y * 100}%`,
        width: `${aboveBox.w * 100}%`,
        height: `${aboveBox.h * 100}%`,
      }}
    />
  );
}

/**
 * A part of an element as LibreOffice outlines it (its area or its outline), painted in `color`
 * – where the element is now (`to`), moved and stretched from where its cutout was drawn.
 */
function CutoutMask({
  cut,
  part,
  color,
  to,
}: {
  cut: LiveCutout;
  part: 'fill' | 'stroke';
  color: string;
  to: Rect;
}) {
  const url = cut.cutout[part];
  const box = cut.cutout.box;
  if (!url || !box) return null;
  const from = cut.bbox;
  const sx = from.w > 0 ? to.w / from.w : 1;
  const sy = from.h > 0 ? to.h / from.h : 1;
  const mask = `url("${url}")`;
  const style: CSSProperties = {
    position: 'absolute',
    left: `${(to.x + (box.x - from.x) * sx) * 100}%`,
    top: `${(to.y + (box.y - from.y) * sy) * 100}%`,
    width: `${box.w * sx * 100}%`,
    height: `${box.h * sy * 100}%`,
    background: color,
    opacity: part === 'fill' ? cut.cutout.fillOpacity : cut.cutout.strokeOpacity,
    maskImage: mask,
    WebkitMaskImage: mask,
    maskSize: '100% 100%',
    WebkitMaskSize: '100% 100%',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
  };
  return <div aria-hidden style={style} />;
}
