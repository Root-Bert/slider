import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { Deck, DeckFolder } from '@slider/shared';
import { AppHeader } from '@/app/AppHeader';
import { routes } from '@/app/routes';
import { pluralize } from '@/lib/format';
import {
  useAllDecks,
  useCreateFolder,
  useDecks,
  useDeleteFolder,
  useFolders,
  useRenameFolder,
} from '@/lib/queries';
import { deckLimitMessage, deckState, formatDeckUsage } from '@/features/workspaces/lib/plan';
import { canCreateDecks } from '@/features/workspaces/lib/roles';
import { useWorkspace } from '@/features/workspaces/useWorkspace';
import { useAccount } from '@/features/auth/useAccount';
import { accentColor, isLightAccent } from '@/lib/accent';
import { Button, ContextMenu, Dialog, Icon, type MenuAction } from '@/ui';
import { DeckCollection, DeckCollectionSkeleton, type DeckView } from './components/DeckCollection';
import { DeckSearch } from './components/DeckSearch';
import { EmptyState } from './components/EmptyState';
import { FolderNameDialog } from './components/FolderNameDialog';
import { FolderTiles } from './components/FolderTiles';
import { NoResults } from './components/NoResults';
import { NotificationsButton } from './components/NotificationsButton';
import { ReviewsToolbar } from './components/ReviewsToolbar';
import { SelectionBar } from './components/SelectionBar';
import { Toast } from '@/ui';
import { useBulkDeckActions } from './hooks/useBulkDeckActions';
import { useDeckContextMenu } from './hooks/useDeckContextMenu';
import { useDeckSelection } from './hooks/useDeckSelection';
import { useMarqueeSelect } from './hooks/useMarqueeSelect';
import { movedMessage, useMoveDecks } from './hooks/useMoveDecks';
import { useStoredChoice } from './hooks/useStoredChoice';
import { useToast } from '@/ui';
import {
  activeTotals,
  countByFolder,
  countByTab,
  DECK_SORTS,
  inFolder,
  type FolderScope,
  selectDecks,
  type ReviewTab,
} from './lib/deck-filters';
import { useLastVisits } from './lib/last-visits';
import { prunePinnedDecks, usePinnedDecks } from './lib/pinned-decks';

const DECK_VIEWS = ['grid', 'list'] as const satisfies readonly DeckView[];
const NO_DECKS: readonly Deck[] = [];
const NO_FOLDERS: readonly DeckFolder[] = [];
/** The open folder lives in the URL, so back/forward and links work. */
const FOLDER_PARAM = 'ordner';

type FolderDialog = { mode: 'create' } | { mode: 'rename'; folder: DeckFolder } | null;

