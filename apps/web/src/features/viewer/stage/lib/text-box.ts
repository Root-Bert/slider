import {
  clamp01,
  TEXT_FONT_SIZE,
  type AccentColor,
  type Anchor,
  type Rect,
  type Stroke,
  type TextStroke,
} from '@slider/shared';
import type { Draft, TextBoxDraft } from '../state/viewer-state';
import { strokesBounds } from './stroke-path';

/** "Text auf Folie" (B2): sizes of the on-slide text box, normalised to the slide box. */

/** On-screen size new text starts with, in px – turned into a size relative to the slide. */
const TARGET_FONT_PX = 16;
/** Bounds for the starting size, so text on tiny or huge slides keeps sensible proportions. */
const START_FONT_SIZE = { min: 0.025, max: 0.08 } as const;
/** Narrowest box (dragging or resizing) and the room a click needs before the right edge. */
export const MIN_TEXT_WIDTH = 0.04;
const CLICK_ROOM = 0.12;

/** Starting font size for a slide that is `slideHeightPx` tall (relative to the slide height). */
export function startFontSize(slideHeightPx: number): number {
  if (!(slideHeightPx > 0)) return TEXT_FONT_SIZE.default;
  const size = TARGET_FONT_PX / slideHeightPx;
  return round(Math.min(START_FONT_SIZE.max, Math.max(START_FONT_SIZE.min, size)));
}

/**
 * Where a click opens a text box: top-left at the pointer, nudged in so the first line fits.
 * The box then grows with the text (`width: null`).
 */
export function clickTextBox(point: { x: number; y: number }, fontSize: number) {
  return {
    x: Math.min(point.x, 1 - CLICK_ROOM),
    y: Math.min(point.y, Math.max(0, 1 - fontSize * 1.6)),
    width: null,
    minHeight: 0,
    fontSize,
  };
}

/** A dragged-open text box: fixed width, at least as tall as dragged. */
export function dragTextBox(rect: Rect, fontSize: number) {
  const x = Math.min(rect.x, 1 - MIN_TEXT_WIDTH);
  return {
    x,
    y: rect.y,
    width: Math.min(1 - x, Math.max(MIN_TEXT_WIDTH, rect.w)),
    minHeight: rect.h,
    fontSize,
  };
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** Rounds a measured box and keeps it on the slide. */
export function normalizeTextRect(rect: Rect): Rect {
  const x = round(clamp01(rect.x));
  const y = round(clamp01(rect.y));
  return {
    x,
    y,
    w: Math.max(0.001, round(Math.min(rect.w, 1 - x))),
    h: Math.max(0.001, round(Math.min(rect.h, 1 - y))),
  };
}

/** The text annotation to store, or `null` while the box is empty. */
export function textStrokeFromDraft(box: TextBoxDraft, color: AccentColor): TextStroke | null {
  const text = box.text.trim();
  if (!text) return null;
  const rect = normalizeTextRect(
    box.measured ?? { x: box.x, y: box.y, w: box.width ?? 0.2, h: Math.max(box.minHeight, 0.05) },
  );
  return {
    tool: 'text',
    color,
    ...rect,
    text,
    fontSize: Math.min(TEXT_FONT_SIZE.max, Math.max(TEXT_FONT_SIZE.min, box.fontSize)),
  };
}

/**
 * What the composer sends for a draft. The body is always the composer's comment – text on the
 * slide is stored apart from it. With a text box, the box is the anchor (the connector line starts
 * there); an empty box is dropped.
 */
export function draftSubmission(
  draft: Draft,
  body: string,
  color: AccentColor,
): { body: string; anchor: Anchor; strokes: Stroke[] } | null {
  const comment = body.trim();
  const textStroke = draft.textBox && textStrokeFromDraft(draft.textBox, color);
  if (textStroke) {
    const { x, y, w, h } = textStroke;
    return {
      body: comment,
      anchor: { type: 'rect', rect: { x, y, w, h }, shapeRef: null },
      strokes: [...draft.strokes, textStroke],
    };
  }
  const bounds = draft.textBox ? strokesBounds(draft.strokes) : null;
  const anchor: Anchor = bounds ? { type: 'rect', rect: bounds, shapeRef: null } : draft.anchor;
  return comment || draft.strokes.length > 0
    ? { body: comment, anchor, strokes: draft.strokes }
    : null;
}
