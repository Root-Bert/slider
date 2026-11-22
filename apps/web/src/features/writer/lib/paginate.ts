import type { WriterBlock, WriterPage } from '@slider/shared';

/*
 * Pages. The text is one flow the browser lays out; where a page ends, the flow is pushed on to
 * the next page's top – between two paragraphs by a margin, inside a paragraph by a gap the
 * lines flow around, between a table's rows by a row of nothing. So the caret, the selection
 * and the spell check go on working across pages, and a paragraph breaks at the line where the
 * page ends.
 *
 * Measured first, written after: everything is read from the flow as it lies without gaps, the
 * breaks are worked out from those numbers alone, and only then are the gaps put in – two
 * layouts per pass, however many pages.
 */

const PX_PER_PT = 96 / 72;
/** The grey between two sheets, in CSS px at 100 %. */
export const PAGE_GAP = 24;

export interface PageMetrics {
  /** A sheet's size and its margins, in CSS px at 100 %. */
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** The room for text on a sheet. */
  content: number;
  /** From one sheet's top to the next one's. */
  pitch: number;
  /** The grey between two sheets (none on paper). */
  gap: number;
  /** The foot with the page's number takes this much of the room for text (0: none). */
  foot: number;
  /** The head (one line and its air) stands over the text: `top` is under it (0: none). */
  head: number;
}

/** A foot as the file has it: 0.5 cm of air, then one line of 9 pt. */
const FOOT_GAP = (0.5 / 2.54) * 96;
const FOOT_LINE = 9 * 1.15 * PX_PER_PT;
/** A line of the head or the foot, at 100 %. */
export const footLine = FOOT_LINE;

export function metricsOf(page: WriterPage, gap = PAGE_GAP): PageMetrics {
  const px = (points: number) => Math.round(points * PX_PER_PT * 100) / 100;
  const height = px(page.height);
  const round = (value: number) => Math.round(value * 100) / 100;
  // A head: its line and 0.5 cm of air before the text, as the file has it.
  const head = page.header ? round(FOOT_LINE + FOOT_GAP) : 0;
  const top = px(page.marginTop) + head;
  const bottom = px(page.marginBottom);
  const lines = (page.numbers ? 1 : 0) + (page.footer ? 1 : 0);
  const foot = lines > 0 ? round(FOOT_GAP + lines * FOOT_LINE) : 0;
  return {
    width: px(page.width),
    height,
    top,
    right: px(page.marginRight),
    bottom,
    left: px(page.marginLeft),
    // A sheet whose margins leave nothing still shows a line.
    content: Math.max(40, height - top - bottom - foot),
    pitch: height + gap,
    gap,
    foot,
    head,
  };
}

const SPACER = 'data-spacer';

function clear(root: HTMLElement) {
  for (const spacer of root.querySelectorAll(`[${SPACER}]`)) spacer.remove();
  for (const pushed of root.querySelectorAll<HTMLElement>('[data-pushed]')) {
    pushed.style.removeProperty('--push');
    delete pushed.dataset.pushed;
  }
}

interface Line {
  top: number;
  bottom: number;
}

/** The lines of a paragraph, top to bottom, in the flow's own px. */
function linesOf(element: HTMLElement, origin: number, zoom: number): Line[] {
  const range = document.createRange();
  range.selectNodeContents(element);
  const lines: Line[] = [];
  for (const rect of range.getClientRects()) {
    if (rect.height === 0) continue;
    const top = (rect.top - origin) / zoom;
    const bottom = (rect.bottom - origin) / zoom;
    const last = lines.at(-1);
    // Boxes of one line overlap for more than half their height.
    if (last && top < last.bottom - (bottom - top) / 2) {
      last.top = Math.min(last.top, top);
      last.bottom = Math.max(last.bottom, bottom);
    } else lines.push({ top, bottom });
  }
  return lines;
}

interface Write {
  element: HTMLElement;
  push?: number;
  /** Gaps inside a paragraph: `at` from the paragraph's top (or the gap before), `gap` high. */
  gaps?: { at: number; gap: number }[];
  /** Gaps in a table: before row `row`, `gap` high. */
  rows?: { row: HTMLTableRowElement; gap: number; columns: number }[];
}

