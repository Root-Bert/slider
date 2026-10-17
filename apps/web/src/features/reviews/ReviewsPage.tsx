import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { useNavigate } from 'react-router';
import type { Deck, DeckFolder } from '@slider/shared';
import { routes } from '@/lib/routes';
import { AppHeader } from '@/shell/AppHeader';
import { pluralize } from '@/lib/format';
import { useDecks, useFolders } from '@/lib/api';
import { useAccount } from '@/features/auth';
import {
  canCreateDecks,
  deckLimitMessage,
  deckState,
  formatDeckUsage,
  useWorkspace,
} from '@/features/workspaces';
import { accentColor, isLightAccent } from '@/lib/accent';
import {
  Button,
  ContextMenu,
  Icon,
  Menu,
  PageHeader,
  TextLink,
  Toast,
  useToast,
  type MenuAction,
} from '@/ui';
import { DeleteFolderDialog } from './components/DeleteFolderDialog';
import { DeckCollection, DeckCollectionSkeleton, type DeckView } from './components/DeckCollection';
import { DeckSearch } from './components/DeckSearch';
import { EmptyState } from './components/EmptyState';
import { FolderNameDialog } from './components/FolderNameDialog';
import { FolderTiles } from './components/FolderTiles';
import { NoResults } from './components/NoResults';
import { ReviewsToolbar } from './components/ReviewsToolbar';
import { SelectionBar } from './components/SelectionBar';
import { useBulkDeckActions } from './hooks/useBulkDeckActions';
import { useDeckContextMenu } from './hooks/useDeckContextMenu';
import { useDeckSelection } from './hooks/useDeckSelection';
import { useFolderDialog } from './hooks/useFolderDialog';
import { useMarqueeSelect } from './hooks/useMarqueeSelect';
import { movedMessage, useMoveDecks } from './hooks/useMoveDecks';
import { useOpenFolder } from './hooks/useOpenFolder';
import { useStoredChoice } from './hooks/useStoredChoice';
import {
  activeTotals,
  countByFolder,
  countByTab,
  isEmptyFolder,
  DECK_SORTS,
  inFolder,
  onlyFolderTiles,
  type FolderScope,
  selectDecks,
  type ReviewTab,
} from './lib/deck-filters';
import { useLastVisits } from './hooks/useLastVisits';
import { usePinnedDecks } from './hooks/usePinnedDecks';
import { pinnableDeckIds, prunePinnedDecks } from './lib/pinned-decks';

const DECK_VIEWS = ['grid', 'list'] as const satisfies readonly DeckView[];
const NO_DECKS: readonly Deck[] = [];
const NO_FOLDERS: readonly DeckFolder[] = [];

/**
 * G1 "Reviews" – every deck of one workspace, whoever added it (BER-121, BER-129).
 */
