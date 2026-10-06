import { clampPoint } from '@slider/shared';
import type { ParsedComment } from '../types';
import { EMU_PER_INCH } from '../transform';
import { attr, child, children, intAttr, type XmlElement } from '../xml';
import { lookupAuthor, type AuthorDirectory } from './authors';

/**
 * Legacy comments, PowerPoint 2007–2019 (BER-113): `ppt/comments/commentN.xml` with a `p:cmLst`
 * root. Authors live in `ppt/commentAuthors.xml`. Legacy comments are flat (no replies, no
 * status) and always anchored to a point.
 */

/**
 * `p:pos` is not in EMU: PowerPoint writes it in "master units" of 1/576 inch (8 per point at
 * 72 dpi). This is undocumented in ECMA-376 but consistent across PowerPoint versions, so
 * 1 unit = 914 400 / 576 = 1587.5 EMU.
 */
export const EMU_PER_LEGACY_POSITION_UNIT = EMU_PER_INCH / 576;

export function readLegacyComments(
  root: XmlElement | null,
  slide: { sldId: number; size: { cx: number; cy: number } },
  authors: AuthorDirectory,
): ParsedComment[] {
  return children(root, 'p:cm').map((comment) => {
    const authorId = attr(comment, 'authorId') ?? '';
    const position = child(comment, 'p:pos');
    const x = (intAttr(position, 'x') ?? 0) * EMU_PER_LEGACY_POSITION_UNIT;
    const y = (intAttr(position, 'y') ?? 0) * EMU_PER_LEGACY_POSITION_UNIT;
    return {
      externalId: `${authorId}:${attr(comment, 'idx') ?? ''}`,
      format: 'legacy',
      sldId: slide.sldId,
      author: lookupAuthor(authors, authorId),
      createdAt: attr(comment, 'dt') ?? null,
      text: child(comment, 'p:text')?.text ?? '',
      status: 'open',
      anchor: {
        type: 'point',
        point: clampPoint({ x: x / slide.size.cx, y: y / slide.size.cy }),
      },
      replies: [],
    };
  });
}
