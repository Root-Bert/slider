import {
  officeFontFor,
  WRITER_LIST_STEP_PT,
  WRITER_PICTURE_CHAR,
  type WriterBlock,
  type WriterParagraphBlock,
  type WriterRun,
  type WriterTableBlock,
} from '@slider/shared';
import { cssFamily } from '@/features/viewer';
import { alignOf, baseMarks, normalize, type Marks, type Point, type Sel } from './model';

/*
 * The text on the page: the blocks drawn as elements the browser lays out, breaks into lines
 * and puts the caret in. Drawn by hand, not by React – only what changed is touched, so the
 * caret, a word being composed and the spell check's marks stay where they are.
 *
 * Every paragraph is one element (`data-p`, its id in `data-id`); its text lies in spans, one
 * per stretch of one look, which carry that look as `data-m`. What is not text of the
 * document – the line an empty paragraph needs, the gaps between pages – is marked
 * `data-skip` and counts for nothing. A picture standing in a line (`img[data-inline]`) counts
 * as the one character it is in the text.
 */

const FALLBACK_FONTS = '"Liberation Serif", "Times New Roman", serif';
/** A font of the file as the server's LibreOffice draws it: its free twin first, then itself. */
/** A font of the file as CSS: its metric twin first where the font itself is not on the machine. */
export const family = (font: string) => {
  const twin = officeFontFor(font);
  return `${twin ? `${cssFamily(twin)}, ` : ''}"${font.replace(/["\\]/g, '')}", ${FALLBACK_FONTS}`;
};

