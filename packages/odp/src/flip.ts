import type { EditableElementKind, ElementFlip } from '@slider/shared';
import { graphicPropsOf } from './live';
import { writePictureMirror, type StyleSink } from './live-write';
import type { StyleIndex } from './styles';
import { attr, firstChild, setAttr, tagOf, type XmlNode } from './xml';

/*
 * An element mirrored (`setBox`): a drawn shape by its geometry's `draw:mirror-horizontal` and
 * `draw:mirror-vertical`, a picture by its style's `style:mirror` – left to right only, as
 * LibreOffice keeps it: mirrored top to bottom, a picture is turned half round and mirrored left
 * to right instead (it looks the same). Text frames, tables and groups do not mirror.
 */

/** A drawn shape's geometry, which carries its mirroring. */
const geometryOf = (node: XmlNode): XmlNode | undefined =>
  tagOf(node) === 'draw:custom-shape' ? firstChild(node, 'draw:enhanced-geometry') : undefined;

/** How the element is mirrored; `null`: it cannot be. */
export function readFlip(
  index: StyleIndex,
  node: XmlNode,
  kind: EditableElementKind,
): ElementFlip | null {
  if (kind === 'image') {
    const mirror = graphicPropsOf(index, node)['style:mirror'] ?? 'none';
    return { x: mirror.split(/\s+/).includes('horizontal'), y: false };
  }
  const geometry = kind === 'shape' ? geometryOf(node) : undefined;
  if (!geometry) return null;
  return {
    x: attr(geometry, 'draw:mirror-horizontal') === 'true',
    y: attr(geometry, 'draw:mirror-vertical') === 'true',
  };
}

/**
 * Mirrors the element so; for a picture mirrored top to bottom, how far (degrees) it is turned
 * on for it – else 0.
 */
export function writeFlip(
  sink: StyleSink,
  node: XmlNode,
  kind: EditableElementKind,
  flip: ElementFlip,
): number {
  if (kind === 'image') {
    writePictureMirror(sink, node, flip.x !== flip.y);
    return flip.y ? 180 : 0;
  }
  const geometry = kind === 'shape' ? geometryOf(node) : undefined;
  if (!geometry) return 0;
  setAttr(geometry, 'draw:mirror-horizontal', String(flip.x));
  setAttr(geometry, 'draw:mirror-vertical', String(flip.y));
  return 0;
}
