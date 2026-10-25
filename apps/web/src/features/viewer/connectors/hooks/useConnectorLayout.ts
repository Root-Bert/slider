import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { afterCommit, commitPending, rafThrottle } from '@/lib/dom';
import type { ConnectorAnchor, ConnectorExit } from '../../comments/lib/comment-selectors';
import {
  layoutBlobConnectors,
  layoutConnectors,
  type Box,
  type ConnectorRequest,
} from '../lib/connector-routing';
import { roundedPath } from '@/lib/rounded-path';
import { useStageRegistry } from '../../state/stage-registry';

export interface ConnectorItem {
  threadId: string;
  color: string;
  /** A mark on the slide, or – for comments in the gap right of the slide – the gap key. */
  source:
    | { kind: 'mark'; anchor: ConnectorAnchor; exit: ConnectorExit }
    | { kind: 'gap'; gapKey: string };
}

/** One slide whose lines are drawn: its marks → its comment column (and its gap's bubble). */
export interface ConnectorRoute {
  slideId: string;
  /** Divider left of the slide (`null` for the first slide) and right of it. */
  prevGapKey: string | null;
  nextGapKey: string;
  items: ConnectorItem[];
}

export interface MeasuredConnector {
  threadId: string;
  color: string;
  /** SVG path data, relative to the connector layer (see `useConnectorLayout`). */
  d: string;
}

/** Shapes the lines pass behind – cut out of the lines' mask. */
export type Cutout =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; box: Box }
  | { kind: 'fill'; box: Box }
  | { kind: 'path'; d: string; transform: string; width: number };

export interface ConnectorLayout {
  lines: MeasuredConnector[];
  /** Height of the scroller's viewport: the layer's SVG covers it. */
  height: number;
  cutouts: Cutout[];
}

/** What React renders per line; its geometry is written straight to the DOM (see below). */
export type ConnectorLine = Omit<MeasuredConnector, 'd'>;

const EMPTY: ConnectorLayout = { lines: [], height: 0, cutouts: [] };
const NO_LINES: ConnectorLine[] = [];

/** Lines enter the card next to its avatar. */
const CARD_ENTRY_X = 26;
const COMPACT_ENTRY_X = 18;
/** Bus rows start this far below the header and end this far above the cards. */
const BUS_BELOW_HEADER = 8;
const BUS_ABOVE_CARDS = 14;
/** Lines to lower bands run down the half-gap beside the column, this far from both edges. */
const MARGIN_INSET = 4;
/** Lanes of the first slide stay this far right of the timeline's left edge. */
const FIRST_SLIDE_CORRIDOR = 12;
/** A card whose top is hidden under the header gets no line. */
const VISIBLE_SLACK = 4;
/** Gap kept around a mark the lines pass behind. */
const CUTOUT_PAD = 2;

/**
 * Sent (bubbling, `detail`: ms) by elements that start a script animation moving a line's end –
 * cards gliding to another band. The lines then re-measure every frame until it is over: no
 * DOM change reports the frames in between.
 */
const FOLLOW_EVENT = 'slider:connectors-follow';