/** A font's own line as a factor of its size – what „einzeilig“ means for it. */
const lineRatios = new Map<string, number>();
function lineRatio(font: string): number {
  const known = lineRatios.get(font);
  if (known) return known;
  const probe = document.createElement('span');
  probe.textContent = 'Hg';
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-size:100px;line-height:normal;font-family:${family(font)}`;
  document.body.append(probe);
  const ratio = probe.getBoundingClientRect().height / 100 || 1.2;
  probe.remove();
  lineRatios.set(font, ratio);
  return ratio;
}
/** Fonts that arrived since have other lines: measured again. */
export const forgetLineRatios = () => lineRatios.clear();

const pt = (value: number) => `${Number(value.toFixed(3))}pt`;

function styleRun(span: HTMLElement, run: WriterRun, lineHeight: number) {
  const style = span.style;
  // The marks say what is, not how it differs: each stretch states its weight itself.
  style.fontWeight = run.bold ? '700' : '400';
  style.fontStyle = run.italic ? 'italic' : 'normal';
  const lines = [run.underline && 'underline', run.strike && 'line-through'].filter(Boolean);
  style.textDecorationLine = lines.length > 0 ? lines.join(' ') : 'none';
  if (run.color) style.color = run.color;
  if (run.highlight) style.backgroundColor = run.highlight;
  if (run.font) {
    style.fontFamily = family(run.font);
    // Its line is its own font's: a bigger size makes the line higher by itself, a font does not.
    style.lineHeight = String(Number((lineHeight * lineRatio(run.font)).toFixed(4)));
  }
  if (run.size) style.fontSize = pt(run.size);
  if (run.link) span.dataset.link = run.link;
}

function marksJson({ text: _text, ...marks }: WriterRun): string {
  return JSON.stringify(marks);
}

function skipBreak(): HTMLBRElement {
  const br = document.createElement('br');
  br.dataset.skip = '';
  return br;
}

const isInline = (node: Node): node is HTMLImageElement =>
  node.nodeName === 'IMG' && (node as HTMLElement).dataset.inline !== undefined;

/** A paragraph's words and the pictures in its lines, in their order. */
function pieces(paragraph: HTMLElement): (Text | HTMLImageElement)[] {
  const out: (Text | HTMLImageElement)[] = [];
  const walker = document.createTreeWalker(
    paragraph,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!isSkipped(node)) out.push(node as Text);
    } else if (isInline(node)) out.push(node);
  }
  return out;
}

const isSkipped = (node: Node) =>
  (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)?.closest(
    '[data-skip]',
  ) != null;

export interface ViewOptions {
  /** Where a picture of the file is fetched. */
  pictureUrl: (path: string) => string;
}

export class FlowView {
  readonly root: HTMLDivElement;
  private readonly elements = new Map<string, HTMLElement>();
  private readonly drawn = new Map<string, { block: WriterBlock; marker: string | undefined }>();

  constructor(private readonly options: ViewOptions) {
    this.root = document.createElement('div');
    this.root.className = 'writer-flow';
    this.root.spellcheck = true;
    this.root.lang = 'de';
  }

  /** The blocks as they are now; elements of what did not change stay untouched. */
  render(blocks: readonly WriterBlock[], markers: ReadonlyMap<string, string>) {
    const seen = new Set<string>();
    this.reconcile(this.root, blocks, markers, seen);
    for (const id of [...this.elements.keys()]) {
      if (seen.has(id)) continue;
      this.elements.delete(id);
      this.drawn.delete(id);
    }
  }

  private reconcile(
    parent: HTMLElement,
    blocks: readonly WriterBlock[],
    markers: ReadonlyMap<string, string>,
    seen: Set<string>,
  ) {
    const wanted: HTMLElement[] = [];
    for (const block of blocks) {
      seen.add(block.id);
      const marker = markers.get(block.id);
      const was = this.drawn.get(block.id);
      let element = this.elements.get(block.id);
      if (element && was && was.block.type !== block.type) element = undefined;
      if (!element) {
        element = document.createElement(block.type === 'table' ? 'table' : 'div');
        this.elements.set(block.id, element);
      }
      if (!was || was.block !== block || was.marker !== marker) {
        if (block.type === 'paragraph') this.drawParagraph(element, block, marker);
        else this.drawTable(element as HTMLTableElement, block, markers, seen);
        this.drawn.set(block.id, { block, marker });
      } else if (block.type === 'table') {
        for (const row of block.rows)
          for (const cell of row) for (const each of cell.blocks) seen.add(each.id);
      }
      wanted.push(element);
    }
    // In order, moving only what stands elsewhere; what is no block of this text goes.
    const keep = new Set(wanted);
    for (const child of [...parent.children]) {
      if (!keep.has(child as HTMLElement) && !(child as HTMLElement).dataset.keep) child.remove();
    }
    let at = parent.firstElementChild;
    while (at && (at as HTMLElement).dataset.keep !== undefined) at = at.nextElementSibling;
    for (const element of wanted) {
      if (at === element) {
        at = at.nextElementSibling;
        continue;
      }
      parent.insertBefore(element, at);
    }
  }

  private drawParagraph(
    element: HTMLElement,
    block: WriterParagraphBlock,
    marker: string | undefined,
  ) {
    const look = block.look;
    element.className = 'writer-p';
    element.dataset.p = '';
    element.dataset.id = block.id;
    element.dataset.kind = block.kind;
    // What a copy of the text carries along: its level and its list.
    if (block.kind === 'heading') element.dataset.level = String(block.level ?? 1);
    else delete element.dataset.level;
    if (block.list) element.dataset.list = `${block.list.kind}:${block.list.level}`;
    else delete element.dataset.list;
    if (block.align) element.dataset.align = block.align;
    else delete element.dataset.align;
    if (block.breakBefore) element.dataset.break = '';
    else delete element.dataset.break;
    if (block.locked) {
      element.dataset.locked = '';
      element.contentEditable = 'false';
    } else {
      delete element.dataset.locked;
      element.removeAttribute('contenteditable');
    }
    const step = block.list ? WRITER_LIST_STEP_PT * (block.list.level + 1) : 0;
    if (marker && block.list) {
      element.dataset.marker = marker;
      element.style.setProperty('--marker-left', pt(look.indentLeft + step - WRITER_LIST_STEP_PT));
      element.style.setProperty('--marker-width', pt(WRITER_LIST_STEP_PT));
    } else {
      delete element.dataset.marker;
    }
    const style = element.style;
    style.fontFamily = family(look.font);
    style.fontSize = pt(look.size);
    style.color = look.color;
    style.fontWeight = look.bold ? '700' : '400';
    style.fontStyle = look.italic ? 'italic' : 'normal';
    // Its own spacing, else its format's.
    const spacing = block.lineHeight ?? look.lineHeight;
    style.lineHeight = String(Number((spacing * lineRatio(look.font)).toFixed(4)));
    style.setProperty('--before', pt(look.spaceBefore));
    style.marginBottom = pt(look.spaceAfter);
    style.paddingLeft = pt(look.indentLeft + step);
    style.paddingRight = pt(look.indentRight);
    style.textIndent = block.list ? '0' : pt(look.indentFirst);
    style.textAlign = alignOf(block);

    const children: Node[] = [];
    for (const picture of block.pictures ?? []) {
      const image = document.createElement('img');
      image.src = this.options.pictureUrl(picture.path);
      image.alt = '';
      image.draggable = false;
      image.className = 'writer-picture';
      image.style.width = pt(picture.width);
      image.style.aspectRatio = `${picture.width} / ${picture.height}`;
      // Standing alone it is a block: placed across the sheet as its paragraph is aligned.
      const align = alignOf(block);
      image.style.marginLeft = align === 'center' || align === 'right' ? 'auto' : '';
      image.style.marginRight = align === 'center' ? 'auto' : '';
      children.push(image);
    }
    let text = '';
    for (const run of block.runs) {
      if (run.text === '') continue;
      if (run.picture) {
        const image = document.createElement('img');
        image.src = this.options.pictureUrl(run.picture.path);
        image.alt = '';
        image.draggable = false;
        image.className = 'writer-picture';
        image.dataset.inline = '';
        image.dataset.m = marksJson(run);
        if (run.link) image.dataset.link = run.link;
        image.style.width = pt(run.picture.width);
        image.style.aspectRatio = `${run.picture.width} / ${run.picture.height}`;
        text += run.text;
        children.push(image);
        continue;
      }
      const span = document.createElement('span');
      span.dataset.m = marksJson(run);
      styleRun(span, run, block.lineHeight ?? block.look.lineHeight);
      span.textContent = run.text;
      text += run.text;
      children.push(span);
    }
    // An empty line, and one that ends in a break, needs something to stand on.
    if ((text === '' && !block.pictures?.length) || text.endsWith('\n')) children.push(skipBreak());
    element.replaceChildren(...children);
  }

  private drawTable(
    table: HTMLTableElement,
    block: WriterTableBlock,
    markers: ReadonlyMap<string, string>,
    seen: Set<string>,
  ) {
    table.className = 'writer-table';
    table.dataset.id = block.id;
    const shape = `${block.columns.length}|${block.rows
      .map((row) => row.map((cell) => `${cell.colSpan ?? 1}x${cell.rowSpan ?? 1}`).join(','))
      .join(';')}`;
    if (table.dataset.shape !== shape) {
      table.dataset.shape = shape;
      const columns = document.createElement('colgroup');
      for (let index = 0; index < block.columns.length; index += 1) {
        columns.append(document.createElement('col'));
      }
      const body = document.createElement('tbody');
      for (const row of block.rows) {
        const tr = document.createElement('tr');
        for (const cell of row) {
          const td = document.createElement('td');
          if (cell.colSpan && cell.colSpan > 1) td.colSpan = cell.colSpan;
          if (cell.rowSpan && cell.rowSpan > 1) td.rowSpan = cell.rowSpan;
          tr.append(td);
        }
        body.append(tr);
      }
      table.replaceChildren(columns, body);
    }
    // The widths alone change without the cells being built anew (a border dragged).
    [...(table.querySelector('colgroup')?.children ?? [])].forEach((column, index) => {
      const width = `${((block.columns[index] ?? 0) * 100).toFixed(3)}%`;
      if ((column as HTMLElement).style.width !== width)
        (column as HTMLElement).style.width = width;
    });
    const rows = [...(table.tBodies[0]?.rows ?? [])].filter((row) => !row.dataset.skip);
    block.rows.forEach((row, rowIndex) => {
      row.forEach((cell, col) => {
        const td = rows[rowIndex]?.cells[col];
        if (td) this.reconcile(td, cell.blocks, markers, seen);
      });
    });
  }

  elementOf(id: string): HTMLElement | undefined {
    return this.elements.get(id);
  }

  /** A picture as it stands in the page: the one in the line at `offset`, or (`null`) the one standing alone. */
  pictureElement(id: string, offset: number | null): HTMLImageElement | null {
    const paragraph = this.elements.get(id);
    if (!paragraph) return null;
    if (offset === null) {
      return paragraph.querySelector<HTMLImageElement>('img.writer-picture:not([data-inline])');
    }
    let total = 0;
    for (const piece of pieces(paragraph)) {
      if (isInline(piece)) {
        if (total === offset) return piece;
        total += 1;
      } else total += piece.length;
      if (total > offset) break;
    }
    return null;
  }

  /** Where in its paragraph's text a picture standing in a line is. */
  offsetOf(image: HTMLImageElement): Point | null {
    const paragraph = this.paragraphOf(image);
    if (!paragraph?.dataset.id || image.dataset.inline === undefined) return null;
    let total = 0;
    for (const piece of pieces(paragraph)) {
      if (piece === image) return { id: paragraph.dataset.id, offset: total };
      total += isInline(piece) ? 1 : piece.length;
    }
    return null;
  }

  /** The paragraph element a node lies in. */
  paragraphOf(node: Node | null): HTMLElement | null {
    const element = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement;
    const found = element?.closest<HTMLElement>('[data-p]') ?? null;
    return found && this.root.contains(found) ? found : null;
  }

  /** The place in the text a DOM position (as a selection or a range gives it) means. */
  pointAt(node: Node | null, offset: number): Point | null {
    if (!node || !this.root.contains(node)) return null;
    const paragraph = this.paragraphOf(node);
    if (!paragraph?.dataset.id) return this.boundary(node, offset);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    try {
      range.setEnd(node, offset);
    } catch {
      return { id: paragraph.dataset.id, offset: 0 };
    }
    let length = range.toString().length;
    if (paragraph.querySelector('img[data-inline]')) {
      length += range.cloneContents().querySelectorAll('img[data-inline]').length;
    }
    return { id: paragraph.dataset.id, offset: length };
  }

  /** Between blocks (the text itself, a cell, a table): the start of what follows, else the end before. */
  private boundary(node: Node, offset: number): Point | null {
    const edge = (element: Element | null | undefined, end: boolean): Point | null => {
      if (!element) return null;
      const own = (element as HTMLElement).dataset.p !== undefined ? [element] : [];
      const all = [...own, ...element.querySelectorAll<HTMLElement>('[data-p]')] as HTMLElement[];
      const target = end ? all.at(-1) : all[0];
      if (!target?.dataset.id) return null;
      return {
        id: target.dataset.id,
        offset: end ? this.textOf(target).length : 0,
      };
    };
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const children = (node as Element).children;
    return (
      edge(children[offset], false) ??
      edge(children[offset - 1] ?? children[children.length - 1], true) ??
      edge(this.root, false)
    );
  }

  /** A paragraph's text as it stands in the page right now. */
  textOf(paragraph: HTMLElement): string {
    let text = '';
    for (const piece of pieces(paragraph)) {
      text += isInline(piece) ? WRITER_PICTURE_CHAR : (piece.nodeValue ?? '');
    }
    return text;
  }

  /** Where a place in the text lies in the page. */
  domOf(point: Point): { node: Node; offset: number } | null {
    const paragraph = this.elements.get(point.id);
    if (!paragraph) return null;
    const beside = (image: HTMLImageElement, after: boolean) => {
      const parent = image.parentNode ?? paragraph;
      return {
        node: parent,
        offset: [...parent.childNodes].indexOf(image) + (after ? 1 : 0),
      };
    };
    let total = 0;
    let last: Text | HTMLImageElement | null = null;
    for (const piece of pieces(paragraph)) {
      if (isInline(piece)) {
        // A picture is one character: the place before it lies beside it, not in it.
        if (point.offset <= total) return beside(piece, false);
        total += 1;
        last = piece;
        continue;
      }
      // At a seam the end of what stands before it: there typing goes on in that look.
      if (point.offset <= total + piece.length) {
        return { node: piece, offset: point.offset - total };
      }
      total += piece.length;
      last = piece;
    }
    if (last) return isInline(last) ? beside(last, true) : { node: last, offset: last.length };
    // No text: before the line it stands on.
    const pad = [...paragraph.childNodes].findIndex(
      (child) => child.nodeName === 'BR' || child.nodeName === 'IMG',
    );
    return { node: paragraph, offset: pad < 0 ? paragraph.childNodes.length : pad };
  }

  rangeOf(from: Point, to: Point): Range | null {
    const start = this.domOf(from);
    const end = this.domOf(to);
    if (!start || !end) return null;
    const range = document.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
    } catch {
      return null;
    }
    return range;
  }

  /** What is selected in the text, as the page has it. */
  selection(): Sel | null {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const anchor = this.pointAt(selection.anchorNode, selection.anchorOffset);
    const focus = this.pointAt(selection.focusNode, selection.focusOffset);
    return anchor && focus ? { anchor, focus } : null;
  }

  /** The page's selection set to this one – left alone where it says the same already. */
  select(sel: Sel) {
    const anchor = this.domOf(sel.anchor);
    const focus = this.domOf(sel.focus);
    const selection = document.getSelection();
    if (!anchor || !focus || !selection) return;
    if (
      selection.anchorNode === anchor.node &&
      selection.anchorOffset === anchor.offset &&
      selection.focusNode === focus.node &&
      selection.focusOffset === focus.offset
    )
      return;
    try {
      selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
    } catch {
      // A node that left the page in between: the next render sets it again.
    }
  }

  /**
   * A paragraph read back from the page – after the browser wrote into it itself (a word
   * composed from several keys, a correction by the system). Text it put beside the spans
   * looks as what stands before it.
   */
  read(block: WriterParagraphBlock): WriterRun[] | null {
    const paragraph = this.elements.get(block.id);
    if (!paragraph) return null;
    const runs: WriterRun[] = [];
    let marks: Marks = block.runs[0]
      ? (({ text: _text, ...rest }) => rest)(block.runs[0])
      : baseMarks(block.look);
    const walk = (node: Node, inherited: Marks | null) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          if (isSkipped(child)) continue;
          const own = inherited ?? marks;
          runs.push({ ...own, text: child.nodeValue ?? '' });
          marks = own;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const element = child as HTMLElement;
          if (element.dataset.skip !== undefined) continue;
          if (isInline(element)) {
            try {
              const own = JSON.parse(element.dataset.m ?? '') as Marks;
              if (own.picture) runs.push({ ...own, text: WRITER_PICTURE_CHAR });
            } catch {
              // Not one of ours: nothing of the text.
            }
            continue;
          }
          if (element.nodeName === 'BR') {
            runs.push({ ...(inherited ?? marks), text: '\n' });
            continue;
          }
          let own = inherited;
          if (element.dataset.m !== undefined) {
            try {
              own = JSON.parse(element.dataset.m) as Marks;
            } catch {
              own = inherited;
            }
          }
          walk(element, own);
        }
      }
    };
    walk(paragraph, null);
    return normalize(runs);
  }

  /** The ids of the paragraphs standing in the page, in its order. */
  idsInPage(): string[] {
    return [...this.root.querySelectorAll<HTMLElement>('[data-p]')].flatMap(
      (element) => element.dataset.id ?? [],
    );
  }

  /** Forgets what it drew, so the next `render` builds every block anew (fonts arrived). */
  redrawAll() {
    this.drawn.clear();
  }
}
