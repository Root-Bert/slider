import {
  WRITER_FORMATS,
  WRITER_PICTURE_CHAR,
  type WriterBlock,
  type WriterFormat,
  type WriterLook,
  type WriterOperation,
  type WriterPage,
  type WriterParagraphBlock,
} from '@slider/shared';
import { OdtError } from './errors';

/**
 * A Markdown file (`.md`) as Writer edits it: a paragraph a line, the line's characters its one
 * run – the file is plain text, so nothing else is in it. Writer draws it as Markdown (raw or
 * rendered, `features/writer/lib/markdown.ts`); here it is only lines.
 *
 * A line has no place for its id, so the ids lie beside the file (`ids`, kept with each version
 * the editor writes): read with a version that has none (made elsewhere), the lines are counted
 * (`L1`, `L2`, …) – the same each time it is read.
 *
 * What is not touched stays as it was, byte for byte: the line ends (`\n` or `\r\n`), a BOM, the
 * end of the file with or without a line end.
 */
export class MarkdownDocument {
  private dirty = false;

  private constructor(
    private lines: { id: string; text: string }[],
    private readonly eol: string,
    private readonly bom: boolean,
    private readonly endsWithEol: boolean,
  ) {}

  static open(bytes: Uint8Array, ids?: readonly string[] | null): MarkdownDocument {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new OdtError('corrupt', 'The file is not UTF-8 text.');
    }
    const bom = text.startsWith('﻿');
    if (bom) text = text.slice(1);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const endsWithEol = text.endsWith('\n');
    const raw = text.split(/\r?\n/);
    if (endsWithEol) raw.pop();
    if (raw.length === 0) raw.push('');
    const known =
      ids &&
      ids.length === raw.length &&
      new Set(ids).size === ids.length &&
      ids.every((id) => MARKDOWN_ID.test(id));
    return new MarkdownDocument(
      raw.map((line, index) => ({ id: known ? ids[index]! : `L${index + 1}`, text: line })),
      eol,
      bom,
      endsWithEol,
    );
  }

  /** Whether an operation changed the file. */
  get changed(): boolean {
    return this.dirty;
  }

  /** The lines' ids in their order: kept beside the version written. */
  ids(): string[] {
    return this.lines.map((line) => line.id);
  }

  blocks(): WriterBlock[] {
    return this.lines.map((line): WriterParagraphBlock => ({
      type: 'paragraph',
      id: line.id,
      kind: 'text',
      runs: line.text ? [{ text: line.text }] : [],
      look: MARKDOWN_FORMATS.text,
    }));
  }

  formats(): Record<WriterFormat, WriterLook> {
    return MARKDOWN_FORMATS;
  }

  /** Markdown has no pages; the editor draws it without them. */
  page(): WriterPage {
    return MARKDOWN_PAGE;
  }

  text(): string {
    return this.lines.map((line) => line.text).join('\n');
  }

  /**
   * Writes the operations in their order, as `OdtDocument.apply`: one whose line is gone is left
   * out (its index answered). What Markdown cannot hold – tables of cells, pictures, a page, a
   * format's look – is left out the same way.
   */
  apply(operations: readonly WriterOperation[]): number[] {
    const dropped: number[] = [];
    operations.forEach((op, index) => {
      if (!this.applyOne(op)) dropped.push(index);
    });
    return dropped;
  }

  private at(id: string | undefined): number {
    return id === undefined ? -1 : this.lines.findIndex((line) => line.id === id);
  }

  /** Where a line goes: after `afterId`, before `beforeId`, else at the end; -1 where that is gone. */
  private spot(place: { afterId?: string | undefined; beforeId?: string | undefined }): number {
    if (place.afterId !== undefined) {
      const at = this.at(place.afterId);
      return at < 0 ? -1 : at + 1;
    }
    if (place.beforeId !== undefined) return this.at(place.beforeId);
    return this.lines.length;
  }

  private applyOne(op: WriterOperation): boolean {
    switch (op.type) {
      case 'setParagraph': {
        const at = this.at(op.id);
        if (at < 0) return false;
        const text = lineOf(op.paragraph.runs);
        if (this.lines[at]!.text !== text) {
          this.lines[at] = { id: op.id, text };
          this.dirty = true;
        }
        return true;
      }
      case 'insertParagraph': {
        if (!MARKDOWN_ID.test(op.id) || this.at(op.id) >= 0) {
          throw new OdtError('operation', 'Diesen Absatz gibt es schon.');
        }
        const spot = this.spot(op);
        if (spot < 0) return false;
        this.lines.splice(spot, 0, { id: op.id, text: lineOf(op.paragraph.runs) });
        this.dirty = true;
        return true;
      }
      case 'remove': {
        const at = this.at(op.id);
        // A text keeps one line: there is always somewhere to type.
        if (at < 0 || this.lines.length <= 1) return false;
        this.lines.splice(at, 1);
        this.dirty = true;
        return true;
      }
      case 'moveBlock': {
        const at = this.at(op.id);
        if (at < 0 || op.afterId === op.id || op.beforeId === op.id) return false;
        const [line] = this.lines.splice(at, 1);
        const spot = this.spot(op);
        if (spot < 0) {
          this.lines.splice(at, 0, line!);
          return false;
        }
        this.lines.splice(spot, 0, line!);
        if (spot !== at) this.dirty = true;
        return true;
      }
      default:
        return false;
    }
  }

  toBytes(): Uint8Array {
    const text = this.lines.map((line) => line.text).join(this.eol);
    const whole = `${this.bom ? '﻿' : ''}${text}${this.endsWithEol ? this.eol : ''}`;
    return new TextEncoder().encode(whole);
  }
}

