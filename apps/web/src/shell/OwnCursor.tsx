import type { MeResponse } from '@slider/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { accentColor } from '@/lib/accent';
import { queryKeys } from '@/lib/api';
import { api } from '@/lib/api-client';

/** Mouse only: touch and pens keep the system's pointer. */
const FINE = '(hover: hover) and (pointer: fine)';
/** Fields: their arrow is a text caret. */
const FIELDS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** What the pointer turns into (`index.css`, `.own-cursor[data-shape]`). */
export type CursorShape =
  | 'bubble'
  | 'pointer'
  | 'text'
  | 'resize'
  | 'split'
  | 'move'
  | 'grab'
  | 'grabbing'
  | 'crosshair'
  | 'blocked'
  | 'wait'
  | 'copy';

/**
 * The shape for a CSS cursor, and which way it points (degrees) – `null`: one we do not draw (a
 * picture of its own), the system's shows; `'none'`: no pointer at all (a presentation).
 */
function cursorShape(
  cursor: string,
  inField = false,
): { shape: CursorShape; angle: number } | 'none' | null {
  const at = (shape: CursorShape, angle = 0) => ({ shape, angle });
  switch (cursor) {
    case 'none':
      return 'none';
    case 'auto':
    case 'default':
      return at(inField ? 'text' : 'bubble');
    case 'pointer':
    case 'help':
    case 'context-menu':
    case 'zoom-in':
    case 'zoom-out':
      return at('pointer');
    case 'text':
      return at('text');
    case 'vertical-text':
      return at('text', 90);
    case 'ew-resize':
    case 'e-resize':
    case 'w-resize':
      return at('resize', 0);
    case 'ns-resize':
    case 'n-resize':
    case 's-resize':
      return at('resize', 90);
    case 'nwse-resize':
    case 'nw-resize':
    case 'se-resize':
      return at('resize', 45);
    case 'nesw-resize':
    case 'ne-resize':
    case 'sw-resize':
      return at('resize', -45);
    case 'col-resize':
      return at('split', 0);
    case 'row-resize':
      return at('split', 90);
    case 'move':
    case 'all-scroll':
      return at('move');
    case 'grab':
      return at('grab');
    case 'grabbing':
      return at('grabbing');
    case 'crosshair':
    case 'cell':
      // A quarter turn: coming from the arrow it spins in.
      return at('crosshair', 90);
    case 'not-allowed':
    case 'no-drop':
      return at('blocked');
    case 'wait':
    case 'progress':
      return at('wait');
    case 'copy':
    case 'alias':
      return at('copy');
    default:
      return null;
  }
}

/**
 * Your own pointer is your speech bubble in your colour – as on the website, the same bubble the
 * others see – round and a little playful: solid shapes and soft strokes in your colour, one white
 * edge. It becomes whatever the page asks for: the bubble grows over something to click, a slim
 * caret over text, a solid capsule turned the way a box resizes, two capsules crossed (a fat plus)
 * to move, a ring that tightens when it grabs, a dial-ticked ring turning in for the crosshair, a
 * ring with a slash, the bubble's dots pulsing while something works. One shape that morphs
 * between them.
 *
 * The system's pointer is hidden everywhere while ours is on (`data-own-cursor-on`), so it never
 * peeks out under ours. What an element asks for is read on entering it, with the hiding taken off
 * it and its ancestors for that moment (`data-own-cursor-read`); one we do not draw stays the
 * system's (`data-own-cursor-native`). A cursor the whole page takes (a box dragged, the hand, the
 * split handle) is read from `<html>`.
 */
