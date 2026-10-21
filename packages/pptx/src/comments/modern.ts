import { clampPoint, type Rect } from '@slider/shared';
import type { ParsedComment, ParsedCommentAnchor, ParsedReply } from '../types';
import { plainText } from '../text';
import { attr, child, children, intAttr, localName, type XmlElement } from '../xml';
import { lookupAuthor, type AuthorDirectory } from './authors';

/**
 * Modern (threaded) comments, PowerPoint 365+ (BER-112): `ppt/comments/modernComment_*.xml`
 * with a `p188:cmLst` root. Authors live in `ppt/authors.xml`.
 */

/** Monikers that point a comment at a shape (`ac:spMk`, `ac:picMk`, …). */
const SHAPE_MONIKERS = new Set(['spMk', 'picMk', 'grpSpMk', 'cxnSpMk', 'graphicFrameMk']);

/** Comment content that never contains the comment's own anchor monikers. */
const NON_ANCHOR_CONTENT = new Set(['p188:txBody', 'p188:replyLst', 'p188:extLst']);

const DONE_STATUSES = new Set(['resolved', 'closed']);

export function readModernComments(
  root: XmlElement | null,
  slide: {
    sldId: number;
    size: { cx: number; cy: number };
    /** Group id → union box of its children (groups are flattened out of the shape list). */
    groups?: ReadonlyMap<string, Rect>;
  },
  authors: AuthorDirectory,
): ParsedComment[] {
  return children(root, 'p188:cm').map((comment) => ({
    externalId: attr(comment, 'id') ?? '',
    format: 'modern',
    sldId: slide.sldId,
    author: lookupAuthor(authors, attr(comment, 'authorId')),
    createdAt: attr(comment, 'created') ?? null,
    text: plainText(child(comment, 'p188:txBody')),
    status: DONE_STATUSES.has(attr(comment, 'status') ?? '') ? 'done' : 'open',
    anchor: readAnchor(comment, slide.size, slide.groups),
    replies: children(child(comment, 'p188:replyLst'), 'p188:reply').map((reply): ParsedReply => ({
      externalId: attr(reply, 'id') ?? '',
      author: lookupAuthor(authors, attr(reply, 'authorId')),
      createdAt: attr(reply, 'created') ?? null,
      text: plainText(child(reply, 'p188:txBody')),
    })),
  }));
}

/** Shape monikers outside the comment body and replies, in document order. */
function shapeMonikers(element: XmlElement, found: XmlElement[] = []): XmlElement[] {
  for (const candidate of element.children) {
    if (NON_ANCHOR_CONTENT.has(candidate.name)) continue;
    if (SHAPE_MONIKERS.has(localName(candidate.name)) && attr(candidate, 'id') !== undefined) {
      found.push(candidate);
    }
    shapeMonikers(candidate, found);
  }
  return found;
}

/**
 * Shape monikers are nested in moniker lists whose exact structure varies between PowerPoint
 * builds (`ac:deMkLst`, `pc:sldMkLst`, …), so they are found by local name anywhere outside
 * the comment body and replies. The list is a path from the slide down (`grpSpMk`, then the
 * `spMk` inside the group), so the innermost shape wins; a group alone becomes its box.
 */
function readAnchor(
  comment: XmlElement,
  size: { cx: number; cy: number },
  groups: ReadonlyMap<string, Rect> | undefined,
): ParsedCommentAnchor {
  const monikers = shapeMonikers(comment);
  const shape = monikers.findLast((moniker) => localName(moniker.name) !== 'grpSpMk');
  const shapeId = attr(shape, 'id');
  if (shapeId !== undefined) return { type: 'shape', shapeId };
  const groupId = attr(monikers.at(-1), 'id');
  if (groupId !== undefined) {
    const rect = groups?.get(groupId);
    return rect ? { type: 'rect', rect, shapeId: groupId } : { type: 'shape', shapeId: groupId };
  }

  const position = child(comment, 'p188:pos');
  const x = intAttr(position, 'x');
  const y = intAttr(position, 'y');
  if (x !== undefined && y !== undefined) {
    return { type: 'point', point: clampPoint({ x: x / size.cx, y: y / size.cy }) };
  }
  return { type: 'slide' };
}
