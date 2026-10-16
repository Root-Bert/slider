import type { Anchor, Rect, Stroke } from '@slider/shared';
import { strokesBounds } from '../stage/lib/stroke-path';
import type { Draft, TextBoxDraft, ViewerAction } from './viewer-types';

function strokeAnchor(strokes: readonly Stroke[]): Anchor | null {
  const bounds = strokesBounds(strokes);
  return bounds ? { type: 'rect', rect: bounds, shapeRef: null } : null;
}

/** Applies a new stroke list, keeping a stroke-derived anchor in sync. Empty → no draft. */
function withStrokes(draft: Draft, strokes: Stroke[], undone: Stroke[]): Draft | null {
  if (!draft.anchorFromStrokes) return { ...draft, strokes, undone };
  const anchor = strokeAnchor(strokes);
  return anchor ? { ...draft, anchor, strokes, undone } : null;
}

const rectAnchor = (rect: Rect): Anchor => ({ type: 'rect', rect, shapeRef: null });

/** Anchor of a text box before it has been measured. */
const placedTextRect = (box: TextBoxDraft): Rect => ({
  x: box.x,
  y: box.y,
  w: Math.max(box.width ?? 0, 0.01),
  h: Math.max(box.minHeight, 0.01),
});

export function draftReducer(draft: Draft | null, action: ViewerAction): Draft | null {
  switch (action.type) {
    case 'anchorPlaced':
      // Placing a mark on another slide starts over; on the same slide the drawing is kept
      // (a text box makes way – the mark is the anchor now).
      if (draft?.slideId === action.slideId)
        return { ...draft, anchor: action.anchor, anchorFromStrokes: false, textBox: null };
      return {
        slideId: action.slideId,
        anchor: action.anchor,
        anchorFromStrokes: false,
        strokes: [],
        undone: [],
        textBox: null,
        commentId: null,
      };
    case 'textBoxPlaced': {
      const same = draft?.slideId === action.slideId ? draft : null;
      const textBox: TextBoxDraft = {
        ...action.box,
        text: action.text ?? same?.textBox?.text ?? '',
        measured: null,
      };
      return {
        slideId: action.slideId,
        anchor: rectAnchor(placedTextRect(textBox)),
        anchorFromStrokes: false,
        strokes: same?.strokes ?? [],
        undone: same?.undone ?? [],
        textBox,
        commentId: null,
      };
    }
    case 'textBoxChanged': {
      if (!draft?.textBox) return draft;
      const textBox = { ...draft.textBox, ...action.patch };
      // Moving keeps the measured size until the editor reports the new box.
      const measured = textBox.measured && { ...textBox.measured, x: textBox.x, y: textBox.y };
      const rect = measured ?? placedTextRect(textBox);
      return { ...draft, anchor: rectAnchor(rect), textBox: { ...textBox, measured } };
    }
    case 'textBoxMeasured': {
      if (!draft?.textBox) return draft;
      const { measured } = draft.textBox;
      const { rect } = action;
      if (
        measured &&
        measured.x === rect.x &&
        measured.y === rect.y &&
        measured.w === rect.w &&
        measured.h === rect.h
      )
        return draft;
      return { ...draft, anchor: rectAnchor(rect), textBox: { ...draft.textBox, measured: rect } };
    }
    case 'strokeAdded': {
      const base: Draft =
        draft?.slideId === action.slideId
          ? draft
          : {
              slideId: action.slideId,
              anchor: { type: 'slide' },
              anchorFromStrokes: true,
              strokes: [],
              undone: [],
              textBox: null,
              commentId: null,
            };
      return withStrokes(base, [...base.strokes, action.stroke], []);
    }
    case 'drawingCommentStarted':
      return {
        slideId: action.slideId,
        anchor: action.anchor,
        anchorFromStrokes: false,
        strokes: action.strokes,
        undone: [],
        textBox: null,
        commentId: action.commentId,
        initialBody: action.text,
      };
    case 'gapDraftStarted':
      return {
        slideId: null,
        anchor: {
          type: 'gap',
          afterSlideId: action.afterSlideId,
          beforeSlideId: action.beforeSlideId,
        },
        anchorFromStrokes: false,
        strokes: [],
        undone: [],
        textBox: null,
        commentId: null,
      };
    case 'undo': {
      const last = draft?.strokes.at(-1);
      if (!draft || !last || draft.commentId) return draft;
      return withStrokes(draft, draft.strokes.slice(0, -1), [...draft.undone, last]);
    }
    case 'redo': {
      const next = draft?.undone.at(-1);
      if (!draft || !next || draft.commentId) return draft;
      return withStrokes(draft, [...draft.strokes, next], draft.undone.slice(0, -1));
    }
    case 'draftCancelled':
    case 'draftSubmitted':
      return null;
    case 'slidesReplaced': {
      if (!draft) return draft;
      const ids = new Set(action.slideIds);
      if (draft.slideId !== null) return ids.has(draft.slideId) ? draft : null;
      if (draft.anchor.type !== 'gap') return draft;
      const { afterSlideId, beforeSlideId } = draft.anchor;
      return (afterSlideId && !ids.has(afterSlideId)) || (beforeSlideId && !ids.has(beforeSlideId))
        ? null
        : draft;
    }
    default:
      return draft;
  }
}