export function OwnCursor() {
  // Only what is known already: asking `/me` signed out would send the page to the login.
  const { data } = useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.get<MeResponse>('/me'),
    enabled: false,
  });
  const color = data ? accentColor(data.viewer.author.color) : 'var(--color-accent-blue)';
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !matchMedia(FINE).matches) return;
    const root = document.documentElement;
    /** The element (and its ancestors) whose cursor the system draws, one we do not. */
    let native: Element[] = [];
    let pointer: { x: number; y: number } | null = null;
    /** The element last read – its cursor (or an ancestor's, inherited) may change in place. */
    let current: Element | null = null;
    let restyleFrame = 0;
    root.setAttribute('data-own-cursor-on', '');

    const set = (shape: CursorShape | 'native' | 'away', angle = 0) => {
      node.dataset.shape = shape;
      node.style.setProperty('--own-angle', `${angle}deg`);
    };
    const chain = (target: Element) => {
      const elements: Element[] = [];
      for (let el: Element | null = target; el; el = el.parentElement) elements.push(el);
      return elements;
    };
    const unmark = () => {
      for (const el of native) el.removeAttribute('data-own-cursor-native');
      native = [];
    };
    /** The cursor the element asks for – the hiding off it and its ancestors (inherited) meanwhile. */
    const asked = (target: Element) => {
      const elements = chain(target);
      for (const el of elements) el.setAttribute('data-own-cursor-read', '');
      const cursor = getComputedStyle(target).cursor;
      for (const el of elements) el.removeAttribute('data-own-cursor-read');
      return cursor;
    };
    /** What the whole page asks for now (`index.css` drag and hand rules, the split handle). */
    const pageCursor = (target: Element | null): string | null => {
      if (root.hasAttribute('data-frame-drag'))
        return root.style.getPropertyValue('--frame-drag-cursor').trim() || 'grabbing';
      // The hand (`useHandPan`) sits on the timeline's scroller, over all its parts.
      if (target?.closest('[data-hand-panning]')) return 'grabbing';
      if (target?.closest('[data-hand-pan]')) return 'grab';
      return root.style.cursor || null;
    };
    /** Reads what the element under the pointer asks for and turns into it. */
    const take = (target: Element | null) => {
      current = target;
      unmark();
      const page = pageCursor(target);
      if (page) {
        const kind = cursorShape(page);
        if (kind && kind !== 'none') return set(kind.shape, kind.angle);
      }
      if (!target) return set('away');
      const kind = cursorShape(asked(target), !!target.closest(FIELDS));
      if (kind === 'none') return set('away');
      if (!kind) {
        native = chain(target);
        for (const el of native) el.setAttribute('data-own-cursor-native', '');
        return set('native');
      }
      set(kind.shape, kind.angle);
    };
    const under = () => (pointer ? document.elementFromPoint(pointer.x, pointer.y) : null);

    const over = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      take(event.target instanceof Element ? event.target : null);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      pointer = { x: event.clientX, y: event.clientY };
      node.style.translate = `${event.clientX}px ${event.clientY}px`;
      if (node.dataset.shape === 'away')
        take(event.target instanceof Element ? event.target : null);
    };
    // A press may change what the element asks for (grab → grabbing): read it again.
    const press = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      node.dataset.pressed = event.type === 'pointerdown' ? 'true' : 'false';
      requestAnimationFrame(() => take(under()));
    };
    const away = () => {
      unmark();
      pointer = null;
      current = null;
      set('away');
    };
    // A drag, the hand or the split handle sets the page's cursor: follow it at once (our own
    // read/native marks are attributes too, but not watched ones).
    const observer = new MutationObserver(() => take(under()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-frame-drag', 'style'] });
    // The hand anywhere below (the timeline's scroller) – not `style` there: ours moves each frame.
    observer.observe(root, {
      attributes: true,
      subtree: true,
      attributeFilter: ['data-hand-pan', 'data-hand-panning'],
    });
    // Over everything: in the top layer (a popover), where a modal dialog and full screen are too –
    // put on top again each time one of them comes (the last one shown lies on top).
    const onTop = () => {
      if (typeof node.showPopover !== 'function') return;
      if (node.matches(':popover-open')) node.hidePopover();
      node.showPopover();
    };
    onTop();
    // A cursor changed in place under a resting pointer (a class or style swapped – the layers'
    // grab while turning, a hovered box): no `pointerover` comes, so read it again next frame.
    // A style counts only when its cursor changed – not a transform written every frame.
    const cursorIn = (style: string | null) =>
      /(?:^|;)\s*cursor\s*:\s*([^;]+)/.exec(style ?? '')?.[1]?.trim() ?? '';
    const restyled = new MutationObserver((changes) => {
      if (!current || restyleFrame) return;
      const touched = changes.some(({ target, attributeName, oldValue }) => {
        if (target === node || node.contains(target) || !target.contains(current)) return false;
        return (
          attributeName !== 'style' || (target as HTMLElement).style.cursor !== cursorIn(oldValue)
        );
      });
      if (!touched) return;
      restyleFrame = requestAnimationFrame(() => {
        restyleFrame = 0;
        // The element known, no hit test – one gone meanwhile: what is under the pointer now.
        take(current?.isConnected ? current : under());
      });
    });
    restyled.observe(root, {
      attributes: true,
      subtree: true,
      attributeOldValue: true,
      attributeFilter: ['class', 'style'],
    });
    const layers = new MutationObserver((changes) => {
      if (changes.some((change) => (change.target as Element).matches('dialog[open]'))) onTop();
    });
    layers.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['open'] });
    document.addEventListener('fullscreenchange', onTop);
    // Caught on the way down (capture): a part that stops a pointer event on its way up – the
    // layers view does, React stops it at the app's root – would leave the pointer standing.
    const early = { capture: true, passive: true } as const;
    addEventListener('pointerover', over, early);
    addEventListener('pointermove', move, early);
    addEventListener('pointerdown', press, early);
    addEventListener('pointerup', press, early);
    root.addEventListener('pointerleave', away);
    window.addEventListener('blur', away);
    return () => {
      observer.disconnect();
      layers.disconnect();
      restyled.disconnect();
      cancelAnimationFrame(restyleFrame);
      document.removeEventListener('fullscreenchange', onTop);
      if (node.matches(':popover-open')) node.hidePopover();
      unmark();
      root.removeAttribute('data-own-cursor-on');
      removeEventListener('pointerover', over, early);
      removeEventListener('pointermove', move, early);
      removeEventListener('pointerdown', press, early);
      removeEventListener('pointerup', press, early);
      root.removeEventListener('pointerleave', away);
      window.removeEventListener('blur', away);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      popover="manual"
      data-shape="away"
      className="own-cursor pointer-events-none fixed top-0 left-0 z-[2147483647]"
      style={{ ['--own-color' as string]: color }}
    >
      {/*
       * The one white edge round every part (`.own-cursor-turn`): the shape's outline grown,
       * softened and cut sharp again – round on diagonals and curves, the same width everywhere
       * (stacked drop-shadows left steps).
       */}
      <svg width="0" height="0" className="absolute">
        <filter
          id="own-cursor-edge"
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
          colorInterpolationFilters="sRGB"
        >
          <feMorphology in="SourceAlpha" operator="dilate" radius="1.25" result="grown" />
          <feGaussianBlur in="grown" stdDeviation="0.5" result="soft" />
          <feComponentTransfer in="soft" result="edge">
            <feFuncA type="linear" slope="4" intercept="-1" />
          </feComponentTransfer>
          <feFlood floodColor="#fff" />
          <feComposite in2="edge" operator="in" result="white" />
          <feMerge>
            <feMergeNode in="white" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </svg>
      <span className="own-cursor-turn">
        <span className="own-cursor-body" />
        <i className="own-cursor-hub" />
        <i className="own-cursor-tip" data-tip="1" />
        <i className="own-cursor-tip" data-tip="2" />
        <i className="own-cursor-tip" data-tip="3" />
        <i className="own-cursor-tip" data-tip="4" />
        <i className="own-cursor-bar" />
        <span className="own-cursor-dots">
          <i />
          <i />
          <i />
        </span>
      </span>
    </div>
  );
}
