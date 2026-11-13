import {
  MAX_ELEMENT_TEXT,
  MAX_PARAGRAPHS,
  type EditableElement,
  type LiveTextStyle,
  type Point,
  type Rect,
  type RichParagraph,
} from '@slider/shared';
import { centredBox, CM_PER_PX } from './insert-image';
import { fontCss } from './live/fonts';
import { DEFAULT_STYLE } from './live/model';

/*
 * What ⌘V puts on a slide from outside Slider (BER-202): a picture as a picture element
 * (`insert-image`), text as a new text box – as Figma does.
 */

/** What the clipboard holds, as the browser gives it (paste event or `navigator.clipboard`). */
export interface ClipboardContent {
  /** Picture files on it (`imageFilesOf`). */
  images: File[];
  text: string;
  html: string;
}

/** What a paste puts in: pictures, or text for a new text box. */
export type Pasted = { kind: 'images'; images: File[] } | { kind: 'text'; text: string } | null;

/**
 * What a paste from outside means. A picture wins (a screenshot, a file, one copied in a
 * browser – its HTML holds the `<img>`) – except beside text an office app put with its own
 * picture of it (Word, Excel, PowerPoint: HTML without a picture in it), where the text is meant.
 */
export function pastedOf({ images, text, html }: ClipboardContent): Pasted {
  const plain = text.replace(/\r\n?|[\u2028\u2029]/g, '\n');
  const hasText = plain.trim().length > 0;
  const textMeant = hasText && html.trim().length > 0 && !/<img[\s>]/i.test(html);
  if (images.length > 0 && !textMeant) return { kind: 'images', images };
  return hasText ? { kind: 'text', text: plain } : null;
}

/**
 * Pasted text as a text box's paragraphs, each line one, in `style`; blank lines at its start and
 * end dropped. `cut`: longer than a text box takes – the rest is left out.
 */
export function pastedParagraphs(
  text: string,
  style: LiveTextStyle,
): { paragraphs: RichParagraph[]; cut: boolean } {
  const lines = text
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/\s+$/, '')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''));
  let room = MAX_ELEMENT_TEXT;
  let cut = lines.length > MAX_PARAGRAPHS;
  const paragraphs: RichParagraph[] = [];
  for (const line of lines.slice(0, MAX_PARAGRAPHS)) {
    if (room <= 0) {
      cut = true;
      break;
    }
    const taken = line.slice(0, room);
    if (taken.length < line.length) cut = true;
    room -= taken.length;
    paragraphs.push({ align: 'left', runs: [{ ...style, text: taken }] });
  }
  return { paragraphs, cut };
}

/** The width (CSS px) a line of text takes in a style. */
export type MeasureText = (line: string, style: LiveTextStyle) => number;

const PX_PER_PT = 96 / 72;
const CM_PER_PT = 2.54 / 72;

/** The CSS font a text box draws `style` in (`fontCss`: the editor's own faces). */
const cssFont = (style: LiveTextStyle) =>
  `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.size}pt ${fontCss(style.font)}`;

/** Loads the face pasted text is measured in – else a narrower stand-in would be measured. */
export const loadPastedFont = async (style: LiveTextStyle): Promise<void> => {
  await document.fonts?.load(cssFont(style)).catch(() => undefined);
};

let context: CanvasRenderingContext2D | null | undefined;
/** Measured as the editor draws it (`loadPastedFont` first). */
const measureInCanvas: MeasureText = (line, style) => {
  if (context === undefined) context = document.createElement('canvas').getContext('2d');
  if (!context) return line.length * style.size * 0.55 * PX_PER_PT;
  context.font = cssFont(style);
  return context.measureText(line).width;
};

/** A new text box's inner space (`addedElement`): left + right, top + bottom (cm). */
const PADDING_X = 0.5;
const PADDING_Y = 0.25;
/** At most this share of the slide's width – longer lines wrap. */
const MAX_SHARE = 0.8;
/** Room left so LibreOffice's slightly wider letters do not wrap a line the browser did not. */
const SLACK = 1.05;
const LINE_HEIGHT = 1.2;

/**
 * Where a text box of `paragraphs` goes on a page of `page` (cm): as wide as its longest line (at
 * most 80 % of the slide, longer lines wrap), as high as its lines, centred on `at` and inside the
 * slide. Its height is a start – the box grows with its text.
 */
export function pastedTextBox(
  paragraphs: readonly RichParagraph[],
  style: LiveTextStyle,
  page: { width: number; height: number },
  at: Point = { x: 0.5, y: 0.5 },
  measure: MeasureText = measureInCanvas,
): Rect {
  const lines = paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''));
  const widths = lines.map((line) => measure(line, style) * CM_PER_PX * SLACK);
  const maxText = MAX_SHARE * page.width - PADDING_X;
  const textWidth = Math.min(maxText, Math.max(style.size * CM_PER_PT, ...widths));
  const rows = widths.reduce((sum, width) => sum + Math.max(1, Math.ceil(width / textWidth)), 0);
  const w = Math.min(1, (textWidth + PADDING_X) / page.width);
  const h = Math.min(1, (rows * style.size * LINE_HEIGHT * CM_PER_PT + PADDING_Y) / page.height);
  return centredBox(at, w, h);
}

/** A new text looks like the slide's body text (not its title), else like a plain default. */
export function textStyleOn(elements: readonly EditableElement[]): LiveTextStyle {
  const body = elements.find(
    (element) => element.live && element.role !== 'title' && !element.live.placeholder,
  );
  const mark = body?.live?.paragraphs[0]?.mark;
  if (!mark) return DEFAULT_STYLE;
  return {
    font: mark.font,
    size: Math.min(mark.size, 28),
    color: mark.color,
    bold: false,
    italic: false,
    underline: false,
  };
}
