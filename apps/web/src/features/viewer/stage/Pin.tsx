import type { Comment, Point } from '@slider/shared';
import type { MouseEvent } from 'react';
import { cn, GoogleSlidesMark } from '@/ui';
import { accentColor } from '@/lib/accent';
import { isRemovedInSource } from '../comments/lib/comment-selectors';
import { usePointDrag, type PointDragOptions } from './hooks/usePointDrag';
import { markLabel, removedInSourceLabel } from '../comments/lib/labels';
import { PIN_DOT_RING } from './lib/mark-chrome';

export type MarkState = 'normal' | 'emphasized' | 'dimmed';

interface PinProps {
  comment: Comment;
  at: Point;
  state: MarkState;
  onActivate: () => void;
  onContextMenu?: (event: MouseEvent) => void;
  /** One's own pin: dragging it moves the comment. */
  drag?: PointDragOptions;
  /** The AI is working on the thread: Slider's slides deal through the dot and a ring pings out. */
  aiWorking?: boolean;
  className?: string;
}

const NO_DRAG: PointDragOptions = {
  clamp: () => ({ dx: 0, dy: 0 }),
  onPreview: () => {},
  onDrop: (_shift, done) => done(),
};

/**
 * Interactive marker of a comment on the slide: a dot in the author's accent with a white ring;
 * comments imported from PowerPoint add a small orange "P" badge (F1), Google comments Google Slides' mark. Positioned in percent of
 * the slide box.
 */
export function Pin({
  comment,
  at,
  state,
  onActivate,
  onContextMenu,
  drag,
  aiWorking,
  className,
}: PinProps) {
  const { pointerProps, wasDragged } = usePointDrag(drag ?? NO_DRAG);
  const fromPowerPoint = comment.source === 'pptx';
  const removed = isRemovedInSource(comment);
  const label = `${markLabel(comment)}${removed ? ` (${removedInSourceLabel(comment.source).replace(/^In /, 'in ')})` : ''}`;

  return (
    <button
      type="button"
      // Connector lines pass behind the dot (its first child), not the badge.
      data-mark="pin"
      aria-label={label}
      title={drag ? `${label} – ziehen zum Verschieben` : label}
      {...(drag ? pointerProps : {})}
      onClick={(event) => {
        event.stopPropagation();
        if (!wasDragged()) onActivate();
      }}
      onContextMenu={onContextMenu}
      className={cn(
        'pointer-events-auto absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center transition-[opacity,transform] duration-200',
        state === 'dimmed' && 'opacity-30',
        // Deleted in the PowerPoint file: still there, but quieter (F2).
        removed && state === 'normal' && 'opacity-55 grayscale',
        // Above the frames' click areas (a local order inside the slide box, no named layer).
        state === 'emphasized' ? 'z-(--z-raised) scale-125' : 'z-1',
        drag && 'cursor-move touch-none',
        className,
      )}
      style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
    >
      <span
        className={cn('relative size-3.5 rounded-full', PIN_DOT_RING)}
        style={{ backgroundColor: accentColor(comment.author.color) }}
      >
        {aiWorking && (
          // Slider's mark, its two slides dealt through again and again.
          <span aria-hidden className="absolute inset-[3px] overflow-hidden">
            <span className="ai-deal absolute" />
            <span className="ai-deal absolute" />
          </span>
        )}
        {aiWorking && <span aria-hidden className="ai-ping absolute inset-0 rounded-full" />}
      </span>
      {fromPowerPoint && (
        // Small "P" badge: still recognisable as a PowerPoint comment, in the author's colour.
        <span
          aria-hidden
          // Same mark as the avatar's PowerPoint badge (`ui/Avatar`).
          className="absolute -right-0.5 -bottom-0.5 flex size-3 items-center justify-center rounded-mark bg-powerpoint text-micro leading-none font-semibold text-primary-hover shadow-[0_0_0_1px_var(--color-fg)]"
        >
          P
        </span>
      )}
      {comment.source === 'gslides' && (
        // Google Slides' mark, where a PowerPoint comment has its "P" (BER-157).
        <span aria-hidden className="absolute -right-0.5 -bottom-0.5 flex size-3">
          <GoogleSlidesMark className="size-full" />
        </span>
      )}
    </button>
  );
}
