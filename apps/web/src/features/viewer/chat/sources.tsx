import { MATERIAL_CITATION, type Material } from '@slider/shared';
import { Fragment, type ReactNode } from 'react';
import { Icon } from '@/ui';

/*
 * The sources in the AI's answers about a presentation's material: `[[id#page]]` after a
 * sentence – a chip that opens the file, its name (and page) in words on the clipboard.
 */

/** A run of the answer's text with its sources (`[[id#page]]`) as chips that open the file. */
export function WithSources({
  text,
  byId,
  onOpen,
}: {
  text: string;
  byId: ReadonlyMap<string, Material>;
  onOpen: (material: Material, page: number | null) => void;
}) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(new RegExp(MATERIAL_CITATION.source, 'g'))) {
    const before = text.slice(at, match.index);
    at = match.index + match[0].length;
    const material = byId.get(match[1]!);
    const page = match[2] && material?.pages ? Number(match[2]) : null;
    parts.push(before.replace(/\s+$/, material ? ' ' : ''));
    if (!material) continue;
    const pageLabel =
      page === null ? '' : material.kind === 'presentation' ? `Folie ${page}` : `S. ${page}`;
    parts.push(
      <button
        key={match.index}
        type="button"
        title={`„${material.name}“${pageLabel ? ` ${pageLabel}` : ''} öffnen`}
        onClick={() => onOpen(material, page)}
        className="mx-px inline-flex max-w-full translate-y-[-1px] items-center gap-1 rounded-chip bg-surface-2 px-1.5 align-middle text-caption leading-5 font-medium text-fg-muted hover:bg-hover hover:text-fg"
      >
        <Icon name="description" size={12} className="shrink-0" />
        <span className="max-w-40 truncate">{material.name}</span>
        {pageLabel && <span className="shrink-0">| {pageLabel}</span>}
      </button>,
    );
  }
  if (at === 0) return text;
  parts.push(text.slice(at));
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
    </>
  );
}
