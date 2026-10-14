import { isPathStroke, type Author, type Rect } from '@slider/shared';
import { useEffect, useEffectEvent } from 'react';
import { accentColor } from '@/lib/accent';
import { focusCommentField } from '../lib/composer-focus';
import { isTypingTarget } from '../lib/dom';
import { useStageRegistry } from '../state/stage-registry';
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
  /** Double click into the box (or typing right after drawing it): it becomes a text box on the slide. */
  onWriteInside: (rect: Rect, text?: string) => void;
}

/**
 * The unsent comment's mark: a box (B2) that moves and resizes, with name tag – a double click
 * or simply typing writes into it, ↵ / Tab go to the comment instead; a pin; or a drawing. A text
 * box is its own mark (`TextBoxEditor`).
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
  const registry = useStageRegistry();
  const { anchor } = draft;
  const box =
    anchor.type === 'rect' && !draft.anchorFromStrokes && !draft.textBox && !draft.commentId
      ? anchor
      : null;
  const framed = frame && box !== null;

  // Right after drawing a box nothing has focus: the first key decides where the text goes.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!box || event.defaultPrevented || isTypingTarget(event.target)) return;
    // The composer (its recorder takes Space and ↵) and dialogs keep their keys.
    if (event.target instanceof Element && event.target.closest('dialog, form[data-composer]'))
      return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
      if (focusCommentField()) event.preventDefault();
      return;
    }
    if (event.key.length !== 1) return;
    if (framed) {
      event.preventDefault();
      onWriteInside(box.rect, event.key);
    } else {
      // A picked PowerPoint box: the key goes on into the comment field.
      focusCommentField();
    }
  });
  useEffect(() => {
    if (!box) return;
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    // Capture: before the viewer's single-key shortcuts (F, B, G).
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [box]);

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

      {framed && (
        <EditableFrame
          rect={box.rect}
          color={color}
          handles
          className="bg-white/5"
          title="Ziehen zum Verschieben, Ecken zum Ändern der Größe, Tippen schreibt hinein, ↵ zum Kommentar"
          onDoubleClick={() => onWriteInside(box.rect)}
          // The composer next to the box follows it live.
          onPreview={(rect) => registry.setMarkPreview(rect ? { threadId: null, rect } : null)}
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
