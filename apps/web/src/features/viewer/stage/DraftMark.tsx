import { isPathStroke, type Author, type Rect } from '@slider/shared';
import { accentColor } from '@/lib/accent';
import { Icon } from '@/ui';
import type { Draft } from '../state/viewer-state';
import { EditableFrame } from './EditableFrame';
import { StrokePath } from './StrokePath';

interface DraftMarkProps {
  draft: Draft;
  author: Pick<Author, 'name' | 'color'>;
  aspectRatio: number;
  /** Draw the frame of a rect anchor (off when the anchor is a picked PowerPoint box). */
  frame?: boolean;
  /** The box was moved or resized. */
  onRectChange: (rect: Rect) => void;
  /** "In die Box schreiben": the box becomes a text box on the slide. */
  onWriteInside: (rect: Rect) => void;
}

/**
 * The unsent comment's mark: a box (B2) that moves and resizes, with name tag and the way to
 * write into it; a pin; or a drawing. A text box is its own mark (`TextBoxEditor`).
 */
export function DraftMark({
  draft,
  author,
  aspectRatio,
  frame = true,
  onRectChange,
  onWriteInside,
}: DraftMarkProps) {
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
        {draft.strokes.filter(isPathStroke).map((stroke, index) => (
          <StrokePath key={index} stroke={stroke} aspectRatio={aspectRatio} />
        ))}
      </svg>

      {frame && anchor.type === 'rect' && !draft.anchorFromStrokes && !draft.textBox && (
        <EditableFrame
          rect={anchor.rect}
          color={color}
          handles
          className="bg-white/5"
          title="Ziehen zum Verschieben, Ecken zum Ändern der Größe"
          onCommit={(rect, done) => {
            onRectChange(rect);
            done();
          }}
        >
          <span
            className="absolute -top-6 left-[-2px] rounded-t-thumb rounded-br-thumb px-1.5 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap text-white"
            style={{ backgroundColor: color }}
          >
            {author.name.split(' ')[0]}
          </span>
          <button
            type="button"
            title="In die Box schreiben"
            aria-label="In die Box schreiben"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onWriteInside(anchor.rect);
            }}
            className="absolute -top-7 right-[-2px] flex size-6 cursor-pointer items-center justify-center rounded-control-sm text-white shadow-[0_1px_4px_rgb(0_0_0/0.35)] hover:brightness-110"
            style={{ backgroundColor: color }}
          >
            <Icon name="edit" size={14} />
          </button>
        </EditableFrame>
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
