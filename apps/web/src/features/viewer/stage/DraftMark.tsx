import type { Author } from '@slider/shared';
import { accentColor } from '@/lib/accent';
import type { Draft } from '../state/viewer-state';
import { RectFrame } from './RectFrame';
import { StrokePath } from './StrokePath';

interface DraftMarkProps {
  draft: Draft;
  author: Pick<Author, 'name' | 'color'>;
  aspectRatio: number;
}

const HANDLE_POSITIONS = [
  '-top-1 -left-1',
  '-top-1 -right-1',
  '-bottom-1 -left-1',
  '-bottom-1 -right-1',
];

/** The unsent comment's mark: frame with corner handles and name tag (B2), pin, or drawing. */
export function DraftMark({ draft, author, aspectRatio }: DraftMarkProps) {
  const color = accentColor(author.color);
  const { anchor } = draft;

  return (
    <>
      <svg
        className="absolute inset-0 size-full overflow-visible"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        aria-hidden
      >
        {draft.strokes.map((stroke, index) => (
          <StrokePath key={index} stroke={stroke} aspectRatio={aspectRatio} />
        ))}
      </svg>

      {anchor.type === 'rect' && !draft.anchorFromStrokes && (
        <RectFrame rect={anchor.rect} color={color} className="bg-white/5">
          <span
            className="absolute -top-6 left-[-2px] rounded-t-[4px] rounded-br-[4px] px-1.5 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap text-white"
            style={{ backgroundColor: color }}
          >
            {author.name.split(' ')[0]}
          </span>
          {HANDLE_POSITIONS.map((position) => (
            <span
              key={position}
              aria-hidden
              className={`absolute size-2 rounded-[2px] bg-white ${position}`}
            />
          ))}
        </RectFrame>
      )}

      {anchor.type === 'point' && (
        <span
          aria-hidden
          className="absolute size-4 -translate-x-1/2 -translate-y-1/2 animate-pop-in rounded-full shadow-[0_0_0_2px_white,0_0_0_6px_rgb(255_255_255/0.2)]"
          style={{
            left: `${anchor.point.x * 100}%`,
            top: `${anchor.point.y * 100}%`,
            backgroundColor: color,
          }}
        />
      )}
    </>
  );
}
