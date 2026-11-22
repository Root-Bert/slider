import { CLOUD_TRASH_DAYS, searchFold, WRITER_IMPORTS, type WriterDocument } from '@slider/shared';

/** The list's tabs: every document, those with open comments, the deleted ones. */
export type DocumentTab = 'all' | 'open' | 'trash';

export const DOCUMENT_SORTS = ['updated', 'name', 'comments'] as const;
export type DocumentSort = (typeof DOCUMENT_SORTS)[number];
export const DOCUMENT_SORT_LABELS: Record<DocumentSort, string> = {
  updated: 'Zuletzt aktualisiert',
  name: 'Name',
  comments: 'Offene Kommentare',
};

const byName = (a: WriterDocument, b: WriterDocument) =>
  a.title.localeCompare(b.title, 'de', { numeric: true, sensitivity: 'base' });
const byUpdate = (a: WriterDocument, b: WriterDocument) => b.updatedAt.localeCompare(a.updatedAt);

export const documentOrder = (sort: DocumentSort) => (a: WriterDocument, b: WriterDocument) =>
  sort === 'name'
    ? byName(a, b) || byUpdate(a, b)
    : sort === 'comments'
      ? b.openComments - a.openComments || byUpdate(a, b)
      : byUpdate(a, b) || byName(a, b);

export function selectDocuments(
  documents: readonly WriterDocument[],
  { tab, query, sort }: { tab: DocumentTab; query: string; sort: DocumentSort },
): WriterDocument[] {
  const needle = searchFold(query.trim());
  return documents
    .filter((document) => tab !== 'open' || document.openComments > 0)
    .filter((document) => needle === '' || searchFold(document.title).includes(needle))
    .sort(documentOrder(sort));
}

const DAY_MS = 86_400_000;
/** Days a deleted document still lies in the trash, at least one. */
export function trashDaysLeft(document: WriterDocument, now = Date.now()): number {
  const since = document.deletedAt ? Date.parse(document.deletedAt) : now;
  return Math.max(1, Math.ceil((since + CLOUD_TRASH_DAYS * DAY_MS - now) / DAY_MS));
}

/** What a file picker offers: every text file Writer makes a document of. */
export const DOCUMENT_ACCEPT = WRITER_IMPORTS.map((extension) => `.${extension}`).join(',');
export const isImportable = (file: File) =>
  (WRITER_IMPORTS as readonly string[]).includes(file.name.split('.').pop()?.toLowerCase() ?? '');
