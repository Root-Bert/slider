import type { Rect, Shape } from '@slider/shared';
import { OPS, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

/*
 * The boxes of a PDF page: what box mode outlines and binds comments to on a deck that
 * came as a PDF – a PDF has no PowerPoint shapes, so they are read from what the page draws.
 * Measured on real decks (PowerPoint, LibreOffice and Chrome PDFs) against PowerPoint's own shapes:
 * text blocks from the text layer, pictures, and filled areas (cards, panels, bars) find about four
 * in five shapes, and almost every box they give is a real one.
 *
 * - Text: runs → lines (same baseline, close together) → blocks (lines right below each other,
 *   overlapping, of about the same size). A block hugs its text, not its frame.
 * - Pictures and filled areas: pdf.js records the box of every drawing operation while it draws
 *   the page (`recordOperations`); a full-page picture or the background is no box, a fill in the
 *   background's colour none either, nor a tiny one.
 * - Groups: a table is the box around its grid lines, a chart the box around bars that stand on
 *   one baseline – the cells and bars stay boxes of their own (a click takes the smallest).
 * - Shadings are left out; a scan without a text layer has no boxes – comments there use pins and
 *   frames.
 */

/** At most this many boxes per page – a heavy page draws thousands of things. */
const MAX_BOXES = 60;
/**
 * Pages that draw more operations than this get no picture, fill, table or chart boxes, only
 * their text: walking and grouping them would take long (grouping is quadratic), and on a page
 * this busy – a map, a scanned plot – they would not help anyone. Real slides draw a few thousand.
 */
export const MAX_PAGE_OPERATIONS = 50_000;
/** Text runs looked at per page; the rest have no box (grouping them is quadratic too). */
const MAX_TEXT_RUNS = 5_000;
/** Pictures, fills and lines each looked at per page, in drawing order. */
const MAX_CANDIDATES = 2_000;
/** Smallest filled area or picture that is a box, as a share of the page. */
const MIN_AREA = 0.002;
/** A picture or fill this large is the page's background. */
const BACKGROUND_AREA = 0.85;
/** Room around a text block, as a share of the page – a click just beside the words still hits. */
const TEXT_PAD = 0.004;

const FILL_OPS = new Set<number>([
  OPS.fill,
  OPS.eoFill,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
]);
const STROKE_OPS = new Set<number>([OPS.stroke, OPS.closeStroke]);
const IMAGE_OPS = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
  OPS.paintInlineImageXObjectGroup,
]);

type Kind = 'text' | 'image' | 'fill' | 'grid' | 'chart';
interface Box extends Rect {
  kind: Kind;
  text: string;
}

/** What pdf.js recorded while drawing with `recordOperations: true` (not in its types). */
interface RecordedBoxes {
  length: number;
  isEmpty(index: number): boolean;
  minX(index: number): number;
  minY(index: number): number;
  maxX(index: number): number;
  maxY(index: number): number;
}

/** The parameters `page.render` needs to record the boxes for {@link pageBoxes}. */
export const RECORD_BOXES = { recordOperations: true } as const;

/**
 * The boxes of a page that was just drawn with {@link RECORD_BOXES}, in reading order, as
 * shapes: ids `t1`, `i1`, `f1` … (a later version takes the ids over: {@link carryShapeIds}).
 */
export async function pageBoxes(page: PDFPageProxy): Promise<Shape[]> {
  const viewport = page.getViewport({ scale: 1 });
  const text = textBlocks(
    (await page.getTextContent()).items.slice(0, MAX_TEXT_RUNS),
    (x, y) => viewport.convertToViewportPoint(x, y) as [number, number],
    viewport.width,
    viewport.height,
  );
  const drawn = await drawnBoxes(page);
  const fills = drawn.fills.filter(
    (fill) => !text.some((block) => overlapShare(block, fill) > 0.8),
  );
  const boxes = dedupe([...text, ...drawn.images, ...fills, ...drawn.tables, ...charts(fills)])
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .slice(0, MAX_BOXES);
  const counts: Record<Kind, number> = { text: 0, image: 0, fill: 0, grid: 0, chart: 0 };
  return boxes.map((box) => {
    counts[box.kind] += 1;
    return {
      id: `${box.kind[0]}${counts[box.kind]}`,
      name: nameOf(box, counts[box.kind]),
      bbox: clamp(box),
      text: box.text,
    };
  });
}

const nameOf = (box: Box, n: number) => {
  if (box.kind === 'image') return `Bild ${n}`;
  if (box.kind === 'fill') return `Fläche ${n}`;
  if (box.kind === 'grid') return `Tabelle ${n}`;
  if (box.kind === 'chart') return `Diagramm ${n}`;
  const start = box.text.replace(/\s+/g, ' ').trim();
  return start.length > 40 ? `${start.slice(0, 40).trimEnd()}…` : start || `Text ${n}`;
};

