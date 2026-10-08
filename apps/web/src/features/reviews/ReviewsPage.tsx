import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Deck } from '@slider/shared';
import { AppHeader } from '@/app/AppHeader';
import { routes } from '@/app/routes';
import { pluralize } from '@/lib/format';
import { useAllDecks, useDecks } from '@/lib/queries';
import { useAccount } from '@/features/auth/useAccount';
import { deckLimitMessage, deckState, formatDeckUsage } from '@/features/workspaces/lib/plan';
import { canCreateDecks } from '@/features/workspaces/lib/roles';
import { useWorkspace } from '@/features/workspaces/useWorkspace';
import { Button } from '@/ui';
import { DeckCollection, DeckCollectionSkeleton, type DeckView } from './components/DeckCollection';
import { DeckGroups } from './components/DeckGroups';
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
  sharedWith,
  type ReviewTab,
} from './lib/deck-filters';
import { useLastVisits } from './lib/last-visits';
import { prunePinnedDecks, usePinnedDecks } from './lib/pinned-decks';

const DECK_VIEWS = ['grid', 'list'] as const satisfies readonly DeckView[];
const NO_DECKS: readonly Deck[] = [];

/**
 * G1 "Meine Reviews" – the decks of one workspace (BER-121, BER-124, BER-129). The tab
 * "Geteilt" instead lists other people's decks from all my organisations, grouped by organisation.
 */
export function Component() {
  const navigate = useNavigate();
  const { user, workspaces } = useAccount();
  const workspace = useWorkspace();
  const mayCreate = canCreateDecks(workspace.role);
  // The plan's deck limit (BER-130): the button stays visible, but off, with the reason.
  const decksFull = deckState(workspace.usage).full;
  const limitNoticeId = useId();
  const decksQuery = useDecks(workspace.id);
  const decks = decksQuery.data ?? NO_DECKS;
  const allDecksQuery = useAllDecks();
  const shared = sharedWith(allDecksQuery.data ?? NO_DECKS, user.id);
  const { isUnseen, openedAt } = useLastVisits();
  const { isPinned } = usePinnedDecks();
  const [toast, showToast] = useToast();

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<ReviewTab>('all');
  const [sort, setSort] = useStoredChoice('slider.reviews.sort', DECK_SORTS, 'opened');
  const [view, setView] = useStoredChoice('slider.reviews.view', DECK_VIEWS, 'grid');

  const totals = activeTotals(decks);
  const sharedTab = tab === 'shared';
  const listQuery = sharedTab ? allDecksQuery : decksQuery;
  const listed = sharedTab ? shared : decks;
  const visible = selectDecks(listed, { tab, query, sort, openedAt, isPinned });

  // A pinned deck deleted elsewhere would otherwise hold one of the few pin slots forever.
  const allDecks = allDecksQuery.isSuccess ? allDecksQuery.data : undefined;
  useEffect(() => {
    if (allDecks) prunePinnedDecks(new Set(allDecks.map((deck) => deck.id)));
  }, [allDecks]);
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
          <p id={limitNoticeId} className="max-w-[720px] text-[13px] leading-5 text-fg">
            {deckLimitMessage(workspace)}
          </p>
        )}

        <DeckSearch placement="inline" value={query} onChange={setQuery} />

        <ReviewsToolbar
          tab={tab}
          onTabChange={setTab}
          counts={countByTab(decks, shared)}
          sort={sort}
          onSortChange={setSort}
          view={view}
          onViewChange={setView}
        />

        <section aria-label="Reviews" aria-busy={listQuery.isPending}>
          {listQuery.isPending ? (
            <DeckCollectionSkeleton view={view} />
          ) : listQuery.isError ? (
            <EmptyState
              title="Reviews konnten nicht geladen werden"
              message={listQuery.error.message}
              action={
                <Button variant="secondary" icon="refresh" onClick={() => void listQuery.refetch()}>
                  Erneut versuchen
                </Button>
              }
            />
          ) : visible.length === 0 ? (
            <NoResults hasDecks={listed.length > 0} query={query} tab={tab} onAdd={goToNew} />
          ) : sharedTab ? (
            <DeckGroups
              decks={visible}
              workspaces={workspaces}
              view={view}
              isUnseen={isUnseen}
              onNotify={showToast}
            />
          ) : (
            <DeckCollection decks={visible} view={view} isUnseen={isUnseen} onNotify={showToast} />
          )}
        </section>
      </main>

      <Toast toast={toast} />
    </div>
  );
}
