import type {
  AddElementOperation,
  EditableElement,
  LiveElement,
  LiveParagraph,
  LiveRun,
  LiveTextStyle,
  RichParagraph,
  SlideOperation,
  TextAlign,
} from '@slider/shared';

/*
 * The live editor's text and boxes as plain data: what an operation does to an element before
 * the server answers (shown at once, replaced by the server's reading), and formatting a stretch
 * of text. Positions in text are (paragraph, character) pairs.
 */

export type TextStylePatch = Partial<LiveTextStyle>;

/** The format bar: the focus going there does not end typing on the slide. */
export const TEXT_TOOLBAR_ATTR = 'data-live-toolbar';

/** A button press in the bar must not take the focus out of the text being typed. */
export const keepFocus = (event: { target: EventTarget | null; preventDefault: () => void }) => {
  if (event.target instanceof Element && event.target.closest('button')) event.preventDefault();
};

export const styleOf = (run: LiveTextStyle): LiveTextStyle => ({
  font: run.font,
  size: run.size,
  color: run.color,
  bold: run.bold,
  italic: run.italic,
  underline: run.underline,
  ...(run.caps ? { caps: run.caps } : {}),
  ...(run.letterSpacing ? { letterSpacing: run.letterSpacing } : {}),
});

export const sameStyle = (a: LiveTextStyle, b: LiveTextStyle) =>
  a.font === b.font &&
  a.size === b.size &&
  a.color.toLowerCase() === b.color.toLowerCase() &&
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.underline === b.underline &&
  (a.caps ?? 'none') === (b.caps ?? 'none') &&
  (a.letterSpacing ?? 0) === (b.letterSpacing ?? 0);

/** Runs without empty ones, neighbours of one style joined. */
export function normalizeRuns(runs: readonly LiveRun[]): LiveRun[] {
  const out: LiveRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = out.at(-1);
    if (last && sameStyle(last, run)) last.text += run.text;
    else out.push({ ...run });
  }
  return out;
}

export const paragraphText = (paragraph: { runs: readonly LiveRun[] }) =>
  paragraph.runs.map((run) => run.text).join('');

/**
 * The editor's paragraphs as they are written: an empty paragraph keeps its style as an empty
 * run (the file gives it to the paragraph, so its line keeps its height).
 */
export const richFromLive = (paragraphs: readonly LiveParagraph[]): RichParagraph[] =>
  paragraphs.map((paragraph) => {
    const runs = normalizeRuns(paragraph.runs);
    return {
      align: paragraph.align,
      runs: runs.length > 0 ? runs : [{ ...styleOf(paragraph.mark), text: '' }],
    };
  });

/** A paragraph with nothing set: what a new text box's paragraphs are. */
export const plainParagraph = (mark: LiveTextStyle): LiveParagraph => ({
  runs: [],
  mark,
  align: 'left',
  fontIndependent: false,
  lineSpacing: { type: 'proportional', value: 1 },
  spaceBefore: 0,
  spaceAfter: 0,
  marginLeft: 0,
  indent: 0,
  level: 0,
  bullet: null,
});

/**
 * Written paragraphs over the ones there were: each keeps the look of the paragraph at its
 * place (beyond the old ones, of the last), with the new text, runs and alignment.
 */
export function liveFromRich(
  old: readonly LiveParagraph[],
  rich: readonly RichParagraph[],
): LiveParagraph[] {
  return rich.map((paragraph, i) => {
    const runs = normalizeRuns(paragraph.runs);
    const template =
      old[Math.min(i, old.length - 1)] ??
      plainParagraph(paragraph.runs[0] ? styleOf(paragraph.runs[0]) : DEFAULT_STYLE);
    const last = runs.at(-1) ?? paragraph.runs[0];
    return {
      ...template,
      runs,
      align: paragraph.align,
      mark: last ? styleOf(last) : template.mark,
    };
  });
}

