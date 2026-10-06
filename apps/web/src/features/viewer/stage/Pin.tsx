import type { Comment, Point } from '@slider/shared';
import { cn } from '@/ui';
import { accentColor } from '@/lib/accent';
import { POWERPOINT_COLOR } from '../lib/colors';

export type MarkState = 'normal' | 'emphasized' | 'dimmed';

interface PinProps {
  comment: Comment;
  at: Point;
  state: MarkState;
  onActivate: () => void;
  onHover: (hovering: boolean) => void;
}

const excerpt = (body: string) => (body.length > 60 ? `${body.slice(0, 57)}…` : body);

/**
 * Interactive marker of a comment on the slide: an accent dot with a white ring, or the orange
 * "P" square for comments imported from PowerPoint (F1). Positioned in percent of the slide box.
 */
export function Pin({ comment, at, state, onActivate, onHover }: PinProps) {
  const fromPowerPoint = comment.source === 'pptx';
  const label = `Kommentar von ${comment.author.name}${comment.body ? `: ${excerpt(comment.body)}` : ''}`;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onActivate();
      }}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      className={cn(
        'pointer-events-auto absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center transition-[opacity,transform] duration-200',
        state === 'dimmed' && 'opacity-30',
        state === 'emphasized' && 'z-10 scale-125',
      )}
      style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
    >
      {fromPowerPoint ? (
        <span
          className="flex size-5 items-center justify-center rounded-[5px] text-[11px] leading-none font-semibold text-white shadow-[0_0_0_1.5px_rgb(255_255_255/0.9),0_2px_6px_rgb(0_0_0/0.4)]"
          style={{ backgroundColor: POWERPOINT_COLOR }}
        >
          P
        </span>
      ) : (
        <span
          className="size-3.5 rounded-full shadow-[0_0_0_2px_white,0_2px_6px_rgb(0_0_0/0.45)]"
          style={{ backgroundColor: accentColor(comment.author.color) }}
        />
      )}
    </button>
  );
}
