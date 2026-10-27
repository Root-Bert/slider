import type { DeckSearchHit, DeckSearchResult } from '@slider/shared';
import { cn } from '@/ui';

/** Where a hit is: "Folie 4", "Lena | Folie 3", or just the author for a comment off the slides. */
function hitPlace(hit: DeckSearchHit): string {
  const slide = hit.slideNumber === null ? null : `Folie ${hit.slideNumber}`;
  if (hit.kind === 'slide') return slide ?? 'Folie';
  return [hit.author ?? 'Kommentar', slide].filter(Boolean).join(' | ');
}

/**
 * The first place a deck's text matched the search (BER-175), its match highlighted, under the
 * title of its card or row – and how many more there are.
 */
export function SearchHit({ result, className }: { result: DeckSearchResult; className?: string }) {
  const [hit] = result.hits;
  if (!hit) return null;
  const { snippet, matchStart, matchLength } = hit;
  const more = result.hitCount - 1;
  return (
    <p className={cn('min-w-0 text-sm text-fg-muted', className)}>
      <span className="text-fg-subtle">{hitPlace(hit)}: </span>
      {snippet.slice(0, matchStart)}
      <mark className="rounded-mark bg-sage/25 px-0.5 text-fg">
        {snippet.slice(matchStart, matchStart + matchLength)}
      </mark>
      {snippet.slice(matchStart + matchLength)}
      {more > 0 && (
        <span className="text-fg-subtle">
          {' '}
          | {more === 1 ? '1 weiterer Treffer' : `${more} weitere Treffer`}
        </span>
      )}
    </p>
  );
}
