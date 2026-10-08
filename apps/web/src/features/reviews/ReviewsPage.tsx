import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Deck } from '@slider/shared';
import { AppHeader } from '@/app/AppHeader';
import { routes } from '@/app/routes';
import { pluralize } from '@/lib/format';
import { useDecks } from '@/lib/queries';
import { deckLimitMessage, deckState, formatDeckUsage } from '@/features/workspaces/lib/plan';
import { canCreateDecks } from '@/features/workspaces/lib/roles';
import { useWorkspace } from '@/features/workspaces/useWorkspace';
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

/** G1 "Meine Reviews" – the decks of one workspace (BER-121, BER-124, BER-129). */
export function Component() {
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const mayCreate = canCreateDecks(workspace.role);
  // The plan's deck limit (BER-130): the button stays visible, but off, with the reason.
  const decksFull = deckState(workspace.usage).full;
  const limitNoticeId = useId();
  const decksQuery = useDecks(workspace.id);
  const decks = decksQuery.data ?? NO_DECKS;
  const { isUnseen } = useLastVisits();
  const [toast, showToast] = useToast();

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<ReviewTab>('all');
  const [sort, setSort] = useStoredChoice('slider.reviews.sort', DECK_SORTS, 'updated');
  const [view, setView] = useStoredChoice('slider.reviews.view', DECK_VIEWS, 'grid');

  const totals = activeTotals(decks);
  const visible = selectDecks(decks, { tab, query, sort });
  const goToNew =
    mayCreate && !decksFull ? () => void navigate(routes.newReview(workspace.id)) : undefined;

  return (
    <div className="dot-grid min-h-full">
      <title>{`Meine Reviews · ${workspace.name} · Slider`}</title>
      <AppHeader
        leading={
          mayCreate && (
            <Button
              size="sm"
              icon="add"
              aria-label="Neuer Review"
              disabled={decksFull}
              title={decksFull ? deckLimitMessage(workspace) : undefined}
              aria-describedby={decksFull ? limitNoticeId : undefined}
              onClick={goToNew}
            >
              <span className="max-sm:hidden">Neuer Review</span>
            </Button>
          )
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
              {workspace.usage.maxDecks !== null && (
                <>
                  {' · '}
                  <span className={decksFull ? 'text-warning' : undefined}>
                    {formatDeckUsage(workspace.usage)}
                  </span>
                </>
              )}
            </p>
          )}
        </div>

        {mayCreate && decksFull && (
          <p
            id={limitNoticeId}
            className="max-w-[720px] rounded-control bg-warning/10 px-3 py-2.5 text-[13px] leading-5 text-fg"
          >
            {deckLimitMessage(workspace)}
          </p>
        )}

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