/** Lets the connector lines follow an animation of `element` (or its contents) for `ms`. */
export function followConnectors(element: Element, ms: number): void {
  element.dispatchEvent(new CustomEvent(FOLLOW_EVENT, { bubbles: true, detail: ms }));
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const relative = (rect: DOMRect, origin: DOMRect): Box => ({
  left: rect.left - origin.left,
  right: rect.right - origin.left,
  top: rect.top - origin.top,
  bottom: rect.bottom - origin.top,
});

const centreX = (element: Element, origin: DOMRect) => {
  const rect = element.getBoundingClientRect();
  return (rect.left + rect.right) / 2 - origin.left;
};

/**
 * Measures marks, cards and the control row of every routed slide and routes the connector
 * lines between them. Each slide routes in its own corridor – from the middle of the gap before
 * it to the middle of the gap after it – so lines of different slides never cross.
 *
 * Coordinates are relative to the connector layer: a zero-height `sticky top-0` element inside
 * the scrolled content, so x is in content space (the lines scroll sideways natively, in the
 * same frame as slides and cards – no re-measure) and y is in the scroller's viewport, like
 * the sticky header holding the marks. Re-measures, committed before the next paint, when the
 * comment area scrolls vertically (cards move under the fixed marks; once per frame), anything
 * in the timeline resizes or moves (right away), or the window resizes.
 *
 * Only which lines there are (and their colours) goes through React. Path data, the SVG's height
 * and the mask's cutouts change nearly every frame of a scroll, drag or fold – they are written
 * into `svg` directly, and only where they changed: a React render of every line and cutout per
 * frame was most of the cost with many comments.
 */
export function useConnectorLayout({
  layer,
  svg,
  routes,
  enabled,
}: {
  /** The connector layer (see above); its parent is the scrolled content. */
  layer: HTMLElement | null;
  /** The lines' SVG: one `path[data-connector-id]` per line, the cutouts' `[data-connector-cutouts]`. */
  svg: SVGSVGElement | null;
  routes: readonly ConnectorRoute[];
  enabled: boolean;
}): ConnectorLine[] {
  const registry = useStageRegistry();
  const [lines, setLines] = useState<ConnectorLine[]>(NO_LINES);
  const rendered = useRef({ lines: '', cutouts: '' });

  useEffect(() => {
    const scroller = registry.getScroller();
    const wrapper = scroller?.parentElement;
    // A new SVG starts with an empty mask.
    rendered.current.cutouts = '';
    // Applied before the frame paints, so the lines never trail the cards by a frame.
    const commit = (next: ConnectorLayout) => {
      const key = next.lines.map((line) => `${line.threadId} ${line.color}`).join('\n');
      if (key !== rendered.current.lines) {
        rendered.current.lines = key;
        const structure = next.lines.map(({ threadId, color }) => ({ threadId, color }));
        flushSync(() => setLines(structure.length > 0 ? structure : NO_LINES));
      }
      if (!svg) return;
      const height = `${next.height}px`;
      if (svg.style.height !== height) svg.style.height = height;
      const cutouts = cutoutMarkup(next.cutouts);
      if (cutouts !== rendered.current.cutouts) {
        const group = svg.querySelector('[data-connector-cutouts]');
        if (group) {
          group.innerHTML = cutouts;
          rendered.current.cutouts = cutouts;
        }
      }
      const pathOf = new Map(next.lines.map((line) => [line.threadId, line.d]));
      for (const path of svg.querySelectorAll<SVGPathElement>('path[data-connector-id]')) {
        const d = pathOf.get(path.dataset.connectorId!);
        if (d !== undefined && path.getAttribute('d') !== d) path.setAttribute('d', d);
      }
    };

    const measure = () => {
      if (!enabled || !layer || !wrapper || !scroller || routes.length === 0) {
        commit(EMPTY);
        return;
      }
      const origin = layer.getBoundingClientRect();
      const stage = relative(scroller.getBoundingClientRect(), origin);
      // Top of the visible comment area: everything above it is the sticky header (track, then
      // the band of minimap, controls and split handle).
      const header =
        wrapper.querySelector('[data-connector-occluder]') ??
        wrapper.querySelector('[data-timeline-header]');
      const commentTop = header ? header.getBoundingClientRect().bottom - origin.top : 0;
      const busTop = commentTop + BUS_BELOW_HEADER;
      const visible = (box: Box) => box.bottom > commentTop && box.top < stage.bottom;
      const clipped = (box: Box): Box => ({ ...box, top: Math.max(box.top, commentTop) });

      const lines: MeasuredConnector[] = [];
      const cutouts: Cutout[] = [];
      const colorOf = new Map<string, string>();

      // Lines pass behind every visible card, bubble and blob. All rendered
      // ones, not just those in view: the lines scroll sideways without a re-measure.
      const area = scroller.querySelector('[data-comment-area]');
      for (const element of area?.querySelectorAll(
        '[data-comment-card], [data-connector-blob], [data-gap-bubble]',
      ) ?? []) {
        const box = relative(element.getBoundingClientRect(), origin);
        if (!visible(box)) continue;
        cutouts.push({ kind: 'fill', box: clipped(box) });
      }

      for (const route of routes) {
        for (const item of route.items) colorOf.set(item.threadId, item.color);
        const slideElement = registry.getSlideElement(route.slideId);
        if (!slideElement) continue;
        // Zoomed (`stage/lib/slide-zoom`), the slide box is bigger than its frame, which crops
        // it: lines leave the frame, from marks clamped into it.
        const slideRect = slideElement.getBoundingClientRect();
        const content = relative(slideRect, origin);
        const frame = slideElement.closest('[data-slide-frame]') ?? slideElement;
        const slide = relative(frame.getBoundingClientRect(), origin);
        // Either way: a portrait page in a 16:9 frame is cropped top and bottom.
        const cropped =
          content.right - content.left > slide.right - slide.left + 1 ||
          content.bottom - content.top > slide.bottom - slide.top + 1;
        const column = scroller.querySelector<HTMLElement>(
          `[data-column="${CSS.escape(route.slideId)}"]`,
        );
        const prevGap = route.prevGapKey ? registry.getGapElement(route.prevGapKey) : null;
        const nextGap = registry.getGapElement(route.nextGapKey);
        const corridor = {
          left: prevGap ? centreX(prevGap, origin) : slide.left - FIRST_SLIDE_CORRIDOR,
          right: nextGap ? centreX(nextGap, origin) : slide.right + FIRST_SLIDE_CORRIDOR,
        };

        // Cards of this column; lower brick bands are reached through the half-gaps.
        const cards = new Map<string, Box>();
        const compact = column?.dataset.mode === 'compact';
        const bandTops = new Map<string, number>();
        const placements = new Map<string, { band: string; margin: string | undefined }>();
        if (column) {
          for (const card of column.querySelectorAll<HTMLElement>('[data-comment-card]')) {
            const box = relative(card.getBoundingClientRect(), origin);
            cards.set(card.dataset.commentCard!, box);
          }
          for (const brick of column.querySelectorAll<HTMLElement>('[data-brick]')) {
            const { brick: id, band = '0', margin } = brick.dataset;
            const top = brick.getBoundingClientRect().top - origin.top;
            bandTops.set(band, Math.min(bandTops.get(band) ?? top, top));
            placements.set(id!, { band, margin });
          }
        }
        const marginOf = (threadId: string): ConnectorRequest['margin'] | null => {
          const placement = placements.get(threadId);
          if (placement?.margin !== 'left' && placement?.margin !== 'right') return undefined;
          const bandTop = bandTops.get(placement.band)!;
          // The turn-in above a band scrolled under the header can't be drawn.
          if (bandTop < commentTop + 30) return null;
          return { side: placement.margin, bandTop };
        };

        const blobElement = column?.querySelector<HTMLElement>('[data-connector-blob]');
        const blob = blobElement ? relative(blobElement.getBoundingClientRect(), origin) : null;

        const requests: ConnectorRequest[] = [];
        for (const item of route.items) {
          if (item.source.kind === 'gap') {
            // Straight down the divider from its marker to the gap bubble.
            const marker = nextGap?.querySelector('[data-gap-marker]');
            const bubble = scroller.querySelector(
              `[data-gap-bubble="${CSS.escape(item.source.gapKey)}"]`,
            );
            if (!marker || !bubble) continue;
            const x = centreX(marker, origin);
            const from = marker.getBoundingClientRect().bottom - origin.top;
            const box = relative(bubble.getBoundingClientRect(), origin);
            if (box.top < commentTop + VISIBLE_SLACK) continue;
            lines.push({
              threadId: item.threadId,
              color: item.color,
              d: `M${x} ${from}V${box.top}`,
            });
            continue;
          }
          const card = cards.get(item.threadId);
          // With the blob, every line ends there (the target is set by the routing).
          if (!blob && (!card || card.top < commentTop + VISIBLE_SLACK)) continue;
          const margin = card && !blob ? marginOf(item.threadId) : undefined;
          if (margin === null) continue;
          const entry = compact ? COMPACT_ENTRY_X : CARD_ENTRY_X;
          const target = card ? { x: card.left + entry, y: card.top } : { x: 0, y: 0 };
          const { anchor } = item.source;
          const x = (value: number) =>
            clamp(content.left + value * slideRect.width, slide.left, slide.right);
          const y = (value: number) =>
            clamp(content.top + value * slideRect.height, slide.top, slide.bottom);
          requests.push({
            id: item.threadId,
            anchor: { left: x(anchor.left), right: x(anchor.right) },
            start: {
              left: { x: x(anchor.start.left.x) - anchor.inset.left, y: y(anchor.start.left.y) },
              right: {
                x: x(anchor.start.right.x) + anchor.inset.right,
                y: y(anchor.start.right.y),
              },
              down: { x: x(anchor.bottom.x), y: y(anchor.bottom.y) + anchor.inset.bottom },
            },
            exit: item.source.exit,
            target,
            margin,
          });
        }
        if (requests.length === 0) {
          cutouts.push(...measureCutouts(slideElement, origin, cropped ? slide : null));
          continue;
        }

        let routed;
        if (blob) {
          if (blob.top < commentTop + VISIBLE_SLACK) continue;
          routed = layoutBlobConnectors(requests, { slide, corridor, blob });
        } else {
          const cardsTop = Math.min(...requests.map((request) => request.target.y));
          const columnBox = column ? relative(column.getBoundingClientRect(), origin) : null;
          const margins = columnBox && {
            left: { from: corridor.left + MARGIN_INSET, to: columnBox.left - MARGIN_INSET },
            right: { from: columnBox.right + MARGIN_INSET, to: corridor.right - MARGIN_INSET },
          };
          routed = layoutConnectors(requests, {
            slide,
            corridor,
            busTop,
            busBottom: Math.max(busTop, cardsTop - BUS_ABOVE_CARDS),
            obstacles: cards,
            margins: margins ?? undefined,
          });
        }
        for (const connector of routed)
          lines.push({
            threadId: connector.id,
            color: colorOf.get(connector.id) ?? 'var(--color-fg)',
            d: roundedPath(connector.points),
          });
        cutouts.push(...measureCutouts(slideElement, origin, cropped ? slide : null));
      }

      commit({
        lines,
        height: stage.bottom - stage.top,
        cutouts,
      });
    };

    const throttled = rafThrottle(measure);
    throttled.schedule();
    // DOM changes and resizes are measured right away – every one: their callbacks run before
    // the next paint, while a frame requested from them can land a frame late – then that frame
    // shows cards and slides already moved (a minimap fold, committed outside the frame's
    // callbacks) under lines still at the old spot. Deferring all but the first per frame did
    // exactly that: a fold frame brings a commit and resizes of header and comment area.
    // A commit that batches layout reads (`afterCommit`: card glides, the minimap bracket) is
    // measured after its writes: before them it would force a second layout, and miss the glides
    // just started.
    let deferred = false;
    let disposed = false;
    const measureNow = () => {
      throttled.cancel();
      if (deferred) return;
      if (!commitPending()) {
        measure();
        return;
      }
      deferred = true;
      afterCommit(() => () => {
        deferred = false;
        if (!disposed) measure();
      });
    };

    const resizeObserver = new ResizeObserver(measureNow);
    const observe = (element: Element | null | undefined) => {
      if (element) resizeObserver.observe(element);
    };
    observe(wrapper);
    for (const header of wrapper?.querySelectorAll('[data-timeline-header]') ?? []) observe(header);
    observe(wrapper?.querySelector('[data-comment-area]'));
    // Slides, columns and cards move without resizing when the split or the brick layout change:
    // watch their inline styles and the rendered window too.
    const mutationObserver = new MutationObserver((records) => {
      if (needsRemeasure(records, layer)) measureNow();
    });
    if (scroller)
      mutationObserver.observe(scroller, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['style'],
      });
    // Sideways the lines scroll with the content; only a vertical scroll (cards moving under the
    // fixed marks) needs a re-measure.
    let scrollTop = scroller?.scrollTop ?? 0;
    const onScroll = () => {
      if (!scroller || scroller.scrollTop === scrollTop) return;
      scrollTop = scroller.scrollTop;
      throttled.schedule();
    };
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    wrapper?.addEventListener('transitionend', throttled.schedule);
    window.addEventListener('resize', throttled.schedule);
    // Frame by frame while an animation moves line ends (`followConnectors`), one frame past it.
    // Past `ms` too while the sender still animates: an animation started in a commit only begins
    // on the next frame, so it ends up to a frame later than `ms` – and its last step, unmeasured,
    // would leave the lines a few pixels off until something else re-measures.
    let followUntil = 0;
    let followFrame = 0;
    const followed = new Set<Element>();
    const animating = () =>
      [...followed].some((element) =>
        element
          .getAnimations({ subtree: true })
          .some(
            (animation) =>
              animation.playState === 'running' &&
              Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)),
          ),
      );
    const follow = (now: number) => {
      measure();
      if (now < followUntil || animating()) followFrame = requestAnimationFrame(follow);
      else {
        followFrame = 0;
        followed.clear();
      }
    };
    const onFollow = (event: Event) => {
      const ms =
        event instanceof CustomEvent && typeof event.detail === 'number' ? event.detail : 0;
      followUntil = Math.max(followUntil, performance.now() + ms);
      if (event.target instanceof Element) followed.add(event.target);
      // Right away too: the animation has just started, and this frame shows its first step.
      measureNow();
      if (!followFrame) followFrame = requestAnimationFrame(follow);
    };
    wrapper?.addEventListener(FOLLOW_EVENT, onFollow);

    return () => {
      disposed = true;
      throttled.cancel();
      cancelAnimationFrame(followFrame);
      wrapper?.removeEventListener(FOLLOW_EVENT, onFollow);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      scroller?.removeEventListener('scroll', onScroll);
      wrapper?.removeEventListener('transitionend', throttled.schedule);
      window.removeEventListener('resize', throttled.schedule);
    };
  }, [layer, svg, registry, routes, enabled]);

  return lines;
}

