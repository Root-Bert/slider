import { CLOUD_TRASH_DAYS, searchFold, type ReaderPdf } from '@slider/shared';

/** The list's tabs: every PDF, those with open comments, the deleted ones. */
export type PdfTab = 'all' | 'open' | 'trash';

export const PDF_SORTS = ['updated', 'name', 'comments'] as const;
export type PdfSort = (typeof PDF_SORTS)[number];
export const PDF_SORT_LABELS: Record<PdfSort, string> = {
  updated: 'Zuletzt aktualisiert',
  name: 'Name',
  comments: 'Offene Kommentare',
};

const byName = (a: ReaderPdf, b: ReaderPdf) =>
  a.title.localeCompare(b.title, 'de', { numeric: true, sensitivity: 'base' });
const byUpdate = (a: ReaderPdf, b: ReaderPdf) => b.updatedAt.localeCompare(a.updatedAt);

export const pdfOrder = (sort: PdfSort) => (a: ReaderPdf, b: ReaderPdf) =>
  sort === 'name'
    ? byName(a, b) || byUpdate(a, b)
    : sort === 'comments'
      ? b.openComments - a.openComments || byUpdate(a, b)
      : byUpdate(a, b) || byName(a, b);

export function selectPdfs(
  pdfs: readonly ReaderPdf[],
  { tab, query, sort }: { tab: PdfTab; query: string; sort: PdfSort },
): ReaderPdf[] {
  const needle = searchFold(query.trim());
  return pdfs
    .filter((pdf) => tab !== 'open' || pdf.openComments > 0)
    .filter((pdf) => needle === '' || searchFold(pdf.title).includes(needle))
    .sort(pdfOrder(sort));
}

const DAY_MS = 86_400_000;
/** Days a deleted PDF still lies in the trash, at least one. */
export function trashDaysLeft(pdf: ReaderPdf, now = Date.now()): number {
  const since = pdf.deletedAt ? Date.parse(pdf.deletedAt) : now;
  return Math.max(1, Math.ceil((since + CLOUD_TRASH_DAYS * DAY_MS - now) / DAY_MS));
}

/** What a file picker offers: PDFs. */
export const PDF_ACCEPT = '.pdf,application/pdf';
export const isPdfFile = (file: File) =>
  file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
