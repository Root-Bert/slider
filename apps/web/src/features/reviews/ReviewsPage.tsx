import { useEffect, useId, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import type { Deck } from '@slider/shared';
import { AppHeader } from '@/app/AppHeader';
import { routes } from '@/app/routes';
import { pluralize } from '@/lib/format';
import { useAllDecks, useDecks } from '@/lib/queries';
import { deckLimitMessage, deckState, formatDeckUsage } from '@/features/workspaces/lib/plan';
import { canCreateDecks } from '@/features/workspaces/lib/roles';
import { useWorkspace } from '@/features/workspaces/useWorkspace';
import { Button, ContextMenu, type MenuAction } from '@/ui';
import { DeckCollection, DeckCollectionSkeleton, type DeckView } from './components/DeckCollection';
import { DeckSearch } from './components/DeckSearch';
import { EmptyState } from './components/EmptyState';
import { NoResults } from './components/NoResults';
import { NotificationsButton } from './components/NotificationsButton';
import { ReviewsToolbar } from './components/ReviewsToolbar';
import { Toast } from '@/ui';
import { useDeckContextMenu } from './hooks/useDeckContextMenu';
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
import { prunePinnedDecks, usePinnedDecks } from './lib/pinned-decks';

const DECK_VIEWS = ['grid', 'list'] as const satisfies readonly DeckView[];
const NO_DECKS: readonly Deck[] = [];

/**
 * G1 "Reviews" – every deck of one workspace, whoever added it (BER-121, BER-124, BER-129).
 */
export function Component() {
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const mayCreate = canCreateDecks(workspace.role);
  // The plan's deck limit (BER-130): the button stays visible, but off, with the reason.
  const decksFull = deckState(workspace.usage).full;
  const limitNoticeId = useId();
  const decksQuery = useDecks(workspace.id);
  const decks = decksQuery.data ?? NO_DECKS;
  const allDecksQuery = useAllDecks();
  const { isUnseen, openedAt } = useLastVisits();
  const { isPinned } = usePinnedDecks();
  const [toast, showToast] = useToast();

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<ReviewTab>('all');
  const [sort, setSort] = useStoredChoice('slider.reviews.sort', DECK_SORTS, 'opened');
  const [view, setView] = useStoredChoice('slider.reviews.view', DECK_VIEWS, 'grid');

  const totals = activeTotals(decks);
  const visible = selectDecks(decks, { tab, query, sort, openedAt, isPinned });

  // A pinned deck deleted elsewhere would otherwise hold one of the few pin slots forever.
  const allDecks = allDecksQuery.isSuccess ? allDecksQuery.data : undefined;
  useEffect(() => {
    if (allDecks) prunePinnedDecks(new Set(allDecks.map((deck) => deck.id)));
  }, [allDecks]);
  const goToNew =
    mayCreate && !decksFull ? () => void navigate(routes.newReview(workspace.id)) : undefined;

  // Right click on empty space (not on a deck – its own menu has run – nor a control).
  const pageMenu = useDeckContextMenu();
  const onPageContextMenu = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    if ((event.target as Element).closest('a, button, input, textarea, select, [role="menu"]')) {
      return;
    }
    pageMenu.onContextMenu(event);
  };
  const pageActions: MenuAction[] = [
    ...(mayCreate
      ? [
          {
            label: 'Neue Review',
            icon: 'add',
            onSelect: () => void navigate(routes.newReview(workspace.id)),
            disabled: decksFull,
            title: decksFull ? deckLimitMessage(workspace) : undefined,
          } satisfies MenuAction,
        ]
      : []),
    {
      label: 'Einstellungen',
      icon: 'settings',
      // The same page as "Einstellungen" in the profile menu.
      onSelect: () => void navigate(routes.preferences()),
    },
  ];

  return (
    <div className="dot-grid min-h-full" onContextMenu={onPageContextMenu}>
      <title>{`Reviews · ${workspace.name} · Slider`}</title>
      <AppHeader
        actions={<NotificationsButton decks={decks} isUnseen={isUnseen} />}
      />

      <main className="flex flex-col gap-6 px-4 pt-2 pb-16 md:px-14">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-fg">
            Reviews
          </h1>
          {decksQuery.isSuccess && (
            <p className="text-[13px] text-fg-subtle">
              {pluralize(totals.reviews, 'Review', 'Reviews')} |{' '}
              {pluralize(totals.openComments, 'offener Kommentar', 'offene Kommentare')}
              {workspace.usage.maxDecks !== null && (
                <>
                  {' | '}
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

        <ReviewsToolbar
          search={<DeckSearch value={query} onChange={setQuery} />}
          tab={tab}
          onTabChange={setTab}
          counts={countByTab(decks)}
          sort={sort}
          onSortChange={setSort}
          view={view}
          onViewChange={setView}
          action={
            mayCreate && (
              <Button
                variant="secondary"
                size="toolbar"
                icon="add"
                aria-label="Neue Review"
                disabled={decksFull}
                title={decksFull ? deckLimitMessage(workspace) : undefined}
                aria-describedby={decksFull ? limitNoticeId : undefined}
                onClick={goToNew}
              >
                <span className="max-sm:hidden">Neue Review</span>
              </Button>
            )
          }
        />

        <section aria-label="Reviews" aria-busy={decksQuery.isPending}>
          {decksQuery.isPending ? (
            <DeckCollectionSkeleton view={view} />
          ) : decksQuery.isError ? (
            <EmptyState
              title="Reviews konnten nicht geladen werden"
              message={decksQuery.error.message}
              action={
                <Button variant="secondary" icon="refresh" onClick={() => void decksQuery.refetch()}>
                  Erneut versuchen
                </Button>
              }
            />
          ) : visible.length === 0 ? (
            <NoResults hasDecks={decks.length > 0} query={query} tab={tab} onAdd={goToNew} />
          ) : (
            <DeckCollection decks={visible} view={view} isUnseen={isUnseen} onNotify={showToast} />
          )}
        </section>
      </main>

      {pageMenu.contextAt && (
        <ContextMenu
          label="Aktionen für die Übersicht"
          actions={pageActions}
          at={pageMenu.contextAt}
          onClose={pageMenu.onContextClose}
        />
      )}
      <Toast toast={toast} />
    </div>
  );
}