export interface Pagination {
  pages: number;
  /** The flow's height with every gap in it. */
  height: number;
}

/**
 * Lays the flow out over pages. `blocks` are the ones drawn in `root`, in its order; `zoom` is
 * how much larger than 100 % the page is shown (measures are taken through it).
 */
export function paginate(
  root: HTMLElement,
  blocks: readonly WriterBlock[],
  metrics: PageMetrics,
  zoom: number,
): Pagination {
  clear(root);
  const origin = root.getBoundingClientRect().top;
  const { content, pitch } = metrics;
  const writes: Write[] = [];
  const children = [...root.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );

  let page = 0;
  let shift = 0;
  const limit = () => page * pitch + content;
  const pageTop = () => page * pitch;
  // What begins a page is not pushed again, however tall it is.
  const TOLERANCE = 0.75;

  const measure = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return { top: (rect.top - origin) / zoom, height: rect.height / zoom };
  };
  const pushWhole = (element: HTMLElement, top: number): boolean => {
    const target = (page + 1) * pitch;
    if (top + shift <= pageTop() + TOLERANCE) return false;
    const push = target - (top + shift);
    writes.push({ element, push });
    shift += push;
    page += 1;
    return true;
  };
  /** How much room the block wants on the page it starts on: two lines of text, all of the rest. */
  const firstNeed = (element: HTMLElement, height: number): number => {
    if (element.dataset.p === undefined || element.dataset.locked !== undefined) return height;
    const lines = linesOf(element, origin, zoom);
    const second = lines[Math.min(1, lines.length - 1)];
    const first = lines[0];
    return first && second ? second.bottom - first.top : height;
  };

  children.forEach((element, index) => {
    const block = blocks[index];
    const { top, height } = measure(element);
    // Past this page already (the block before ran over it): on with the page it lies on.
    while (top + shift >= (page + 1) * pitch - TOLERANCE) page += 1;

    if (block?.type === 'paragraph' && block.breakBefore && index > 0) {
      if (pushWhole(element, top)) return fit(element, top, height);
    }
    // A heading stays with what it heads: on to the next page with it.
    if (
      block?.type === 'paragraph' &&
      (block.kind === 'heading' || block.kind === 'title') &&
      top + shift + height <= limit() + TOLERANCE
    ) {
      const next = children[index + 1];
      if (next) {
        const after = measure(next);
        const need = firstNeed(next, after.height);
        if (after.top + shift + need > limit() + TOLERANCE && need <= content) {
          pushWhole(element, top);
          return;
        }
      }
    }
    fit(element, top, height);
  });

  function fit(element: HTMLElement, top: number, height: number) {
    if (top + shift + height <= limit() + TOLERANCE) return;
    if (element instanceof HTMLTableElement) return fitTable(element, top);
    if (element.dataset.p === undefined || element.dataset.locked !== undefined) {
      pushWhole(element, top);
      return;
    }
    const lines = linesOf(element, origin, zoom);
    if (lines.length < 2) {
      pushWhole(element, top);
      return;
    }
    const gaps: { at: number; gap: number }[] = [];
    // How far the lines of this paragraph lie below where they were measured.
    let inner = 0;
    // The bottom of the last gap, from the paragraph's top.
    let floor = 0;
    let since = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line || line.bottom + shift + inner <= limit() + TOLERANCE) continue;
      let at = index;
      // Never one line alone at a page's foot or head.
      if (lines.length - at === 1 && at - since >= 2 && lines.length >= 3) at -= 1;
      if (at - since === 1 && since === 0) at = 0;
      if (at <= since) {
        if (since === 0 && gaps.length === 0) {
          if (pushWhole(element, top)) {
            // On the new page from its top: the rest may break there once more.
            index = -1;
            since = 0;
            continue;
          }
        }
        // A line taller than a page, or the first on its page: it stays.
        if (index + 1 < lines.length) continue;
        break;
      }
      const before = lines[at - 1];
      const first = lines[at];
      if (!before || !first) break;
      // The seam between the two lines; a hair below it, so the line above stays where it is.
      const seam = (before.bottom + first.top) / 2 + 1;
      const target = (page + 1) * pitch;
      const lineTop = seam + shift + inner;
      const gap = target - lineTop;
      if (gap <= 0) break;
      const start = seam - top + inner;
      gaps.push({ at: start - floor, gap });
      floor = start + gap;
      inner += gap;
      page += 1;
      since = at;
      index = at - 1;
    }
    if (gaps.length > 0) {
      writes.push({ element, gaps });
      shift += inner;
    }
  }

  function fitTable(table: HTMLTableElement, top: number) {
    const rows = [...(table.tBodies[0]?.rows ?? [])];
    const first = rows[0];
    if (!first) return;
    const head = measure(first);
    if (head.top + shift + head.height > limit() + TOLERANCE) {
      if (pushWhole(table, top)) return fitTable(table, top);
    }
    const gaps: { row: HTMLTableRowElement; gap: number; columns: number }[] = [];
    const columns = Math.max(1, table.querySelectorAll(':scope > colgroup > col').length);
    let inner = 0;
    // The row a merged cell reaches down to: a page does not end inside it.
    let reach = 0;
    rows.forEach((row, index) => {
      const held = index < reach;
      for (const cell of row.cells) reach = Math.max(reach, index + cell.rowSpan);
      if (index === 0 || held) return;
      const { top: rowTop, height } = measure(row);
      const y = rowTop + shift + inner;
      if (y + height <= limit() + TOLERANCE || y <= pageTop() + TOLERANCE) return;
      const gap = (page + 1) * pitch - y;
      if (gap <= 0) return;
      gaps.push({ row, gap, columns });
      inner += gap;
      page += 1;
    });
    if (gaps.length > 0) {
      writes.push({ element: table, rows: gaps });
      shift += inner;
    }
  }

  // Everything is measured: now the gaps go in.
  for (const write of writes) {
    if (write.push !== undefined) {
      write.element.style.setProperty('--push', `${write.push}px`);
      write.element.dataset.pushed = '';
    }
    if (write.gaps) {
      const spacers: HTMLElement[] = [];
      for (const { at, gap } of write.gaps) {
        // A float no wider than nothing reaches down to the seam; the one below it is as wide
        // as the paragraph, so no line fits beside it and the text goes on under it.
        const reach = document.createElement('span');
        reach.style.cssText = `float:left;clear:both;width:0;height:${Math.max(0, at)}px`;
        const hole = document.createElement('span');
        hole.style.cssText = `float:left;clear:both;width:100%;height:${gap}px`;
        for (const spacer of [reach, hole]) {
          spacer.setAttribute(SPACER, '');
          spacer.dataset.skip = '';
          spacer.contentEditable = 'false';
          spacer.setAttribute('aria-hidden', 'true');
          spacers.push(spacer);
        }
      }
      write.element.prepend(...spacers);
    }
    for (const { row, gap, columns } of write.rows ?? []) {
      const spacer = document.createElement('tr');
      spacer.setAttribute(SPACER, '');
      spacer.dataset.skip = '';
      spacer.contentEditable = 'false';
      spacer.setAttribute('aria-hidden', 'true');
      const cell = document.createElement('td');
      cell.colSpan = columns;
      cell.style.cssText = `height:${gap}px;padding:0;border:0`;
      spacer.append(cell);
      row.before(spacer);
    }
  }

  const last = children.at(-1);
  const end = last ? (last.getBoundingClientRect().bottom - origin) / zoom : 0;
  const pages = Math.max(1, page + 1, Math.ceil((end - TOLERANCE) / pitch));
  return { pages, height: pages * pitch - metrics.gap };
}

/** The page (0-based) a height of the flow lies on. */
export const pageAt = (y: number, metrics: PageMetrics) =>
  Math.max(0, Math.floor((y + metrics.top) / metrics.pitch));
