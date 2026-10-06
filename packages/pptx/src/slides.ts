import type { Archive } from './archive';
import { solidFillOf } from './colors';
import { textHash } from './hash';
import { readBackground, type LayoutContext } from './layouts';
import { walkShapeTree, type ShapeNode } from './shape-tree';
import { NO_TEXT_DEFAULTS, paragraphsToText, plainText, readParagraphs } from './text';
import { normaliseRect } from './transform';
import { PptxError, type ParsedShape, type ParsedSlide } from './types';
import { attr, child, children, descendants, path } from './xml';

export interface SlideRef {
  sldId: number;
  index: number;
  path: string;
}

type SlideSize = { cx: number; cy: number };

/** Parses one slide part into its public representation. */
export async function parseSlide(
  archive: Archive,
  ref: SlideRef,
  size: SlideSize,
  layout: LayoutContext,
): Promise<ParsedSlide> {
  const slide = await archive.readXml(ref.path);
  if (!slide) throw new PptxError('corrupt', `Missing slide part ${ref.path}`);
  const cSld = child(slide, 'p:cSld');

  const shapes: ParsedShape[] = [];
  for (const node of walkShapeTree(child(cSld, 'p:spTree'))) {
    shapes.push(await toParsedShape(archive, ref.path, node, size, layout));
  }

  const titleShape = shapes.find(
    (shape) => shape.placeholder === 'title' || shape.placeholder === 'ctrTitle',
  );

  return {
    sldId: ref.sldId,
    index: ref.index,
    path: ref.path,
    hidden: attr(slide, 'show') === '0' || attr(slide, 'show') === 'false',
    title: titleShape?.text.trim() || null,
    layoutName: layout.name,
    textHash: textHash(shapes.map((shape) => shape.text).join('\n')),
    shapes,
    background: readBackground(cSld, layout.scheme) ?? layout.background,
  };
}

async function toParsedShape(
  archive: Archive,
  slidePath: string,
  node: ShapeNode,
  size: SlideSize,
  layout: LayoutContext,
): Promise<ParsedShape> {
  const inherited = node.placeholder ? layout.resolvePlaceholder(node.placeholder) : null;
  const box = node.box ?? inherited?.box ?? { x: 0, y: 0, w: 0, h: 0 };
  const paragraphs = readParagraphs(
    child(node.element, 'p:txBody'),
    inherited?.text ?? NO_TEXT_DEFAULTS,
    layout.scheme,
  );
  const tableRows = node.kind === 'table' ? readTableRows(node) : undefined;

  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    bbox: normaliseRect(box, size),
    text: tableRows
      ? tableRows.map((row) => row.join('\t')).join('\n')
      : paragraphsToText(paragraphs),
    paragraphs,
    imagePath: node.kind === 'picture' ? await imagePathOf(archive, slidePath, node) : null,
    fill: solidFillOf(child(node.element, 'p:spPr'), layout.scheme),
    placeholder: node.placeholder?.type ?? null,
    ...(tableRows && { tableRows }),
  };
}

async function imagePathOf(
  archive: Archive,
  slidePath: string,
  node: ShapeNode,
): Promise<string | null> {
  const relId = attr(path(node.element, 'p:blipFill', 'a:blip'), 'r:embed');
  if (!relId) return null;
  return (await archive.relationshipById(slidePath, relId))?.target ?? null;
}

/** Cell texts of an `a:tbl`, row by row (merged cells appear as empty strings). */
function readTableRows(node: ShapeNode): string[][] {
  const [table] = descendants(node.element, 'a:tbl');
  return children(table, 'a:tr').map((row) =>
    children(row, 'a:tc').map((cell) => plainText(child(cell, 'a:txBody'))),
  );
}
