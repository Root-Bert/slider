import type { ParsedShapeKind } from './types';
import {
  applyTransform,
  groupTransform,
  IDENTITY,
  readXfrm,
  type EmuRect,
  type Transform,
} from './transform';
import { attr, boolAttr, child, descendants, findByLocalName, path, type XmlElement } from './xml';

/** Placeholder reference of a shape (`p:nvPr/p:ph`). */
export interface PlaceholderRef {
  /** Effective type: `@type`, or `body` when only `@idx` is given, or `obj` when neither is. */
  type: string;
  idx: string | null;
}

/** A leaf shape of a shape tree, with its own box already mapped through enclosing groups. */
export interface ShapeNode {
  element: XmlElement;
  kind: ParsedShapeKind;
  id: string;
  name: string;
  /** Slide-space box in EMU, or `null` if the shape has no `xfrm` (inherits from a placeholder). */
  box: EmuRect | null;
  placeholder: PlaceholderRef | null;
}

/**
 * Walks a `p:spTree` (or `p:grpSp`) depth-first in document order, i.e. back-to-front z-order,
 * yielding leaf shapes. Groups are flattened; their transforms are composed onto the children.
 */
export function* walkShapeTree(
  tree: XmlElement | undefined,
  transform: Transform = IDENTITY,
): Generator<ShapeNode> {
  for (const element of tree?.children ?? []) {
    // Hidden in PowerPoint's selection pane (often animation helpers): not drawn, not a target.
    if (isHidden(element)) continue;
    switch (element.name) {
      case 'p:grpSp':
        yield* walkShapeTree(
          element,
          groupTransform(path(element, 'p:grpSpPr', 'a:xfrm'), transform),
        );
        break;
      case 'mc:AlternateContent': {
        // Markup-compatibility wrapper: the fallback is plain PresentationML we understand.
        const branch = child(element, 'mc:Fallback') ?? child(element, 'mc:Choice');
        yield* walkShapeTree(branch, transform);
        break;
      }
      case 'p:sp':
      case 'p:pic':
      case 'p:cxnSp':
      case 'p:graphicFrame':
        yield toShapeNode(element, transform);
        break;
      default:
        // Non-visual group properties (`p:nvGrpSpPr`, `p:grpSpPr`), `p:extLst`, content parts, …
        break;
    }
  }
}

function isHidden(element: XmlElement): boolean {
  const nonVisual = element.children.find((candidate) => candidate.name.startsWith('p:nv'));
  return boolAttr(child(nonVisual, 'p:cNvPr'), 'hidden') === true;
}

function toShapeNode(element: XmlElement, transform: Transform): ShapeNode {
  const nonVisual = element.children.find((candidate) => candidate.name.startsWith('p:nv'));
  const properties = child(nonVisual, 'p:cNvPr');
  const xfrm =
    element.name === 'p:graphicFrame'
      ? child(element, 'p:xfrm')
      : path(element, 'p:spPr', 'a:xfrm');
  const box = readXfrm(xfrm);
  return {
    element,
    kind: shapeKind(element),
    id: attr(properties, 'id') ?? '',
    name: attr(properties, 'name') ?? '',
    box: box && applyTransform(transform, box),
    placeholder: readPlaceholderRef(child(child(nonVisual, 'p:nvPr'), 'p:ph')),
  };
}

function shapeKind(element: XmlElement): ParsedShapeKind {
  switch (element.name) {
    case 'p:pic':
      return 'picture';
    case 'p:cxnSp':
      return 'connector';
    case 'p:graphicFrame':
      return findByLocalName(path(element, 'a:graphic', 'a:graphicData'), 'tbl')
        ? 'table'
        : 'other';
    default:
      return isTextShape(element) ? 'text' : 'other';
  }
}

/** Placeholders always count as text; other shapes only when they actually contain text. */
function isTextShape(shape: XmlElement): boolean {
  if (path(shape, 'p:nvSpPr', 'p:nvPr', 'p:ph')) return true;
  return descendants(child(shape, 'p:txBody'), 'a:t').some((run) => run.text.trim() !== '');
}

function readPlaceholderRef(ph: XmlElement | undefined): PlaceholderRef | null {
  if (!ph) return null;
  const idx = attr(ph, 'idx') ?? null;
  return { type: attr(ph, 'type') ?? (idx === null ? 'obj' : 'body'), idx };
}