const num = (value: number) => Math.round(value * 10) / 10;
const attr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The cutouts as mask markup (black: the lines are hidden there). */
function cutoutMarkup(cutouts: readonly Cutout[]): string {
  return cutouts
    .map((cutout) => {
      if (cutout.kind === 'circle')
        return `<circle cx="${num(cutout.cx)}" cy="${num(cutout.cy)}" r="${num(cutout.r)}" fill="black"/>`;
      if (cutout.kind === 'path')
        return `<path d="${attr(cutout.d)}" transform="${attr(cutout.transform)}" fill="none" stroke="black" stroke-width="${num(cutout.width)}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
      const { box } = cutout;
      const rect = `x="${num(box.left)}" y="${num(box.top)}" width="${num(box.right - box.left)}" height="${num(box.bottom - box.top)}"`;
      return cutout.kind === 'fill'
        ? `<rect ${rect} rx="12" fill="black"/>`
        : `<rect ${rect} rx="4" fill="none" stroke="black" stroke-width="6"/>`;
    })
    .join('');
}

/**
 * Mark shapes on a slide ([data-mark] in the annotation layer) as mask cutouts, so the lines run
 * behind pins, frames and drawings instead of over them. On a zoomed slide only marks in its
 * `frame` count – cropped ones would cut holes beside it – and drawings, which can reach out of
 * it, are left out.
 */
function measureCutouts(slideElement: HTMLElement, origin: DOMRect, frame: Box | null): Cutout[] {
  const cutouts: Cutout[] = [];
  const outside = (rect: DOMRect) => {
    if (!frame) return false;
    const box = relative(rect, origin);
    return (
      box.right < frame.left ||
      box.left > frame.right ||
      box.bottom < frame.top ||
      box.top > frame.bottom
    );
  };
  for (const mark of slideElement.querySelectorAll<HTMLElement | SVGElement>('[data-mark]')) {
    const kind = mark.dataset.mark;
    if (kind === 'pin') {
      const dot = (mark.firstElementChild ?? mark).getBoundingClientRect();
      if (outside(dot)) continue;
      cutouts.push({
        kind: 'circle',
        cx: (dot.left + dot.right) / 2 - origin.left,
        cy: (dot.top + dot.bottom) / 2 - origin.top,
        r: Math.max(dot.width, dot.height) / 2 + CUTOUT_PAD,
      });
    } else if (kind === 'frame') {
      const rect = mark.getBoundingClientRect();
      if (outside(rect)) continue;
      cutouts.push({ kind: 'rect', box: relative(rect, origin) });
    } else if (kind === 'stroke' && mark instanceof SVGPathElement && !frame) {
      const svg = mark.ownerSVGElement?.getBoundingClientRect();
      if (!svg) continue;
      cutouts.push({
        kind: 'path',
        d: mark.getAttribute('d') ?? '',
        transform: `translate(${svg.left - origin.left} ${svg.top - origin.top}) scale(${svg.width} ${svg.height})`,
        width: Number(mark.getAttribute('stroke-width') ?? 2) + 2 * CUTOUT_PAD,
      });
    }
  }
  return cutouts;
}

/**
 * Whether DOM changes in the scroller can move a line's ends. The lines themselves live in the
 * scroller as well, and so does the minimap, whose bracket follows every frame of a sideways
 * scroll (`data-connector-ignore`) – their own updates don't count.
 */
export function needsRemeasure(
  records: readonly Pick<MutationRecord, 'target'>[],
  layer: Element | null | undefined,
): boolean {
  return records.some((record) => {
    const { target } = record;
    if (layer?.contains(target)) return false;
    const element = target instanceof Element ? target : target.parentElement;
    return !element?.closest('[data-connector-ignore]');
  });
}
