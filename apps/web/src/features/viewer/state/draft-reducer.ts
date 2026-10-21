import type { Anchor, Rect, Stroke } from '@slider/shared';
import { placeGap } from '../comments/lib/comment-selectors';
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

/**
 * Something in the draft would be lost if another draft took its place: strokes drawn for it,
 * text written on the slide, or what the composer holds (text, a recording, a sketch, an upload
 * running – `held`).
 */
export function draftHasContent(draft: Draft | null): boolean {
  if (!draft) return false;
  return (
    !!draft.held ||
    (draft.commentId === null && draft.strokes.length > 0) ||
    !!draft.textBox?.text.trim()
  );
}

/**
 * The action would start another draft – or drop the text written on the slide – while the open
 * one has content: it is ignored (the click only makes its slide active), and the composer is
 * nudged to say why. Sending or discarding it first is up to the person.
 */
export function keepsDraft(draft: Draft | null, action: ViewerAction): boolean {
  if (!draft || !draftHasContent(draft)) return false;
  switch (action.type) {
    case 'anchorPlaced':
      // On the same slide the mark moves – unless that would drop a text box with text in it.
      return draft.slideId !== action.slideId || !!draft.textBox?.text.trim();
    case 'textBoxPlaced':
    case 'strokeAdded':
      return draft.slideId !== action.slideId;
    case 'gapDraftStarted':
      return true;
    case 'drawingCommentStarted':
      return draft.commentId !== action.commentId;
    default:
      return false;
  }
}

export function draftReducer(draft: Draft | null, action: ViewerAction): Draft | null {
  if (draft && keepsDraft(draft, action)) return { ...draft, nudge: (draft.nudge ?? 0) + 1 };
  switch (action.type) {
    case 'draftHeld':
      return !draft || !!draft.held === action.held ? draft : { ...draft, held: action.held };
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
      // A new revision (or hiding slides) took the draft's slide away: the draft – and what is
      // written, recorded or drawn in the composer – stays, flagged, until it is discarded or the
      // slide is back. A gap draft moves along to where its gap is now (`placeGap`).
      let slideGone: boolean;
      let anchor = draft.anchor;
      if (draft.slideId !== null) slideGone = !action.slideIds.includes(draft.slideId);
      else if (anchor.type !== 'gap') return draft;
      else {
        const place = placeGap(
          anchor,
          action.slideIds.map((id) => ({ id })),
        );
        slideGone = place === null;
        if (
          place &&
          (place.afterSlideId !== anchor.afterSlideId ||
            place.beforeSlideId !== anchor.beforeSlideId)
        )
          anchor = { type: 'gap', ...place };
      }
      if (anchor === draft.anchor && slideGone === !!draft.slideGone) return draft;
      return { ...draft, anchor, slideGone };
    }
    default:
      return draft;
  }
}
