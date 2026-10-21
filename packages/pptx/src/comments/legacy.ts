import { clampPoint } from '@slider/shared';
import type { ParsedComment } from '../types';
import { EMU_PER_INCH } from '../transform';
import { attr, child, children, findDescendant, intAttr, type XmlElement } from '../xml';
import { lookupAuthor, type AuthorDirectory } from './authors';

/**
 * Legacy comments, PowerPoint 2007–2019 (BER-113): `ppt/comments/commentN.xml` with a `p:cmLst`
 * root. Authors live in `ppt/commentAuthors.xml`. Legacy comments have no status and are always
 * anchored to a point. PowerPoint 2013–2019 writes a reply as its own `p:cm` that names its
 * parent in `p:extLst/p:ext/p15:threadingInfo/p15:parentCm`; those become `replies` of the root.
 */

/**
 * `p:pos` is not in EMU: PowerPoint writes it in "master units" of 1/576 inch (8 per point at
 * 72 dpi). This is undocumented in ECMA-376 but consistent across PowerPoint versions, so
 * 1 unit = 914 400 / 576 = 1587.5 EMU.
 */
export const EMU_PER_LEGACY_POSITION_UNIT = EMU_PER_INCH / 576;

const externalIdOf = (authorId: string | undefined, idx: string | undefined) =>
  `${authorId ?? ''}:${idx ?? ''}`;

export function readLegacyComments(
  root: XmlElement | null,
  slide: { sldId: number; size: { cx: number; cy: number } },
  authors: AuthorDirectory,
): ParsedComment[] {
  const elements = children(root, 'p:cm');
  const parentOf = new Map<string, string>();
  for (const comment of elements) {
    const parent = findDescendant(comment, (element) => element.name === 'p15:parentCm');
    if (!parent) continue;
    parentOf.set(
      externalIdOf(attr(comment, 'authorId'), attr(comment, 'idx')),
      externalIdOf(attr(parent, 'authorId'), attr(parent, 'idx')),
    );
  }
  const ids = new Set(elements.map((c) => externalIdOf(attr(c, 'authorId'), attr(c, 'idx'))));
  /** Root of a reply chain; a comment whose parent is missing (or a cycle) stays a root. */
  const rootOf = (id: string): string => {
    const seen = new Set([id]);
    let current = id;
    for (;;) {
      const parent = parentOf.get(current);
      if (parent === undefined || !ids.has(parent) || seen.has(parent)) return current;
      seen.add(parent);
      current = parent;
    }
  };

  const result: ParsedComment[] = [];
  const roots = new Map<string, ParsedComment>();
  const replies: { rootId: string; element: XmlElement; externalId: string }[] = [];
  for (const comment of elements) {
    const authorId = attr(comment, 'authorId') ?? '';
    const externalId = externalIdOf(authorId, attr(comment, 'idx'));
    const rootId = rootOf(externalId);
    if (rootId !== externalId) {
      replies.push({ rootId, element: comment, externalId });
      continue;
    }
    const position = child(comment, 'p:pos');
    const x = (intAttr(position, 'x') ?? 0) * EMU_PER_LEGACY_POSITION_UNIT;
    const y = (intAttr(position, 'y') ?? 0) * EMU_PER_LEGACY_POSITION_UNIT;
    const parsed: ParsedComment = {
      externalId,
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
    result.push(parsed);
    if (!roots.has(externalId)) roots.set(externalId, parsed);
  }
  for (const { rootId, element, externalId } of replies) {
    roots.get(rootId)?.replies.push({
      externalId,
      author: lookupAuthor(authors, attr(element, 'authorId')),
      createdAt: attr(element, 'dt') ?? null,
      text: child(element, 'p:text')?.text ?? '',
    });
  }
  return result;
}