/** A new box's fill and border: slide content, not the app's colours. */
export const NEW_BOX = { fill: '#dbeafe', stroke: { color: '#1e40af', width: 1 } };

export const DEFAULT_STYLE: LiveTextStyle = {
  font: 'Calibri',
  size: 24,
  color: '#000000',
  bold: false,
  italic: false,
  underline: false,
};

/** An element as it is right after the operation, before the server says how it is. */
export function applyToElement(
  element: EditableElement,
  operation: SlideOperation,
): EditableElement | null {
  switch (operation.type) {
    case 'deleteElement':
      return null;
    case 'setBox':
      return {
        ...element,
        bbox: element.resizable
          ? operation.box
          : { ...operation.box, w: element.bbox.w, h: element.bbox.h },
      };
    case 'setText':
      return {
        ...element,
        paragraphs: operation.paragraphs,
        live: element.live && {
          ...element.live,
          placeholder: false,
          paragraphs: liveFromRich(
            element.live.paragraphs,
            operation.paragraphs.map((text, i) => {
              const old =
                element.live!.paragraphs[Math.min(i, element.live!.paragraphs.length - 1)];
              const style = old ? styleOf(old.runs[0] ?? old.mark) : DEFAULT_STYLE;
              return { align: old?.align ?? 'left', runs: [{ ...style, text }] };
            }),
          ),
        },
      };
    case 'setRichText':
      return {
        ...element,
        paragraphs: operation.paragraphs.map(paragraphText),
        live: element.live && {
          ...element.live,
          placeholder:
            element.live.placeholder &&
            !operation.paragraphs.some((paragraph) => paragraphText(paragraph).trim()),
          paragraphs: liveFromRich(element.live.paragraphs, operation.paragraphs),
        },
      };
    case 'setShapeStyle':
      return {
        ...element,
        live: element.live && {
          ...element.live,
          ...(operation.fill !== undefined ? { fill: operation.fill?.toLowerCase() ?? null } : {}),
          ...(operation.stroke !== undefined ? { stroke: operation.stroke } : {}),
          ...(operation.verticalAlign ? { verticalAlign: operation.verticalAlign } : {}),
        },
      };
    default:
      return element;
  }
}

const PT_PER_CM = 72 / 2.54;

/** A new text box or box as the editor adds it (`addElement`). */
export function addedElement(
  operation: AddElementOperation,
  pageSize: { width: number; height: number },
): EditableElement {
  const text = operation.kind === 'text';
  const padding = { top: 0.125 * PT_PER_CM, bottom: 0.125 * PT_PER_CM };
  const live: LiveElement = {
    fill: operation.fill,
    stroke: operation.stroke,
    padding: { ...padding, left: 0.25 * PT_PER_CM, right: 0.25 * PT_PER_CM },
    verticalAlign: text ? 'top' : 'middle',
    autoGrow: text,
    minHeight: text ? operation.box.h * pageSize.height * PT_PER_CM : null,
    placeholder: false,
    paragraphs: liveFromRich([], operation.paragraphs),
  };
  return {
    id: operation.elementId,
    kind: text ? 'text' : 'shape',
    name: text ? 'Textfeld' : 'Rechteck',
    role: null,
    bbox: operation.box,
    paragraphs: operation.paragraphs.map(paragraphText),
    movable: true,
    resizable: true,
    live,
    credit: null,
  };
}

// ── Formatting a stretch of text ─────────────────────────────────────────

export interface TextPoint {
  paragraph: number;
  offset: number;
}

export interface TextRange {
  start: TextPoint;
  end: TextPoint;
}

export const isCollapsed = (range: TextRange) =>
  range.start.paragraph === range.end.paragraph && range.start.offset === range.end.offset;

