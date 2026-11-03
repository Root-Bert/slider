import {
  withChildren,
  type EditableElement,
  type FillLayer,
  type LiveDrag,
  type SlideLayers,
} from '@slider/shared';
import { memo, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { useComposedLayers } from '@/lib/api';
import { cn } from '@/ui';
import { SwapImage } from '../../stage/SwapImage';
import { useViewerData } from '../../state/viewer-data';
import { groupFrameOf, useEditing, type ElementPreview } from '../editing-context';
import { usePreviewAmong } from '../preview-store';
import { usePeersOn, type PeerPick } from './peers';
import { liveLayerStyle, PT_PER_CM, type Frame } from '../live/css';
import { layerFrames } from '../live/layer-frames';
import { RasterItem } from './RasterItem';
import { LiveElementView } from '../live/render';
import '../live/office-fonts.css';
import { pictureUrl } from '../fills/bake-fills';
import { ElementView } from './ElementView';
import { SlideGround } from './SlideGround';
import { backgroundPreviews, useBackgroundPreview } from '../fills/background-previews';
import { markComposed } from './composed';
import { useCroppedGround } from '../picture-fit';
import { moved } from '../live/model';

/*
 * Bearbeiten composed per element (CLAUDE.md §1): LibreOffice's slide without its elements, then
 * the elements bottom first – what the browser draws whole (`paint`) from the element as it is
 * now, the others as LibreOffice's picture of each alone (their live text by the browser over it).
 * Moved, resized, refilled or deleted, an element the browser draws shows so in the same frame:
 * nothing waits for a picture. Until every picture it needs is decoded (and the fonts are in), the
 * slide is LibreOffice's picture alone and Bearbeiten does not work on it yet (`useComposed`).
 */
export function SlideCompositor({ slideId, rounded }: { slideId: string; rounded: string }) {
  const editing = useEditing();
  const { deck } = useViewerData();
  // The slide taken apart in 3D („Ebenen“) is the stage's, not mounted here.
  const enabled = editing.active;
  const parts = useComposedLayers(deck.id, slideId, editing.state?.seq, enabled).data;
  if (!enabled || !parts) return null;
  return <Composed slideId={slideId} rounded={rounded} parts={parts} />;
}

function Composed({
  slideId,
  rounded,
  parts,
}: {
  slideId: string;
  rounded: string;
  parts: SlideLayers;
}) {
  const editing = useEditing();
  const { deck } = useViewerData();
  const shownElements = editing.elementsOf(slideId);
  const everyId = withChildren(shownElements).map((item) => item.id);
  const preview = usePreviewAmong(everyId);
  // What the others drag right now (no step yet) and have picked.
  const peers = usePeersOn(everyId);
  // A group drawn from its parts (the server's pictures are of them, `toLayerBytes` composed): a
  // part changed – the group entered – shows so in the same frame; dragged, they go with it.
  const partsOf = (list: readonly EditableElement[], dx = 0, dy = 0): EditableElement[] =>
    list.flatMap((element) => {
      if (!element.children) return [dx || dy ? moved(element, dx, dy) : element];
      const frame = shownFrame(element, preview, peers.drags.get(element.id));
      return partsOf(
        element.children,
        dx + frame.bbox.x - element.bbox.x,
        dy + frame.bbox.y - element.bbox.y,
      );
    });
  const elements = partsOf(shownElements);
  const drawnAt = layerFrames(parts, editing.state, slideId);
  const byId = new Map(parts.layers.map((layer) => [layer.elementId, layer]));
  // Every element LibreOffice draws needs its picture (one added a moment ago has none yet).
  const complete = elements.every((element) => element.paint || byId.has(element.id));
  // The slide's own background drawn by the browser over white, its master's shapes over it (as
  // they were drawn): changed – a colour picked, a gradient's handle dragged – it shows in the same
  // frame, from the panel's draft until the model has it. Without one, the master's background
  // as LibreOffice drew it alone – „Wie Master“ shows at once too.
  const slide = editing.state?.slides.find((item) => item.slideId === slideId);
  const own = slide?.ownBackground ? slide.backgroundFills : NO_FILLS;
  const draft = useBackgroundPreview(slideId);
  // Its picture's part being chosen on the slide: drawn with the part chosen so far.
  const ground = useCroppedGround(slideId, draft ? draft.fills : own);
  const masterShapes = parts.masterShapes;
  const ownGround = ground.some((layer) => layer.visible);
  const masterGround = !ownGround ? parts.masterGround : undefined;
  const drawsGround = !!masterShapes && (ownGround || !!masterGround);
  const draftKey = draft?.key;
  const draftDone =
    !!draft?.settled && (sameFills(own, draft.fills) || !sameFills(own, draft.before));
  useEffect(() => {
    if (draftKey !== undefined && draftDone) backgroundPreviews.clear(slideId, draftKey);
  }, [slideId, draftKey, draftDone]);
  const pictures = [
    drawsGround ? masterShapes?.url : parts.background,
    // The master's ground decoded ahead: „Wie im Master“ shows it in the same frame.
    masterShapes ? parts.masterGround : null,
    ...elements.flatMap((element) => {
      const url = element.paint ? null : byId.get(element.id)?.url;
      return url ? [url] : [];
    }),
  ].filter((url): url is string => !!url);
  const decoded = useDecoded(pictures);
  const fonts = useFontsReady();
  // Shown once all it needs is in, then for good: an element whose picture comes later (one just
  // added, one LibreOffice draws now) shows its last look meanwhile, never the slide as before.
  const [ready, setReady] = useState(false);
  if (complete && decoded && fonts && !ready) setReady(true);
  const shown = ready || (complete && decoded && fonts);
  useEffect(() => {
    markComposed(slideId, shown);
    return () => markComposed(slideId, false);
  }, [slideId, shown]);
  for (const element of elements) if (element.paint) lastPainted.set(element.id, element);
  // Whether an element shows its own look now: drawn by the browser, or its picture decoded.
  const showsOwn = (element: EditableElement) => {
    const url = byId.get(element.id)?.url;
    return !!element.paint || (!!url && decodedLayers.has(url));
  };
  for (const element of elements) {
    const layer = byId.get(element.id);
    if (!element.paint && layer?.url && decodedLayers.has(layer.url)) {
      lastLayered.set(element.id, { element, layer });
    }
  }
  // Grouped or taken apart, what changed is how LibreOffice draws it, not how it looks: until the
  // new pictures are in, the elements as they were drawn stand in – a new group's elements, or a
  // group taken apart as it was, in place of all its elements.
  const ids = new Set(elements.map((element) => element.id));
  const apart = new Map<
    string,
    { element: EditableElement; layer: SlideLayers['layers'][number] }
  >();
  for (const element of elements) {
    if (showsOwn(element)) continue;
    for (const [id, was] of lastLayered) {
      if (ids.has(id) || !was.element.members?.includes(element.id)) continue;
      const members = elements.filter((item) => was.element.members!.includes(item.id));
      if (members.some((item) => !showsOwn(item))) apart.set(element.id, was);
    }
  }
  const standingIn = new Set<string>();

  const pageStyle = liveLayerStyle(
    editing.pageSize.width * PT_PER_CM,
    editing.pageSize.height * PT_PER_CM,
  );
  return (
    <>
      <div
        data-compose-layer={slideId}
        data-compose-shown={shown || undefined}
        aria-hidden
        className={cn('pointer-events-none absolute inset-0 overflow-hidden select-none', rounded)}
        style={{ ...pageStyle, visibility: shown ? undefined : 'hidden' }}
      >
        {drawsGround && masterShapes ? (
          <>
            {masterGround ? (
              <SwapImage src={masterGround} alt="" draggable={false} />
            ) : (
              <SlideGround
                fills={ground}
                aspect={
                  editing.pageSize.height > 0
                    ? editing.pageSize.width / editing.pageSize.height
                    : 16 / 9
                }
                pictureUrl={(path) => pictureUrl(deck.id, path)}
              />
            )}
            {masterShapes.url && masterShapes.box && (
              <SwapImage
                src={masterShapes.url}
                alt=""
                draggable={false}
                className="absolute max-w-none"
                style={{
                  left: `${masterShapes.box.x * 100}%`,
                  top: `${masterShapes.box.y * 100}%`,
                  width: `${masterShapes.box.w * 100}%`,
                  height: `${masterShapes.box.h * 100}%`,
                }}
              />
            )}
          </>
        ) : (
          <SwapImage src={parts.background} alt="" draggable={false} />
        )}
        {elements.map((element) => {
          const frame = shownFrame(element, preview, peers.drags.get(element.id));
          const typing = editing.textEditing === element.id;
          const group = apart.get(element.id);
          if (group) {
            // Once, for the first of its elements: the group as it was drawn.
            if (standingIn.has(group.element.id)) return null;
            standingIn.add(group.element.id);
            return (
              <LayerItem
                key={group.element.id}
                element={group.element}
                layer={group.layer}
                from={group.element}
                to={group.element}
                tilt={null}
                typing={false}
                stand={undefined}
                deckId={deck.id}
              />
            );
          }
          if (element.members && !showsOwn(element)) {
            // A new group: its elements as they were drawn, moved with it.
            const dx = frame.bbox.x - element.bbox.x;
            const dy = frame.bbox.y - element.bbox.y;
            return element.members.map((id) => {
              const painted = lastPainted.get(id);
              const layered = lastLayered.get(id);
              const was = painted ?? layered?.element;
              if (!was) return null;
              const to = { ...was, bbox: { ...was.bbox, x: was.bbox.x + dx, y: was.bbox.y + dy } };
              return painted ? (
                <PaintedItem
                  key={id}
                  element={painted}
                  frame={to}
                  typing={false}
                  deckId={deck.id}
                />
              ) : (
                <LayerItem
                  key={id}
                  element={layered!.element}
                  layer={layered!.layer}
                  from={layered!.element}
                  to={to}
                  tilt={null}
                  typing={false}
                  stand={undefined}
                  deckId={deck.id}
                />
              );
            });
          }
          if (element.paint) {
            return (
              <PaintedItem
                key={element.id}
                element={element}
                frame={frame}
                typing={typing}
                deckId={deck.id}
              />
            );
          }
          const layer = byId.get(element.id);
          return (
            <LayerItem
              key={element.id}
              element={element}
              layer={layer}
              from={drawnAt?.get(element.id) ?? element}
              to={frame}
              tilt={
                preview?.elementId === element.id && preview.tilt !== undefined
                  ? preview.tilt
                  : element.tilt
              }
              typing={typing}
              stand={lastPainted.get(element.id)}
              deckId={deck.id}
            />
          );
        })}
        {peers.picks.map((pick) => {
          // A group picked: framed round its parts.
          const element =
            elements.find((item) => item.id === pick.elementId) ??
            withChildren(shownElements).find((item) => item.id === pick.elementId);
          if (!element) return null;
          const frame = shownFrame(element, preview, peers.drags.get(element.id));
          return <PeerPickFrame key={`${pick.elementId}-${pick.name}`} pick={pick} frame={frame} />;
        })}
      </div>
    </>
  );
}

/** Someone else's pick: a frame in their colour with their name – nothing locked. */
function PeerPickFrame({ pick, frame }: { pick: PeerPick; frame: Frame }) {
  const { x, y, w, h } = frame.bbox;
  return (
    <div
      aria-hidden
      data-peer-pick={pick.elementId}
      className="pointer-events-none absolute rounded-mark"
      style={{
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        width: `${w * 100}%`,
        height: `${h * 100}%`,
        outline: `2px solid ${pick.color}`,
        transform: frame.rotation ? `rotate(${frame.rotation}deg)` : undefined,
      }}
    >
      <span
        className="absolute -top-5 left-0 rounded-badge px-1.5 text-xs leading-5 font-medium whitespace-nowrap text-white"
        style={{ background: pick.color }}
      >
        {pick.name}
      </span>
    </div>
  );
}

const NO_FILLS: readonly FillLayer[] = [];

/** Whether two backgrounds are the same layers. */
const sameFills = (a: readonly FillLayer[], b: readonly FillLayer[]) =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

/** Where an element shows now: dragged, as dragged – alone or among those picked together. */
function shownFrame(
  element: EditableElement,
  preview: ElementPreview | null,
  peerDrag?: LiveDrag,
): Frame {
  if (preview?.elementId === element.id) {
    return {
      bbox: preview.rect,
      rotation: preview.rotation ?? element.rotation,
      flip: preview.flip ?? element.flip,
    };
  }
  const inGroup = groupFrameOf(preview, element);
  if (inGroup) return { ...inGroup, flip: element.flip };
  // Someone else drags it: where they have it now (their own drag of it wins here).
  if (peerDrag) {
    const { x, y, w, h, rotation } = peerDrag;
    return { bbox: { x, y, w, h }, rotation, flip: element.flip };
  }
  return element;
}

const PaintedItem = memo(function PaintedItem({
  element,
  frame,
  typing,
  deckId,
}: {
  element: EditableElement;
  frame: Frame;
  typing: boolean;
  deckId: string;
}) {
  const shown =
    frame === element
      ? element
      : { ...element, bbox: frame.bbox, rotation: frame.rotation, flip: frame.flip ?? null };
  const src = element.picture?.src ? pictureUrl(deckId, element.picture.src) : undefined;
  const { pageSize } = useEditing();
  const textRef = useGrowMeasure(element.id, !!element.live?.autoGrow);
  return (
    <ElementView
      textRef={textRef}
      pageAspect={pageSize.height > 0 ? pageSize.width / pageSize.height : 16 / 9}
      pageWidthPt={pageSize.width * PT_PER_CM}
      element={shown}
      live={element.live}
      paint={element.paint!}
      src={src}
      typing={typing}
    />
  );
});

/** An element LibreOffice draws: its picture alone, placed where it is now, its live text over it. */
const LayerItem = memo(function LayerItem({
  element,
  layer,
  from,
  to,
  tilt,
  typing,
  stand,
  deckId,
}: {
  element: EditableElement;
  layer: SlideLayers['layers'][number] | undefined;
  from: Frame;
  to: Frame;
  tilt: EditableElement['tilt'];
  typing: boolean;
  /** How the browser drew it last (`paint`): shown until its first picture is decoded. */
  stand: EditableElement | undefined;
  deckId: string;
}) {
  const shown =
    to === element
      ? element
      : { ...element, bbox: to.bbox, rotation: to.rotation, flip: to.flip ?? null, tilt };
  const drawn = useSettledLayer(layer, from);
  const textRef = useGrowMeasure(element.id, !!element.live?.autoGrow);
  if (!drawn && stand?.paint) {
    return (
      <PaintedItem
        element={{ ...stand, bbox: to.bbox, rotation: to.rotation }}
        frame={to}
        typing={typing}
        deckId={deckId}
      />
    );
  }
  return (
    <>
      {drawn && (
        <RasterItem layer={drawn.layer} element={element} from={drawn.from} to={to} tilt={tilt} />
      )}
      {element.live && (
        <LiveElementView
          ref={textRef}
          element={shown}
          live={element.live}
          textOnly
          prompt="room"
          style={typing ? { visibility: 'hidden' } : undefined}
        />
      )}
    </>
  );
});

/**
 * An element's picture as it shows: a new one (its look changed) only once decoded – the one
 * before stays till then, placed from where it was drawn, never a blank frame.
 */
function useSettledLayer(
  layer: SlideLayers['layers'][number] | undefined,
  from: Frame,
): { layer: SlideLayers['layers'][number]; from: Frame } | null {
  const [shown, setShown] = useState<{ layer: SlideLayers['layers'][number]; from: Frame } | null>(
    null,
  );
  const url = layer?.url ?? null;
  const ready = !url || decodedLayers.has(url);
  // Decoded: rendered anew to take it (`shown` may be `null` already – setting it again would not
  // render, and the memoised item gets no new props: its first picture never showed).
  const [, decodedOne] = useState(0);
  useEffect(() => {
    if (!url || ready) return;
    let cancelled = false;
    const image = new Image();
    image.src = url;
    const done = () => {
      decodedLayers.add(url);
      if (!cancelled) decodedOne((n) => n + 1);
    };
    image.decode().then(done, done);
    return () => {
      cancelled = true;
    };
  }, [url, ready]);
  if (layer && ready) {
    if (shown?.layer !== layer) setShown({ layer, from });
    return { layer, from };
  }
  return shown;
}

/**
 * What the browser drew of each element last (by id): shown until its own picture comes, once
 * LibreOffice draws it (a shadow added, …) – not a frame without it.
 */
const lastPainted = new Map<string, EditableElement>();

/**
 * What LibreOffice drew of each element last (by id), its picture decoded: what stands in for it
 * once it is grouped or taken apart, until the new pictures are in.
 */
const lastLayered = new Map<
  string,
  { element: EditableElement; layer: SlideLayers['layers'][number] }
>();

/** Element pictures decoded once: shown at once from then on. */
const decodedLayers = new Set<string>();

/** Whether every one of `urls` has been decoded (failed ones count: they draw nothing anyway). */
function useDecoded(urls: readonly string[]): boolean {
  const key = urls.join('\n');
  const [decoded, setDecoded] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      key.split('\n').map((url) => {
        const image = new Image();
        image.src = url;
        return image.decode().then(
          () => decodedLayers.add(url),
          () => decodedLayers.add(url),
        );
      }),
    ).then(() => {
      if (!cancelled) requestAnimationFrame(() => !cancelled && setDecoded(key));
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  // Once all were decoded, a new set keeps showing what is there while it comes in.
  const [seen, setSeen] = useState(false);
  if (decoded === key && !seen) setSeen(true);
  return seen || decoded === key;
}

/** The fonts the page asked for are in: text laid out before would jump once they come. */
function useFontsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void document.fonts.ready.then(() => requestAnimationFrame(() => !cancelled && setReady(true)));
    return () => {
      cancelled = true;
    };
  }, []);
  return ready;
}