export function Component() {
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const { user } = useAccount();
  const mayCreate = canCreateDecks(workspace.role);
  // The plan's deck limit (BER-130): the button stays visible, but off, with the reason.
  const decksFull = deckState(workspace.usage).full;
  const limitNoticeId = useId();
  const decksQuery = useDecks(workspace.id);
  const decks = decksQuery.data ?? NO_DECKS;
  const { openedAt } = useLastVisits();
  const { isPinned } = usePinnedDecks(workspace.id);
  const [toast, showToast] = useToast();
  const foldersQuery = useFolders(workspace.id);
  const folders = foldersQuery.data ?? NO_FOLDERS;
  const folderDialog = useFolderDialog(workspace.id);
  const moveDecks = useMoveDecks();
  const [deletingFolder, setDeletingFolder] = useState<DeckFolder | null>(null);
  const { openFolder, openFolderById } = useOpenFolder(folders, foldersQuery.isSuccess);

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<ReviewTab>('all');
  const [sort, setSort] = useStoredChoice('slider.reviews.sort', DECK_SORTS, 'opened');
  const [view, setView] = useStoredChoice('slider.reviews.view', DECK_VIEWS, 'grid');

  const folder: FolderScope = openFolder ? openFolder.id : query.trim() ? '*' : null;
  const atTop = folder === null;

  const totals = activeTotals(decks);
  const visible = selectDecks(decks, { tab, query, sort, folder, openedAt, isPinned });
  const inScope = decks.filter((deck) => inFolder(deck, folder));

  // Multi-select: ⌘/Shift-click, ⌘A or a selection box dragged over empty space.
  const selection = useDeckSelection(visible.map((deck) => deck.id));
  const selectedDecks = visible.filter((deck) => selection.selected.has(deck.id));
  const bulk = useBulkDeckActions(selectedDecks, {
    workspaceId: workspace.id,
    onNotify: showToast,
    onDone: selection.clear,
  });
  const pageRef = useRef<HTMLDivElement>(null);
  const marquee = useMarqueeSelect(pageRef, selection.marquee);
  const [selectionMenuAt, setSelectionMenuAt] = useState<{ x: number; y: number } | null>(null);

  // A pinned deck deleted, moved away or archived (here or elsewhere) would otherwise hold one
  // of the few pin slots of this workspace while no pin shows on "Alle".
  const loadedDecks = decksQuery.isSuccess ? decksQuery.data : undefined;
  useEffect(() => {
    if (loadedDecks)
      prunePinnedDecks(
        { userId: user.id, workspaceId: workspace.id },
        pinnableDeckIds(loadedDecks),
      );
  }, [loadedDecks, user.id, workspace.id]);
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
            label: 'Neuer Ordner',
            icon: 'folder',
            onSelect: folderDialog.openCreate,
          } satisfies MenuAction,
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

  const dropDecks = (target: string, deckIds: string[]) => {
    const name = folders.find((each) => each.id === target)?.name ?? null;
    moveDecks.mutate(
      { deckIds, folderId: target },
      {
        onSuccess: (result) => {
          const message = movedMessage(result, name);
          showToast(message.text, message.tone);
          selection.clear();
        },
        onError: (error) => showToast(error.message, 'danger'),
      },
    );
  };
  const folderCounts = countByFolder(decks);

  return (
    <div
      ref={pageRef}
      // The cards' thumbnail glow reaches past the page gutter: clipped, so phones don't scroll
      // sideways (clip, not hidden – no scroll container, sticky bars keep working).
      className="dot-grid relative min-h-full overflow-x-clip"
      // Selection in the viewer's own reviewer colour, like their comments (BER-99).
      style={
        {
          '--selection': accentColor(user.color),
          '--on-selection': isLightAccent(user.color)
            ? 'var(--color-on-primary)'
            : 'var(--color-primary-hover)',
        } as CSSProperties
      }
      onContextMenu={onPageContextMenu}
      onMouseDown={marquee.onMouseDown}
    >
      <title>{`Reviews · ${workspace.name} · Slider`}</title>
      <AppHeader />

      <main className="flex flex-col gap-6 px-4 pt-2 pb-16 md:px-14">
        <PageHeader
          layout="inline"
          subtitleSize="body"
          titleRow={Boolean(openFolder)}
          title={
            openFolder ? (
              <>
                <TextLink onClick={() => openFolderById(null)}>Reviews</TextLink>
                <Icon name="chevronRight" size={24} className="shrink-0 text-fg-subtle" />
                <span className="truncate">{openFolder.name}</span>
              </>
            ) : (
              'Reviews'
            )
          }
          subtitle={
            decksQuery.isSuccess && (
              <>
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
              </>
            )
          }
        />

        {mayCreate && decksFull && (
          <p id={limitNoticeId} className="max-w-[720px] text-body leading-5 text-fg">
            {deckLimitMessage(workspace)}
          </p>
        )}

        {selectedDecks.length > 0 ? (
          <SelectionBar
            count={selectedDecks.length}
            actions={bulk.actions}
            onClear={selection.clear}
          />
        ) : (
          <ReviewsToolbar
            search={<DeckSearch value={query} onChange={setQuery} />}
            tab={tab}
            onTabChange={setTab}
            counts={countByTab(decks, folder)}
            sort={sort}
            onSortChange={setSort}
            view={view}
            onViewChange={setView}
            action={
              mayCreate && (
                <>
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
                  {/* The page's right-click actions ("Neuer Ordner" …) – also on touch and keyboard. */}
                  <Menu
                    label="Weitere Aktionen"
                    actions={pageActions}
                    triggerSize="md"
                    triggerVariant="glass"
                  />
                </>
              )
            }
          />
        )}

        {atTop && decksQuery.isSuccess && (
          <FolderTiles
            folders={folders}
            counts={folderCounts}
            onOpen={(id) => openFolderById(id)}
            manage={
              mayCreate
                ? {
                    onRename: folderDialog.openRename,
                    onDelete: setDeletingFolder,
                    onDropDecks: dropDecks,
                  }
                : undefined
            }
          />
        )}

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
          ) : visible.length === 0 &&
            isEmptyFolder({
              folderOpen: Boolean(openFolder),
              query,
              decksInFolder: inScope.length,
            }) ? (
            <EmptyState
              title="Der Ordner ist leer"
              message={
                mayCreate
                  ? 'Ziehe Reviews in der Übersicht auf den Ordner oder nutze „Verschieben …“ im Menü einer Review.'
                  : 'Hier wurden noch keine Reviews einsortiert.'
              }
            />
          ) : visible.length === 0 &&
            onlyFolderTiles({
              tab,
              atTop,
              folderCount: folders.length,
              deckCount: decks.length,
            }) ? null : visible.length === 0 ? (
            <NoResults hasDecks={decks.length > 0} query={query} tab={tab} onAdd={goToNew} />
          ) : (
            <DeckCollection
              decks={visible}
              view={view}
              onNotify={showToast}
              selected={selection.selected}
              onModifiedClick={selection.onModifiedClick}
              onSelectionMenu={setSelectionMenuAt}
            />
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
      {selectionMenuAt && selectedDecks.length > 0 && (
        <ContextMenu
          label={`Aktionen für ${selectedDecks.length} ausgewählte Reviews`}
          actions={bulk.actions}
          at={selectionMenuAt}
          onClose={() => setSelectionMenuAt(null)}
        />
      )}
      {bulk.dialog}
      {folderDialog.state && (
        <FolderNameDialog
          title={folderDialog.state.mode === 'create' ? 'Neuer Ordner' : 'Ordner umbenennen'}
          initialName={folderDialog.state.mode === 'rename' ? folderDialog.state.folder.name : ''}
          submitLabel={folderDialog.state.mode === 'create' ? 'Anlegen' : 'Umbenennen'}
          pending={folderDialog.pending}
          error={folderDialog.error}
          onClose={folderDialog.close}
          onSubmit={folderDialog.submit}
        />
      )}
      {deletingFolder && (
        <DeleteFolderDialog
          workspaceId={workspace.id}
          folder={deletingFolder}
          onClose={() => setDeletingFolder(null)}
          onDeleted={() => {
            showToast(`Ordner „${deletingFolder.name}“ gelöscht`);
            setDeletingFolder(null);
          }}
        />
      )}
      {marquee.box && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-(--z-panel) rounded-mark border border-(--selection) bg-(--selection)/15"
          style={marquee.box}
        />
      )}
      <Toast toast={toast} />
    </div>
  );
}