/** The runs of a paragraph with `patch` applied between two offsets. */
function patchBetween(runs: readonly LiveRun[], from: number, to: number, patch: TextStylePatch) {
  const out: LiveRun[] = [];
  let at = 0;
  for (const run of runs) {
    const start = at;
    const end = at + run.text.length;
    at = end;
    const a = Math.max(from, start) - start;
    const b = Math.min(to, end) - start;
    if (b <= a) {
      out.push(run);
      continue;
    }
    if (a > 0) out.push({ ...run, text: run.text.slice(0, a) });
    out.push({ ...run, ...patch, text: run.text.slice(a, b) });
    if (b < run.text.length) out.push({ ...run, text: run.text.slice(b) });
  }
  return normalizeRuns(out);
}

/** The word around an offset (for formatting at a caret, like PowerPoint). */
export function wordAt(text: string, offset: number): [number, number] {
  const isWord = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}_-]/u.test(char);
  let start = offset;
  let end = offset;
  while (isWord(text[start - 1])) start -= 1;
  while (isWord(text[end])) end += 1;
  return [start, end];
}

/**
 * Applies a style to a stretch of the paragraphs. A caret formats the word it is in; in no word
 * (an empty line, between spaces) it sets what is typed there next (the paragraph's mark).
 */
export function formatRange(
  paragraphs: readonly LiveParagraph[],
  range: TextRange | null,
  patch: TextStylePatch,
): LiveParagraph[] {
  if (!range) {
    return paragraphs.map((paragraph) => ({
      ...paragraph,
      runs: normalizeRuns(paragraph.runs.map((run) => ({ ...run, ...patch }))),
      mark: { ...paragraph.mark, ...patch },
    }));
  }
  if (isCollapsed(range)) {
    const index = range.start.paragraph;
    const paragraph = paragraphs[index];
    if (!paragraph) return [...paragraphs];
    const [from, to] = wordAt(paragraphText(paragraph), range.start.offset);
    return paragraphs.map((item, i) =>
      i !== index
        ? item
        : from === to
          ? { ...item, mark: { ...item.mark, ...patch } }
          : { ...item, runs: patchBetween(item.runs, from, to, patch) },
    );
  }
  return paragraphs.map((paragraph, i) => {
    if (i < range.start.paragraph || i > range.end.paragraph) return paragraph;
    const from = i === range.start.paragraph ? range.start.offset : 0;
    const to = i === range.end.paragraph ? range.end.offset : Infinity;
    const runs = patchBetween(paragraph.runs, from, to, patch);
    // A paragraph formatted to its end types on in the new style.
    const mark =
      to >= paragraphText(paragraph).length ? { ...paragraph.mark, ...patch } : paragraph.mark;
    return { ...paragraph, runs, mark };
  });
}

/** Sets the alignment of the paragraphs a range touches (all without a range). */
export function alignRange(
  paragraphs: readonly LiveParagraph[],
  range: TextRange | null,
  align: TextAlign,
): LiveParagraph[] {
  return paragraphs.map((paragraph, i) =>
    !range || (i >= range.start.paragraph && i <= range.end.paragraph)
      ? { ...paragraph, align }
      : paragraph,
  );
}

/** The style at a point: of the character before it, at a paragraph's start of the first one. */
export function styleAt(paragraphs: readonly LiveParagraph[], point: TextPoint): LiveTextStyle {
  const paragraph = paragraphs[point.paragraph] ?? paragraphs[0];
  if (!paragraph) return DEFAULT_STYLE;
  let at = 0;
  for (const run of paragraph.runs) {
    const end = at + run.text.length;
    if (point.offset <= end && (point.offset > at || at === 0)) return styleOf(run);
    at = end;
  }
  return styleOf(paragraph.mark);
}

/** One value when every run (and empty line) in the paragraphs has it, else `null`. */
export function commonValue<K extends keyof LiveTextStyle>(
  paragraphs: readonly LiveParagraph[],
  key: K,
): LiveTextStyle[K] | null {
  const values = paragraphs.flatMap((paragraph) =>
    paragraph.runs.some((run) => run.text)
      ? paragraph.runs.map((run) => run[key])
      : [paragraph.mark[key]],
  );
  const first = values[0];
  return first !== undefined && values.every((value) => value === first) ? first : null;
}