async function drawnBoxes(
  page: PDFPageProxy,
): Promise<{ images: Box[]; fills: Box[]; tables: Box[] }> {
  const recorded = (page as unknown as { recordedBBoxes?: RecordedBoxes }).recordedBBoxes;
  if (!recorded) return { images: [], fills: [], tables: [] };
  const list = await page.getOperatorList();
  if (list.fnArray.length > MAX_PAGE_OPERATIONS) return { images: [], fills: [], tables: [] };
  const images: Box[] = [];
  const strokes: Rect[] = [];
  const fills: (Box & { color: string })[] = [];
  let color = '#000000';
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i]!;
    const args = list.argsArray[i] as unknown[];
    if (fn === OPS.setFillRGBColor) color = colorOf(args);
    else if (fn === OPS.setFillColorN || fn === OPS.setFillTransparent) color = 'pattern';
    if (i >= recorded.length || recorded.isEmpty(i)) continue;
    const rect = {
      x: recorded.minX(i),
      y: recorded.minY(i),
      w: recorded.maxX(i) - recorded.minX(i),
      h: recorded.maxY(i) - recorded.minY(i),
    };
    if (fn === OPS.constructPath && FILL_OPS.has(args[0] as number)) {
      fills.push({ ...rect, kind: 'fill', text: '', color });
    } else if (fn === OPS.constructPath && STROKE_OPS.has(args[0] as number)) {
      strokes.push(rect);
    } else if (IMAGE_OPS.has(fn)) images.push({ ...rect, kind: 'image', text: '' });
  }
  // The background: the colour of the last fill that covers the page (else white paper).
  const background =
    fills.filter((fill) => area(fill) > BACKGROUND_AREA).at(-1)?.color ?? '#ffffff';
  return {
    images: dedupe(
      images
        .filter((r) => area(r) >= MIN_AREA && area(r) < BACKGROUND_AREA)
        .slice(0, MAX_CANDIDATES),
    ),
    fills: dedupe(
      fills
        .filter(
          (fill) =>
            area(fill) >= MIN_AREA &&
            area(fill) < BACKGROUND_AREA &&
            fill.color !== background &&
            fill.color !== 'pattern' &&
            // White cards on a coloured page are boxes; white on white paper is not.
            (fill.color !== '#ffffff' || background !== '#ffffff'),
        )
        .slice(0, MAX_CANDIDATES),
    ).map(({ color: _, ...box }) => box),
    tables: grids(strokes.slice(0, MAX_CANDIDATES)),
  };
}

/** Tables: lines that touch each other, many of them over a fair area, as one box. */
function grids(strokes: readonly Rect[]): Box[] {
  const lines = strokes.filter((r) => Math.min(r.w, r.h) < 0.01 && Math.max(r.w, r.h) > 0.02);
  const groups: Rect[][] = [];
  const near = (a: Rect, b: Rect) =>
    a.x <= b.x + b.w + 0.005 &&
    b.x <= a.x + a.w + 0.005 &&
    a.y <= b.y + b.h + 0.005 &&
    b.y <= a.y + a.h + 0.005;
  for (const line of lines) {
    const touching = groups.filter((group) => group.some((other) => near(other, line)));
    const merged = [line, ...touching.flat()];
    for (const group of touching) groups.splice(groups.indexOf(group), 1);
    groups.push(merged);
  }
  return groups
    .filter((group) => group.length >= 4)
    .map((group) => group.reduce((all, r) => union(all, r)))
    .filter((r) => area(r) > 0.02 && area(r) < BACKGROUND_AREA)
    .map((r) => ({ ...r, kind: 'grid' as const, text: '' }));
}

/** Charts: three or more bars of about one width standing on one baseline, as one box. */
function charts(fills: readonly Box[]): Box[] {
  const bars = fills.filter((f) => f.h > f.w * 0.5);
  const rows: Box[][] = [];
  for (const bar of bars) {
    const row = rows.find(
      (r) =>
        Math.abs(r[0]!.y + r[0]!.h - (bar.y + bar.h)) < 0.01 &&
        Math.abs(r[0]!.w - bar.w) < 0.3 * Math.max(r[0]!.w, bar.w),
    );
    if (row) row.push(bar);
    else rows.push([bar]);
  }
  return rows
    .filter((row) => row.length >= 3)
    .map((row) => ({
      ...row.reduce<Rect>((all, r) => union(all, r), row[0]!),
      kind: 'chart' as const,
      text: '',
    }));
}

