import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Deck } from '@slider/shared';
import { AppHeader } from '@/app/AppHeader';
import { routes } from '@/app/routes';
import { pluralize } from '@/lib/format';
import { useDecks } from '@/lib/queries';
import { Button } from '@/ui';
import { DeckCollection, DeckCollectionSkeleton, type DeckView } from './components/DeckCollection';
import { DeckSearch } from './components/DeckSearch';
import { EmptyState } from './components/EmptyState';
import { NoResults } from './components/NoResults';
import { NotificationsButton } from './components/NotificationsButton';
import { ReviewsToolbar } from './components/ReviewsToolbar';
import { Toast } from '@/ui';
import { useStoredChoice } from './hooks/useStoredChoice';
import { useToast } from '@/ui';
import {
  activeTotals,
  countByTab,
  DECK_SORTS,
  selectDecks,
  type ReviewTab,
} from './lib/deck-filters';
import { useLastVisits } from './lib/last-visits';

const DECK_VIEWS = ['grid', 'list'] as const satisfies readonly DeckView[];
const NO_DECKS: readonly Deck[] = [];

/** G1 "Meine Reviews" – the owner's deck overview (BER-121, BER-124). */
export function Component() {
  const navigate = useNavigate();
  const decksQuery = useDecks();
  const decks = decksQuery.data ?? NO_DECKS;
  const { isUnseen } = useLastVisits();
  const [toast, showToast] = useToast();

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<ReviewTab>('all');
  const [sort, setSort] = useStoredChoice('slider.reviews.sort', DECK_SORTS, 'updated');
  const [view, setView] = useStoredChoice('slider.reviews.view', DECK_VIEWS, 'grid');

  const totals = activeTotals(decks);
  const visible = selectDecks(decks, { tab, query, sort });
  const goToNew = () => void navigate(routes.newReview());

  return (
    <div className="dot-grid min-h-full">
      <title>Meine Reviews · Slider</title>
      <AppHeader
        leading={
          <Button size="sm" icon="add" aria-label="Neuer Review" onClick={goToNew}>
            <span className="max-sm:hidden">Neuer Review</span>
          </Button>
        }
        center={<DeckSearch placement="header" value={query} onChange={setQuery} />}
        actions={<NotificationsButton decks={decks} isUnseen={isUnseen} />}
      />

      <main className="flex flex-col gap-6 px-4 pt-2 pb-16 md:px-14">
        <div className="flex flex-col gap-1">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-fg">
            Meine Reviews
          </h1>
          {decksQuery.isSuccess && (
            <p className="text-[13px] text-fg-subtle">
              {pluralize(totals.reviews, 'Review', 'Reviews')} ·{' '}
              {pluralize(totals.openComments, 'offener Kommentar', 'offene Kommentare')}
            </p>
          )}
        </div>

        <DeckSearch placement="inline" value={query} onChange={setQuery} />

        <ReviewsToolbar
          tab={tab}
          onTabChange={setTab}
          counts={countByTab(decks)}
          sort={sort}
          onSortChange={setSort}
          view={view}
          onViewChange={setView}
        />

        <section aria-label="Reviews" aria-busy={decksQuery.isPending}>
          {decksQuery.isPending ? (
            <DeckCollectionSkeleton view={view} />
          ) : decksQuery.isError ? (
            <EmptyState
              title="Reviews konnten nicht geladen werden"
              message={decksQuery.error.message}
              action={
                <Button
                  variant="secondary"
                  icon="refresh"
                  onClick={() => void decksQuery.refetch()}
                >
                  Erneut versuchen
                </Button>
              }
            />
          ) : visible.length > 0 ? (
            <DeckCollection decks={visible} view={view} isUnseen={isUnseen} onNotify={showToast} />
          ) : (
            <NoResults hasDecks={decks.length > 0} query={query} tab={tab} onAdd={goToNew} />
          )}
        </section>
      </main>

      <Toast toast={toast} />
    </div>
  );
}
