import { useId } from 'react';
import { Link } from 'react-router';
import type { Deck } from '@slider/shared';
import { routes } from '@/app/routes';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { useDecks } from '@/lib/queries';
import { Icon } from '@/ui';
import { SlideThumbnail } from '@/features/reviews/components/SlideThumbnail';
import { isImporting } from '@/features/reviews/lib/deck-labels';
import { markDeckVisited } from '@/features/reviews/lib/last-visits';

const RECENT_COUNT = 3;

const mostRecent = (decks: readonly Deck[]) =>
  decks
    .filter((deck) => deck.archivedAt === null)
    .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, RECENT_COUNT);

/** The person shown next to a deck: the first other reviewer, else the owner. */
const personOf = (deck: Deck) =>
  deck.participants.find((person) => person.id !== deck.owner.id) ?? deck.owner;

/** "Zuletzt geöffnet" (A1). Hidden for new users without decks. */
export function RecentDecks() {
  const headingId = useId();
  const { data: decks, isPending } = useDecks();
  const recent = decks ? mostRecent(decks) : [];
  if (!isPending && recent.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1 text-xs">
        <h2 id={headingId} className="text-fg-subtle">
          Zuletzt geöffnet
        </h2>
        <Link to={routes.reviews()} className="text-fg-subtle hover:text-fg">
          Alle anzeigen
        </Link>
      </div>
      <ul className="glass flex flex-col gap-0.5 rounded-panel p-1.5" aria-busy={isPending}>
        {isPending
          ? Array.from({ length: RECENT_COUNT }, (_, index) => <RecentDeckSkeleton key={index} />)
          : recent.map((deck) => <RecentDeckItem key={deck.id} deck={deck} />)}
      </ul>
    </section>
  );
}

function RecentDeckItem({ deck }: { deck: Deck }) {
  return (
    <li>
      <Link
        to={routes.deck(deck.id)}
        onClick={() => markDeckVisited(deck.id)}
        className="flex items-center gap-3 rounded-control p-1.5 transition-colors hover:bg-white/5"
      >
        <SlideThumbnail
          src={deck.thumbnailUrl}
          pending={isImporting(deck)}
          className="w-12 shrink-0 rounded-[4px]"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-medium text-fg">{deck.title}</span>
          <span className="truncate text-xs text-fg-subtle">
            <time dateTime={deck.updatedAt} title={formatDateTime(deck.updatedAt)}>
              {formatRelativeTime(deck.updatedAt)}
            </time>{' '}
            · {personOf(deck).name}
          </span>
        </span>
        <span
          className="flex shrink-0 items-center gap-1 pr-2 text-xs text-fg-subtle"
          title="Offene Kommentare"
        >
          <Icon name="chatBubble" size={14} />
          <span className="sr-only">Offene Kommentare:</span>
          {deck.openCommentCount}
        </span>
      </Link>
    </li>
  );
}

function RecentDeckSkeleton() {
  return (
    <li className="flex items-center gap-3 p-1.5" aria-hidden>
      <div className="skeleton aspect-video w-12 rounded-[4px]" />
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="skeleton h-3 w-32 rounded" />
        <div className="skeleton h-2.5 w-24 rounded" />
      </div>
    </li>
  );
}
