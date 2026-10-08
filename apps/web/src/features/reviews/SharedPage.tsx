import { useState } from 'react';
import type { Deck } from '@slider/shared';
import { AppHeader } from '@/app/AppHeader';
import { pluralize } from '@/lib/format';
import { useAllDecks } from '@/lib/queries';
import { useAccount } from '@/features/auth/useAccount';
import { WorkspaceMark } from '@/features/workspaces/components/WorkspaceMark';
import { ROLE_LABELS } from '@/features/workspaces/lib/roles';
import { Button, Toast, useToast } from '@/ui';
import { DeckCollection, DeckCollectionSkeleton, type DeckView } from './components/DeckCollection';
import { DeckSearch } from './components/DeckSearch';
import { EmptyState } from './components/EmptyState';
import { NotificationsButton } from './components/NotificationsButton';
import { ReviewsToolbar } from './components/ReviewsToolbar';
import { SharedEmpty } from './components/SharedEmpty';
import { useStoredChoice } from './hooks/useStoredChoice';
import {
  activeTotals,
  countByTab,
  DECK_SORTS,
  selectDecks,
  sharedWith,
  type ReviewTab,
} from './lib/deck-filters';
import { useLastVisits } from './lib/last-visits';

const DECK_VIEWS = ['grid', 'list'] as const satisfies readonly DeckView[];
const NO_DECKS: readonly Deck[] = [];

/** "Mit mir geteilt": decks others added to any of my organisations, grouped by organisation. */
export function Component() {
  const { user, workspaces } = useAccount();
  const decksQuery = useAllDecks();
  const decks = sharedWith(decksQuery.data ?? NO_DECKS, user.id);
  const { isUnseen } = useLastVisits();
  const [toast, showToast] = useToast();

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<ReviewTab>('all');
  const [sort, setSort] = useStoredChoice('slider.reviews.sort', DECK_SORTS, 'updated');
  const [view, setView] = useStoredChoice('slider.reviews.view', DECK_VIEWS, 'grid');

  const totals = activeTotals(decks);
  const visible = selectDecks(decks, { tab, query, sort });
  // Organisations in switcher order; ones without a visible deck are left out.
  const groups = workspaces
    .map((workspace) => ({
      workspace,
      decks: visible.filter((deck) => deck.workspaceId === workspace.id),
    }))
    .filter((group) => group.decks.length > 0);

  return (
    <div className="dot-grid min-h-full">
      <title>Mit mir geteilt · Slider</title>
      <AppHeader
        center={<DeckSearch placement="header" value={query} onChange={setQuery} />}
        actions={<NotificationsButton decks={decks} isUnseen={isUnseen} />}
      />

      <main className="flex flex-col gap-6 px-4 pt-2 pb-16 md:px-14">
        <div className="flex flex-col gap-1">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-fg">
            Mit mir geteilt
          </h1>
          {decksQuery.isSuccess && (
            <p className="text-[13px] text-fg-subtle">
              {pluralize(totals.reviews, 'Review', 'Reviews')} ·{' '}
              {pluralize(totals.openComments, 'offener Kommentar', 'offene Kommentare')} · aus{' '}
              {pluralize(workspaces.length, 'Organisation', 'Organisationen')}
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

        <div aria-busy={decksQuery.isPending} className="flex flex-col gap-10">
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
          ) : groups.length > 0 ? (
            groups.map(({ workspace, decks: groupDecks }) => (
              <section
                key={workspace.id}
                aria-label={workspace.name}
                className="flex flex-col gap-4"
              >
                <h2 className="flex items-center gap-2 text-[15px] font-medium text-fg">
                  <WorkspaceMark name={workspace.name} />
                  <span className="truncate">{workspace.name}</span>
                  <span className="text-xs font-normal text-fg-subtle">
                    {ROLE_LABELS[workspace.role]}
                  </span>
                </h2>
                <DeckCollection
                  decks={groupDecks}
                  view={view}
                  isUnseen={isUnseen}
                  onNotify={showToast}
                />
              </section>
            ))
          ) : (
            <SharedEmpty hasDecks={decks.length > 0} query={query} />
          )}
        </div>
      </main>

      <Toast toast={toast} />
    </div>
  );
}
