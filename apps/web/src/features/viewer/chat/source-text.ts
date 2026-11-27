import { MATERIAL_CITATION, type Material } from '@slider/shared';

/* The sources of the AI's answers outside the answer shown: the clipboard's words, the file opened. */

/** The answer for the clipboard: its sources as the file's name (and page) in words. */
export function withoutSources(answer: string, byId: ReadonlyMap<string, Material>): string {
  return answer
    .replace(new RegExp(`\\s*${MATERIAL_CITATION.source}`, 'g'), (_, id: string, page?: string) => {
      const material = byId.get(id);
      if (!material) return '';
      const where =
        page && material.pages
          ? `, ${material.kind === 'presentation' ? 'Folie' : 'S.'} ${page}`
          : '';
      return ` (${material.name}${where})`;
    })
    .trim();
}

/** An answer's source opened: the file in a tab of its own, a PDF at its page. */
export function openSource(material: Material, page: number | null) {
  if (!material.url) return;
  const at = page && material.kind === 'pdf' ? `#page=${page}` : '';
  window.open(`${material.url}${at}`, '_blank', 'noopener');
}