/**
 * A box that grows with its text is as high as the browser lays the text out: measured for its
 * frame (`heightOf`), which follows while it is typed in. The node measured is the one shown now
 * (a callback ref): the text is drawn by another node when the element changes how it is drawn
 * (emptied, filled, LibreOffice's picture or the browser's) – the one before, gone, measured 0
 * and the frame collapsed to a line. A height of 0 is never taken.
 */
function useGrowMeasure(elementId: string, autoGrow: boolean) {
  const { measure } = useEditing();
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const layer = node?.closest<HTMLElement>('[data-compose-layer]');
    if (!node || !layer || !autoGrow) return;
    const update = () => {
      if (!node.isConnected || node.offsetHeight === 0 || layer.offsetHeight === 0) return;
      measure(elementId, node.offsetHeight / layer.offsetHeight);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    observer.observe(layer);
    return () => {
      observer.disconnect();
      measure(elementId, null);
    };
  }, [node, elementId, autoGrow, measure]);
  return setNode;
}

/**
 * An element small, as it was drawn last – the browser's drawing of it or LibreOffice's picture
 * of it alone, centred in a `size` px square (the clipboard in the format panel's handle).
 * Nothing drawn of it yet (not on a slide seen here): `fallback`.
 */
export function ElementThumb({
  element,
  size,
  fallback = null,
}: {
  element: EditableElement;
  size: number;
  fallback?: ReactNode;
}) {
  const { pageSize } = useEditing();
  const { deck } = useViewerData();
  const painted = lastPainted.get(element.id) ?? (element.paint ? element : undefined);
  const layered = painted ? undefined : lastLayered.get(element.id);
  const shown = painted ?? layered?.element;
  // A line may be flat one way, not both.
  if (!shown || (shown.bbox.w <= 0 && shown.bbox.h <= 0)) return <>{fallback}</>;
  if (!shown.line && (shown.bbox.w <= 0 || shown.bbox.h <= 0)) return <>{fallback}</>;
  const aspect = pageSize.height > 0 ? pageSize.width / pageSize.height : 16 / 9;
  // The slide as high as puts the element's longer side across the square.
  const height = size / Math.max(shown.bbox.w * aspect, shown.bbox.h);
  const width = height * aspect;
  const src = painted?.picture?.src ? pictureUrl(deck.id, painted.picture.src) : undefined;
  return (
    <span
      aria-hidden
      className="relative block shrink-0 overflow-hidden"
      style={{ width: size, height: size }}
    >
      <span
        className="pointer-events-none absolute"
        style={{
          ...liveLayerStyle(pageSize.width * PT_PER_CM, pageSize.height * PT_PER_CM),
          width,
          height,
          left: size / 2 - (shown.bbox.x + shown.bbox.w / 2) * width,
          top: size / 2 - (shown.bbox.y + shown.bbox.h / 2) * height,
        }}
      >
        {painted ? (
          <ElementView
            pageAspect={aspect}
            pageWidthPt={pageSize.width * PT_PER_CM}
            element={painted}
            live={painted.live}
            paint={painted.paint!}
            src={src}
            typing={false}
          />
        ) : (
          <RasterItem
            layer={layered!.layer}
            element={layered!.element}
            from={layered!.element}
            to={layered!.element}
            tilt={null}
          />
        )}
      </span>
    </span>
  );
}