const colorOf = (args: unknown[]) =>
  typeof args[0] === 'string'
    ? args[0].toLowerCase()
    : `#${(args as number[]).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

interface TextItemLike {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
}

/** Text runs → lines → blocks, normalised to the page. */
function textBlocks(
  items: readonly unknown[],
  toViewport: (x: number, y: number) => [number, number],
  width: number,
  height: number,
): Box[] {
  const runs: (Box & { size: number })[] = [];
  for (const raw of items) {
    const item = raw as TextItemLike;
    if (!item.str?.trim() || !item.transform) continue;
    const [a = 0, b = 0, , d = 0, e = 0, f = 0] = item.transform;
    const size = Math.hypot(a, b) || Math.abs(d);
    const tall = item.height || size;
    // From the descender to above the cap height.
    const [x1, y1] = toViewport(e, f - 0.25 * tall);
    const [x2, y2] = toViewport(e + (item.width ?? 0), f + 0.85 * tall);
    runs.push({
      kind: 'text',
      text: item.str,
      x: Math.min(x1, x2) / width,
      y: Math.min(y1, y2) / height,
      w: Math.abs(x2 - x1) / width,
      h: Math.abs(y2 - y1) / height,
      size: size / height,
    });
  }
  runs.sort((p, q) => p.y - q.y || p.x - q.x);
  // Lines: the same baseline, the next run close after the last.
  const lines: (Box & { size: number })[] = [];
  for (const run of runs) {
    const gap = 1.2 * run.size * (height / width);
    const line = lines.find(
      (l) =>
        Math.abs(l.y + l.h - (run.y + run.h)) < 0.35 * Math.max(l.h, run.h) &&
        run.x - (l.x + l.w) < gap &&
        run.x + run.w > l.x - run.size,
    );
    if (line)
      Object.assign(line, union(line, run), {
        text: `${line.text} ${run.text}`,
        size: Math.max(line.size, run.size),
      });
    else lines.push({ ...run });
  }
  // Blocks: lines right below each other, overlapping, of about the same size.
  lines.sort((p, q) => p.y - q.y);
  const blocks: (Box & { size: number; last: Rect })[] = [];
  for (const line of lines) {
    const block = blocks.find((b) => {
      const gap = line.y - (b.last.y + b.last.h);
      const across = Math.min(b.x + b.w, line.x + line.w) - Math.max(b.x, line.x);
      return (
        gap > -0.5 * line.h &&
        gap < 0.9 * line.h &&
        across > 0.2 * Math.min(b.w, line.w) &&
        Math.abs(line.size - b.size) / Math.max(line.size, b.size) < 0.3
      );
    });
    if (block)
      Object.assign(block, union(block, line), { text: `${block.text}\n${line.text}`, last: line });
    else blocks.push({ ...line, last: line });
  }
  return blocks.map(({ kind, text, x, y, w, h }) => ({
    kind,
    text: text.replace(/[ \t]+/g, ' ').trim(),
    x: x - TEXT_PAD,
    y: y - TEXT_PAD,
    w: w + 2 * TEXT_PAD,
    h: h + 2 * TEXT_PAD,
  }));
}

/**
 * A later version of a page takes over the ids of the version before, so comments stay on their
 * box: the same text first, else the same kind most overlapping. New boxes get fresh ids.
 */
export function carryShapeIds(previous: readonly Shape[], next: readonly Shape[]): Shape[] {
  const kindOf = (shape: Shape) => shape.id.replace(/\d+$/, '');
  const taken = new Set<string>();
  const assigned = new Map<Shape, string>();
  // Same text: the strongest match.
  for (const shape of next) {
    if (!shape.text) continue;
    const match = previous.find((p) => !taken.has(p.id) && p.text === shape.text);
    if (match) {
      taken.add(match.id);
      assigned.set(shape, match.id);
    }
  }
  // Then the same kind where it overlaps most.
  for (const shape of next) {
    if (assigned.has(shape)) continue;
    let best: Shape | null = null;
    let bestShare = 0.3;
    for (const p of previous) {
      if (taken.has(p.id) || kindOf(p) !== kindOf(shape)) continue;
      const share = overlapShare(p.bbox, shape.bbox);
      if (share > bestShare) {
        best = p;
        bestShare = share;
      }
    }
    if (best) {
      taken.add(best.id);
      assigned.set(shape, best.id);
    }
  }
  // Fresh ids above every one in use.
  const used = new Set([...previous.map((p) => p.id), ...assigned.values()]);
  const counters = new Map<string, number>();
  return next.map((shape) => {
    const carried = assigned.get(shape);
    if (carried) return { ...shape, id: carried };
    const kind = kindOf(shape);
    let n = counters.get(kind) ?? 0;
    let id: string;
    do id = `${kind}${++n}`;
    while (used.has(id));
    counters.set(kind, n);
    used.add(id);
    return { ...shape, id };
  });
}

const area = (r: Rect) => Math.max(0, r.w) * Math.max(0, r.h);

const intersection = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Intersection over union. */
function overlapShare(a: Rect, b: Rect): number {
  const shared = intersection(a, b);
  return shared / (area(a) + area(b) - shared || 1);
}

function union<T extends Rect>(a: T, b: Rect): T {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    ...a,
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/** Boxes that are nearly the same: the first stays. */
function dedupe<T extends Rect>(boxes: readonly T[], threshold = 0.85): T[] {
  const kept: T[] = [];
  for (const box of boxes) if (!kept.some((k) => overlapShare(k, box) > threshold)) kept.push(box);
  return kept;
}

function clamp(r: Rect): Rect {
  const x = Math.min(1, Math.max(0, r.x));
  const y = Math.min(1, Math.max(0, r.y));
  return {
    x,
    y,
    w: Math.max(0, Math.min(1, r.x + r.w) - x),
    h: Math.max(0, Math.min(1, r.y + r.h) - y),
  };
}