/**
 * G1 "Reviews" – every deck of one workspace, whoever added it (BER-121, BER-124, BER-129).
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
  const allDecksQuery = useAllDecks();
  const { isUnseen, openedAt } = useLastVisits();
  const { isPinned } = usePinnedDecks();
  const [toast, showToast] = useToast();
  const foldersQuery = useFolders(workspace.id);
  const folders = foldersQuery.data ?? NO_FOLDERS;
  const createFolder = useCreateFolder(workspace.id);
  const renameFolder = useRenameFolder(workspace.id);
  const deleteFolder = useDeleteFolder(workspace.id);
  const moveDecks = useMoveDecks();
  const [folderDialog, setFolderDialog] = useState<FolderDialog>(null);
  const [deletingFolder, setDeletingFolder] = useState<DeckFolder | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const folderId = searchParams.get(FOLDER_PARAM);
  const openFolder = folderId ? folders.find((folder) => folder.id === folderId) : undefined;
  const openFolderById = (id: string | null) =>
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      if (id) next.set(FOLDER_PARAM, id);
      else next.delete(FOLDER_PARAM);
      return next;
    });

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<ReviewTab>('all');
  const [sort, setSort] = useStoredChoice('slider.reviews.sort', DECK_SORTS, 'opened');
  const [view, setView] = useStoredChoice('slider.reviews.view', DECK_VIEWS, 'grid');

  // A folder deleted elsewhere (or a stale link): back to the top level.
  useEffect(() => {
    if (folderId && foldersQuery.isSuccess && !openFolder) openFolderById(null);
  });
  const folder: FolderScope = openFolder ? openFolder.id : query.trim() ? '*' : null;
  const atTop = folder === null;

  const totals = activeTotals(decks);
  const visible = selectDecks(decks, { tab, query, sort, folder, openedAt, isPinned });
  const inScope = decks.filter((deck) => inFolder(deck, folder));

  // Multi-select: ⌘/Shift-click, ⌘A or a selection box dragged over empty space.
  const selection = useDeckSelection(visible.map((deck) => deck.id));
  const selectedDecks = visible.filter((deck) => selection.selected.has(deck.id));
  const bulk = useBulkDeckActions(selectedDecks, { onNotify: showToast, onDone: selection.clear });
  const pageRef = useRef<HTMLDivElement>(null);
  const marquee = useMarqueeSelect(pageRef, selection.marquee);
  const [selectionMenuAt, setSelectionMenuAt] = useState<{ x: number; y: number } | null>(null);

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
            label: 'Neuer Ordner',
            icon: 'folder',
            onSelect: () => setFolderDialog({ mode: 'create' }),
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
      className="dot-grid relative min-h-full"
      // Selection in the viewer's own reviewer colour, like their comments (BER-99).
      style={
        {
          '--selection': accentColor(user.color),
          '--on-selection': isLightAccent(user.color) ? 'black' : 'white',
        } as CSSProperties
      }
      onContextMenu={onPageContextMenu}
      onMouseDown={marquee.onMouseDown}
    >
      <title>{`Reviews · ${workspace.name} · Slider`}</title>
      <AppHeader actions={<NotificationsButton decks={decks} isUnseen={isUnseen} />} />

      <main className="flex flex-col gap-6 px-4 pt-2 pb-16 md:px-14">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {openFolder ? (
            <h1 className="flex min-w-0 items-center gap-1.5 text-[28px] leading-tight font-semibold tracking-tight text-fg">
              <button
                type="button"
                onClick={() => openFolderById(null)}
                className="text-fg-subtle hover:text-fg"
              >
                Reviews
              </button>
              <Icon name="chevronRight" size={24} className="shrink-0 text-fg-subtle" />
              <span className="truncate">{openFolder.name}</span>
            </h1>
          ) : (
            <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-fg">
              Reviews
            </h1>
          )}
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
            counts={countByTab(inScope)}
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
        )}

        {atTop && decksQuery.isSuccess && (
          <FolderTiles
            folders={folders}
            counts={folderCounts}
            onOpen={openFolderById}
            manage={
              mayCreate
                ? {
                    onRename: (each) => setFolderDialog({ mode: 'rename', folder: each }),
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
          ) : visible.length === 0 && openFolder && !query.trim() ? (
            <EmptyState
              title="Der Ordner ist leer"
              message={
                mayCreate
                  ? 'Ziehe Reviews in der Übersicht auf den Ordner oder nutze „Verschieben …“ im Menü einer Review.'
                  : 'Hier wurden noch keine Reviews einsortiert.'
              }
            />
          ) : visible.length === 0 &&
            atTop &&
            folders.length > 0 &&
            decks.length > 0 ? null : visible.length === 0 ? (
            <NoResults hasDecks={decks.length > 0} query={query} tab={tab} onAdd={goToNew} />
          ) : (
            <DeckCollection
              decks={visible}
              view={view}
              isUnseen={isUnseen}
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
      {folderDialog && (
        <FolderNameDialog
          title={folderDialog.mode === 'create' ? 'Neuer Ordner' : 'Ordner umbenennen'}
          initialName={folderDialog.mode === 'rename' ? folderDialog.folder.name : ''}
          submitLabel={folderDialog.mode === 'create' ? 'Anlegen' : 'Umbenennen'}
          pending={createFolder.isPending || renameFolder.isPending}
          error={(folderDialog.mode === 'create' ? createFolder : renameFolder).error?.message}
          onClose={() => setFolderDialog(null)}
          onSubmit={(name) =>
            folderDialog.mode === 'create'
              ? createFolder.mutate(name, { onSuccess: () => setFolderDialog(null) })
              : renameFolder.mutate(
                  { folderId: folderDialog.folder.id, name },
                  { onSuccess: () => setFolderDialog(null) },
                )
          }
        />
      )}
      {deletingFolder && (
        <Dialog
          open
          onClose={() => setDeletingFolder(null)}
          title={`Ordner „${deletingFolder.name}“ löschen?`}
          description="Die Reviews darin bleiben erhalten und stehen danach wieder direkt in der Übersicht."
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeletingFolder(null)}>
                Abbrechen
              </Button>
              <Button
                variant="danger"
                disabled={deleteFolder.isPending}
                onClick={() =>
                  deleteFolder.mutate(deletingFolder.id, {
                    onSuccess: () => {
                      showToast(`Ordner „${deletingFolder.name}“ gelöscht`);
                      setDeletingFolder(null);
                    },
                    onError: (error) => showToast(error.message, 'danger'),
                  })
                }
              >
                Ordner löschen
              </Button>
            </>
          }
        />
      )}
      {marquee.box && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-40 rounded-[3px] border border-(--selection) bg-(--selection)/15"
          style={marquee.box}
        />
      )}
      <Toast toast={toast} />
    </div>
  );
}
