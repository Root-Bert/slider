import type { ParsedComment } from '../types';
import { attr, localName, type XmlElement } from '../xml';

export type CommentAuthor = ParsedComment['author'];
export type AuthorDirectory = ReadonlyMap<string, CommentAuthor>;

export const UNKNOWN_AUTHOR: CommentAuthor = { name: 'Unknown', initials: null };

/**
 * Reads an author list – `p188:authorLst/p188:author` (modern) or `p:cmAuthorLst/p:cmAuthor`
 * (legacy). Both carry `@id`, `@name` and `@initials`; matching by local name covers both.
 */
export function readAuthors(root: XmlElement | null, elementName: string): AuthorDirectory {
  const authors = new Map<string, CommentAuthor>();
  for (const element of root?.children ?? []) {
    if (localName(element.name) !== elementName) continue;
    const id = attr(element, 'id');
    if (id === undefined) continue;
    authors.set(id, {
      name: attr(element, 'name') || UNKNOWN_AUTHOR.name,
      initials: attr(element, 'initials') || null,
    });
  }
  return authors;
}

export const lookupAuthor = (authors: AuthorDirectory, id: string | undefined): CommentAuthor =>
  (id !== undefined ? authors.get(id) : undefined) ?? UNKNOWN_AUTHOR;
