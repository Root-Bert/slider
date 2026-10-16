import { isPathStroke, type Author, type Point, type Rect } from '@slider/shared';
import { useEffect, useEffectEvent, useState } from 'react';
import { accentColor } from '@/lib/accent';
import { isTypingTarget } from '@/lib/dom';
import { textAnnotation } from '../comments/lib/comment-selectors';
import { focusCommentField } from '../comments/lib/composer-focus';
import { usePointDrag } from './hooks/usePointDrag';
import { useStageRegistry } from '../state/stage-registry';
import type { Draft } from '../state/viewer-state';
import { EditableFrame } from './EditableFrame';
import { StrokePath } from './StrokePath';
import { TextMark } from './TextBox';

interface DraftMarkProps {
  draft: Draft;
  author: Pick<Author, 'name' | 'color'>;
  aspectRatio: number;
  /** Draw the frame of a rect anchor (off when the anchor is a picked PowerPoint box). */
  frame?: boolean;
  /** The box was moved or resized. */
  onRectChange: (rect: Rect) => void;
  /** The pin was dragged elsewhere. */
  onPointChange: (point: Point) => void;
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
  onPointChange,
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
  const point = anchor.type === 'point' ? anchor.point : null;
  // Text already on the slide that the comment is being added to (its own mark steps aside).
  const storedText = draft.commentId && !draft.textBox ? textAnnotation(draft) : null;
  const [pinShift, setPinShift] = useState<{ dx: number; dy: number } | null>(null);
  // The pin moves; the composer next to it follows live.
  const pinDrag = usePointDrag({
    clamp: (dx, dy) =>
      point
        ? {
            dx: Math.min(1 - point.x, Math.max(-point.x, dx)),
            dy: Math.min(1 - point.y, Math.max(-point.y, dy)),
          }
        : { dx: 0, dy: 0 },
    onPreview: (shift) => {
      setPinShift(shift);
      registry.setMarkPreview(
        shift && point
          ? { threadId: null, rect: { x: point.x + shift.dx, y: point.y + shift.dy, w: 0, h: 0 } }
          : null,
      );
    },
    onDrop: (shift, done) => {
      if (point) onPointChange({ x: point.x + shift.dx, y: point.y + shift.dy });
      done();
    },
  });

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

      {storedText && (
        <TextMark
          stroke={{ ...storedText, color: author.color }}
          label={`„${storedText.text}“`}
          opacity={1}
          emphasized
          interactive={false}
          onActivate={() => {}}
        />
      )}

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

      {point && (
        <span
          aria-hidden
          title="Ziehen zum Verschieben"
          {...pinDrag.pointerProps}
          // Its click must not place a new pin on the slide below.
          onClick={(event) => event.stopPropagation()}
          className="pointer-events-auto absolute size-4 -translate-x-1/2 -translate-y-1/2 animate-pop-in cursor-move touch-none rounded-full shadow-[0_0_0_2px_white,0_0_0_6px_rgb(255_255_255/0.2)]"
          style={{
            left: `${(point.x + (pinShift?.dx ?? 0)) * 100}%`,
            top: `${(point.y + (pinShift?.dy ?? 0)) * 100}%`,
            backgroundColor: color,
          }}
        />
      )}
    </>
  );
}