/** The ids the editor makes (`newId`) and those counted here. */
const MARKDOWN_ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

/** A line's characters: its runs' text, without line breaks and pictures (Markdown has neither). */
const lineOf = (runs: readonly { text: string }[]) =>
  runs
    .map((run) => run.text)
    .join('')
    .replaceAll(WRITER_PICTURE_CHAR, '')
    .replace(/\r?\n/g, ' ');

const TEXT_LOOK: WriterLook = {
  font: 'Inter Variable',
  size: 12,
  color: '#37352f',
  bold: false,
  italic: false,
  lineHeight: 1.5,
  spaceBefore: 0,
  spaceAfter: 0,
  indentLeft: 0,
  indentRight: 0,
  indentFirst: 0,
  align: 'left',
};

const heading = (size: number, spaceBefore: number): WriterLook => ({
  ...TEXT_LOOK,
  size,
  bold: true,
  lineHeight: 1.25,
  spaceBefore,
  spaceAfter: 3,
});

/** How Markdown is drawn rendered: one quiet face, headings by size, as Notion does. */
export const MARKDOWN_FORMATS: Record<WriterFormat, WriterLook> = {
  ...(Object.fromEntries(WRITER_FORMATS.map((format) => [format, TEXT_LOOK])) as Record<
    WriterFormat,
    WriterLook
  >),
  text: { ...TEXT_LOOK, spaceBefore: 2, spaceAfter: 2 },
  title: heading(30, 24),
  subtitle: { ...TEXT_LOOK, size: 15, color: '#787774' },
  heading1: heading(22.5, 24),
  heading2: heading(18, 18),
  heading3: heading(15, 12),
  heading4: heading(12, 10),
  heading5: heading(12, 8),
  heading6: { ...heading(12, 8), color: '#787774' },
  quote: { ...TEXT_LOOK, spaceBefore: 4, spaceAfter: 4, indentLeft: 14 },
  preformatted: { ...TEXT_LOOK, font: 'Menlo', size: 10.5, lineHeight: 1.45 },
  caption: { ...TEXT_LOOK, size: 10.5, color: '#787774' },
};

/** A column as wide as Notion's text (708 px), no margins: the editor draws no sheet. */
export const MARKDOWN_PAGE: WriterPage = {
  width: 531,
  height: 4000,
  marginTop: 0,
  marginRight: 0,
  marginBottom: 0,
  marginLeft: 0,
  numbers: false,
};
