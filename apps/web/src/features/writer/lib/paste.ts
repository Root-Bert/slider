import {
  isWriterLink,
  MAX_LIST_LEVEL,
  WRITER_PICTURE_CHAR,
  WRITER_ALIGNS,
  WRITER_KINDS,
  type WriterAlign,
  type WriterKind,
  type WriterParagraph,
  type WriterRun,
} from '@slider/shared';
import { LINK_COLOR, normalize, type Marks } from './model';

/*
 * What is pasted, as paragraphs: Writer's own copy keeps every look (its spans carry them),
 * anything else its words, their weight, slant, lines and links, headings, lists and quotes.
 * Fonts, sizes and colours of other programs stay behind – the text takes this document's.
 */

const BLOCKS = new Set([
  'P',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'TR',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'UL',
  'OL',
  'TABLE',
  'DT',
  'DD',
]);
const SKIPPED = new Set(['STYLE', 'SCRIPT', 'META', 'LINK', 'TITLE', 'HEAD', 'TEMPLATE']);

const isAlign = (value: string | undefined): value is WriterAlign =>
  (WRITER_ALIGNS as readonly string[]).includes(value ?? '');

interface Shape {
  kind: WriterKind;
  level?: number;
  align?: WriterAlign;
  list?: WriterParagraph['list'];
}

function shapeOf(element: HTMLElement, depth: number, ordered: boolean | null): Shape {
  const name = element.nodeName;
  // Writer's own paragraph says what it is.
  if (element.dataset.p !== undefined) {
    const kind = element.dataset.kind as WriterKind | undefined;
    const [listKind, listLevel] = (element.dataset.list ?? '').split(':');
    return {
      kind: kind && WRITER_KINDS.includes(kind) ? kind : 'text',
      ...(kind === 'heading' && { level: Number(element.dataset.level) || 1 }),
      ...(isAlign(element.dataset.align) && { align: element.dataset.align }),
      ...((listKind === 'bullet' || listKind === 'number') && {
        list: {
          kind: listKind,
          level: Math.min(MAX_LIST_LEVEL, Math.max(0, Number(listLevel) || 0)),
        },
      }),
    };
  }
  if (/^H[1-6]$/.test(name)) return { kind: 'heading', level: Number(name[1]) };
  if (name === 'BLOCKQUOTE') return { kind: 'quote' };
  if (name === 'LI' && ordered !== null) {
    return {
      kind: 'text',
      list: {
        kind: ordered ? 'number' : 'bullet',
        level: Math.min(MAX_LIST_LEVEL, Math.max(0, depth - 1)),
      },
    };
  }
  return { kind: 'text' };
}

function marksOf(element: HTMLElement, inherited: Marks): Marks {
  if (element.dataset.m !== undefined) {
    try {
      // A picture is taken where it stands (`walk`), never handed down to words.
      const { picture: _picture, ...own } = JSON.parse(element.dataset.m) as Marks;
      const { link, ...rest } = own;
      return link && isWriterLink(link) ? own : rest;
    } catch {
      return inherited;
    }
  }
  const marks: Marks = { ...inherited };
  const name = element.nodeName;
  const style = element.style;
  const weight = style.fontWeight;
  if (name === 'B' || name === 'STRONG' || weight === 'bold' || Number(weight) >= 600)
    marks.bold = true;
  else if (weight === 'normal' || (weight !== '' && Number(weight) < 600)) delete marks.bold;
  if (name === 'I' || name === 'EM' || style.fontStyle === 'italic') marks.italic = true;
  const lines = `${style.textDecorationLine} ${style.textDecoration}`;
  if (name === 'U' || lines.includes('underline')) marks.underline = true;
  if (name === 'S' || name === 'STRIKE' || name === 'DEL' || lines.includes('line-through'))
    marks.strike = true;
  if (name === 'A') {
    const href = element.getAttribute('href') ?? '';
    if (isWriterLink(href)) {
      marks.link = href;
      marks.underline = true;
      marks.color = LINK_COLOR;
    }
  }
  return marks;
}

/** Runs of white space become one blank, as a browser shows them. */
const squeezed = (text: string) => text.replace(/[\t\n\r ]+/g, ' ');

/**
 * `pictureUrl`: where this document's pictures are fetched. A picture in a line comes along
 * only when it is one of this document's (copied here) – another document's is not in the file.
 */
export function fromHtml(html: string, pictureUrl?: (path: string) => string): WriterParagraph[] {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const out: WriterParagraph[] = [];
  let runs: WriterRun[] = [];
  let shape: Shape = { kind: 'text' };

  const close = () => {
    const tidy = normalize(runs);
    const first = tidy[0];
    const last = tidy.at(-1);
    if (first) first.text = first.text.replace(/^ +/, '');
    if (last && last !== first) last.text = last.text.replace(/ +$/, '');
    else if (last) last.text = last.text.replace(/ +$/, '');
    const kept = normalize(tidy);
    if (kept.length > 0) out.push({ ...shape, runs: kept });
    runs = [];
  };

  const walk = (node: Node, marks: Marks, depth: number, ordered: boolean | null, pre: boolean) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = pre ? (child.nodeValue ?? '') : squeezed(child.nodeValue ?? '');
        if (text !== '' && !(text === ' ' && runs.length === 0)) runs.push({ ...marks, text });
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const element = child as HTMLElement;
      const name = element.nodeName;
      if (SKIPPED.has(name) || element.dataset.skip !== undefined) continue;
      if (name === 'BR') {
        runs.push({ ...marks, text: '\n' });
        continue;
      }
      if (name === 'IMG') {
        if (element.dataset.inline === undefined || !pictureUrl) continue;
        try {
          const { picture } = JSON.parse(element.dataset.m ?? '') as Marks;
          if (
            picture &&
            typeof picture.path === 'string' &&
            Number.isFinite(picture.width) &&
            Number.isFinite(picture.height) &&
            element.getAttribute('src') === pictureUrl(picture.path)
          ) {
            runs.push({
              text: WRITER_PICTURE_CHAR,
              picture: { path: picture.path, width: picture.width, height: picture.height },
            });
          }
        } catch {
          // Not one of ours.
        }
        continue;
      }
      const own = marksOf(element, marks);
      if (!BLOCKS.has(name)) {
        walk(element, own, depth, ordered, pre);
        continue;
      }
      close();
      const before = shape;
      if (name === 'UL' || name === 'OL') {
        walk(element, own, depth + 1, name === 'OL', pre);
      } else {
        shape = shapeOf(element, depth, name === 'LI' ? ordered : null);
        walk(
          element,
          own,
          depth,
          ordered,
          pre || name === 'PRE' || element.dataset.p !== undefined,
        );
      }
      close();
      shape = before;
    }
  };
  walk(parsed.body, {}, 0, null, false);
  close();
  return out;
}

export function fromText(text: string): WriterParagraph[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => ({ kind: 'text' as const, runs: line === '' ? [] : [{ text: line }] }));
}

/** What a paste brings: Writer's own or a program's formatted text, else its plain words. */
export function pastedParagraphs(
  data: DataTransfer,
  pictureUrl?: (path: string) => string,
): WriterParagraph[] {
  const html = data.getData('text/html');
  if (html) {
    const paragraphs = fromHtml(html, pictureUrl);
    if (paragraphs.length > 0) return paragraphs;
  }
  const text = data.getData('text/plain');
  return text === '' ? [] : fromText(text);
}
