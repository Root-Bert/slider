import { clampPoint } from '@slider/shared';
import type { ParsedComment, ParsedCommentAnchor, ParsedReply } from '../types';
import { plainText } from '../text';
import { attr, child, children, findDescendant, intAttr, localName, type XmlElement } from '../xml';
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
  slide: { sldId: number; size: { cx: number; cy: number } },
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
    anchor: readAnchor(comment, slide.size),
    replies: children(child(comment, 'p188:replyLst'), 'p188:reply').map((reply): ParsedReply => ({
      externalId: attr(reply, 'id') ?? '',
      author: lookupAuthor(authors, attr(reply, 'authorId')),
      createdAt: attr(reply, 'created') ?? null,
      text: plainText(child(reply, 'p188:txBody')),
    })),
  }));
}

/**
 * Shape monikers are nested in moniker lists whose exact structure varies between PowerPoint
 * builds (`ac:deMkLst`, `pc:sldMkLst`, …), so they are found by local name anywhere outside
 * the comment body and replies.
 */
function readAnchor(comment: XmlElement, size: { cx: number; cy: number }): ParsedCommentAnchor {
  const moniker = findDescendant(
    comment,
    (element) => SHAPE_MONIKERS.has(localName(element.name)) && attr(element, 'id') !== undefined,
    (element) => NON_ANCHOR_CONTENT.has(element.name),
  );
  const shapeId = attr(moniker, 'id');
  if (shapeId !== undefined) return { type: 'shape', shapeId };

  const position = child(comment, 'p188:pos');
  const x = intAttr(position, 'x');
  const y = intAttr(position, 'y');
  if (x !== undefined && y !== undefined) {
    return { type: 'point', point: clampPoint({ x: x / size.cx, y: y / size.cy }) };
  }
  return { type: 'slide' };
}
