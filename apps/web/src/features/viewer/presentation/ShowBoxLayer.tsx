import { useRef, useState, type PointerEvent } from 'react';
import type { Rect } from '@slider/shared';
import { cn } from '@/ui';
import { RectFrame } from '../stage/RectFrame';
import { markTint } from '../stage/lib/mark-chrome';
import { boxOpacity, type ShowBox } from './lib/show-times';

/** A drag shorter than this share of the slide is a click (steps on), not a box. */
const MIN_BOX = 0.01;

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/**
 * The slide's own box to draw boxes on (place it over the slide exactly): a drag with the mouse or
 * a pen draws one, a click goes through (`onClick`, else on to the show's own handlers).
 */
export function ShowBoxLayer({
  boxes,
  now,
  color,
  onDraw,
  onClick,
  className = 'cursor-crosshair',
}: {
  className?: string;
  boxes: readonly ShowBox[];
  now: number;
  color: string;
  onDraw: (rect: Rect) => void;
  onClick?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);

  const at = (event: PointerEvent) => {
    const box = root.current!.getBoundingClientRect();
    return {
      x: clamp((event.clientX - box.left) / box.width),
      y: clamp((event.clientY - box.top) / box.height),
    };
  };
  const rectTo = (to: { x: number; y: number }): Rect | null => {
    const from = start.current;
    if (!from) return null;
    return {
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      w: Math.abs(to.x - from.x),
      h: Math.abs(to.y - from.y),
    };
  };

  return (
    <div
      ref={root}
      data-show-boxes
      className={cn('pointer-events-auto absolute inset-0 z-3 touch-none', className)}
      onPointerDown={(event) => {
        // Touch keeps its swipes and taps.
        if (event.pointerType === 'touch' || event.button !== 0) return;
        start.current = at(event);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!start.current) return;
        const rect = rectTo(at(event));
        setDraft(rect && (rect.w > MIN_BOX || rect.h > MIN_BOX) ? rect : null);
      }}
      onPointerUp={(event) => {
        const rect = rectTo(at(event));
        start.current = null;
        setDraft(null);
        if (rect && rect.w > MIN_BOX && rect.h > MIN_BOX) {
          // A box, not a step on.
          event.stopPropagation();
          onDraw(rect);
          return;
        }
        if (onClick && event.pointerType !== 'touch') {
          event.stopPropagation();
          onClick();
        }
      }}
      onPointerCancel={() => {
        start.current = null;
        setDraft(null);
      }}
    >
      {boxes.map((box) => (
        <BoxFrame key={box.id} rect={box} color={color} opacity={boxOpacity(box, now)} />
      ))}
      {draft && <RectFrame rect={draft} color={color} dashed />}
    </div>
  );
}

function BoxFrame({ rect, color, opacity }: { rect: Rect; color: string; opacity: number }) {
  return (
    <div className="absolute inset-0" style={{ opacity }}>
      <RectFrame rect={rect} color={color} emphasized className="pointer-events-none">
        <span className="absolute inset-0" style={{ background: markTint(color) }} />
      </RectFrame>
    </div>
  );
}
