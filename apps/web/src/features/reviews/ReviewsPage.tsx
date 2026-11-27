import {
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { useNavigate } from 'react-router';
import type { Deck } from '@slider/shared';
import { routes } from '@/lib/routes';
import { desktopBridge } from '@/lib/desktop-bridge';
import { keepPickedFile, pickPresentations, webFilesSupported } from '@/lib/web-files';
import { isContentQuery, useDeckSearch, useDecks, useTrashedDecks } from '@/lib/api';
import { useCollectionSelection } from '@/lib/collection-selection';
import { isOnControl } from '@/lib/marquee-select';
import { isTextTarget } from '@/lib/dom';
import { useAccount } from '@/features/auth';
import { usePageCommands } from '@/features/commands';
import { UploadToast, useDeckUpload } from '@/features/onboarding';
import { HomeChat } from './components/HomeChat';
import {
  canCreateDecks,
  deckState,
  formatDeckUsage,
  newReviewBlockedMessage,
  useWorkspace,
  ViewSearch,
  WorkspaceViews,
} from '@/features/workspaces';
import { selectionStyle } from '@/lib/accent';
import { useViewChoice } from '@/lib/view-choice';
import {
  Button,
  cn,
  ContextMenu,
  PageHeader,
  SelectionBar,
  Toast,
  useDebounced,
  useFileDrop,
  useToast,
  type MenuAction,
} from '@/ui';
import { DeckCollection, DeckCollectionSkeleton, type DeckView } from './components/DeckCollection';
import { EmptyState } from './components/EmptyState';
import { TrashedDecks } from './components/TrashedDecks';
import { NoResults } from './components/NoResults';
import { ReviewsToolbar } from './components/ReviewsToolbar';
import { useBulkDeckActions } from './hooks/useBulkDeckActions';
import { useDeckContextMenu } from './hooks/useDeckContextMenu';
import { useStoredChoice } from './hooks/useStoredChoice';
import { countByTab, DECK_SORTS, deckOrder, selectDecks, type ReviewTab } from './lib/deck-filters';
import { useLastVisits } from './hooks/useLastVisits';
import { usePinnedDecks } from './hooks/usePinnedDecks';
import { pinnableDeckIds, prunePinnedDecks } from './lib/pinned-decks';

const DECK_VIEWS = ['grid', 'list'] as const satisfies readonly DeckView[];
const NO_DECKS: readonly Deck[] = [];

/**
 * G1 "Projekte" – every deck of one workspace, whoever added it (BER-121, BER-129).
 */
export function Component() {
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const { user } = useAccount();
  const mayCreate = canCreateDecks(workspace.role);
  // The plan's deck limit (BER-130) or over the plan (BER-155): the button stays visible, but
  // off, with the reason.
  const decksFull = deckState(workspace.usage).full;
  const blocked = newReviewBlockedMessage(workspace);
  const limitNoticeId = useId();
  const decksQuery = useDecks(workspace.id);
  const trashed = useTrashedDecks(workspace.id);
  const decks = decksQuery.data ?? NO_DECKS;
  const { openedAt } = useLastVisits();
  const { isPinned } = usePinnedDecks(workspace.id);
  const [toast, showToast] = useToast();

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<ReviewTab>('all');
  const [sort, setSort] = useStoredChoice('slider.reviews.sort', DECK_SORTS, 'opened');
  const [view, setView] = useViewChoice('slider.reviews.view', DECK_VIEWS, 'grid');

  // Every presentation one may see, from wherever it lies: folders are Cloud's, not this
  // page's (`services/deck-places` in the API).
  const folder = '*';

  // Names are filtered here; slides and comments only when switched on, searched on the server
  // once typing pauses (BER-175). Off again on every visit.
  const [searchContent, setSearchContent] = useState(false);
  const settledQuery = useDebounced(query, 250);
  const contentSearch = useDeckSearch(workspace.id, searchContent ? settledQuery : '');
  const searchingContent = searchContent && isContentQuery(query);
  const searchHits = useMemo(
    () =>
      searchingContent && isContentQuery(settledQuery) && contentSearch.data
        ? new Map(contentSearch.data.map((result) => [result.deckId, result]))
        : undefined,
    [searchingContent, settledQuery, contentSearch.data],
  );
  const contentMatches = useMemo(
    () => (searchHits ? new Set(searchHits.keys()) : undefined),
    [searchHits],
  );
  // Nothing found by title yet, but the text is still being searched: no "Keine Treffer" yet.
  const awaitingContent = searchingContent && (settledQuery !== query || contentSearch.isFetching);

  const visible = selectDecks(decks, {
    tab,
    query,
    sort,
    folder,
    openedAt,
    isPinned,
    contentMatches,
  });

  // Multi-select: ⌘/Shift-click, ⌘A or a selection box dragged over empty space.
  const pageRef = useRef<HTMLDivElement>(null);
  const selection = useCollectionSelection(
    pageRef,
    visible.map((deck) => deck.id),
  );
  const selectedDecks = visible.filter((deck) => selection.selected.has(deck.id));
  const bulk = useBulkDeckActions(selectedDecks, {
    workspaceId: workspace.id,
    onNotify: showToast,
    onDone: selection.clear,
  });
  const [selectionMenuAt, setSelectionMenuAt] = useState<{ x: number; y: number } | null>(null);
  // The selection bar goes with the selection, and the focus on one of its buttons with it:
  // the page takes it, so the keys go on working from where one was.
  const picking = selectedDecks.length > 0;
  const wasPicking = useRef(false);
  useEffect(() => {
    const before = wasPicking.current;
    wasPicking.current = picking;
    if (picking || !before) return;
    const timer = setTimeout(() => {
      if (document.activeElement === document.body) pageRef.current?.focus();
      // After a dialog that closes with the action has handed the focus back (to the button gone).
    }, 50);
    return () => clearTimeout(timer);
  }, [picking]);
  // ⌫ and Entf ask to delete what is picked, as in Cloud: only when all of it is one's to delete.
  const removePicked = bulk.remove;
  const onDeleteKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    if (event.defaultPrevented || isTextTarget(event.target) || !removePicked) return;
    if (document.querySelector('dialog[open], [role="menu"]')) return;
    event.preventDefault();
    removePicked();
  });
  useEffect(() => {
    window.addEventListener('keydown', onDeleteKey);
    return () => window.removeEventListener('keydown', onDeleteKey);
  }, []);

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
    mayCreate && !blocked ? () => void navigate(routes.newReview(workspace.id)) : undefined;

  // Files dragged from the desktop onto the page become new presentations, as „Neue Präsentation“
  // makes them: one opens, several go up one after another and the page stays.
  const droppedCount = useRef(0);
  // „Öffnen …“ in the browser: the file going up now, with its handle – an ODP stays that file.
  const picked = useRef<Awaited<ReturnType<typeof pickPresentations>>[number] | null>(null);
  const uploaded = useRef(0);
  const upload = useDeckUpload(workspace.id, (deck) => {
    uploaded.current += 1;
    if (picked.current) void keepPickedFile(deck.id, picked.current.handle, picked.current.file);
    if (droppedCount.current === 1) void navigate(routes.deck(deck.id));
  });
  const uploadFailed = upload.state.status === 'error' ? upload.state.message : null;
  useEffect(() => {
    if (uploadFailed) showToast(uploadFailed, 'danger');
  }, [uploadFailed, showToast]);
  const dropFiles = async (files: File[]) => {
    if (files.length === 0) return;
    if (upload.state.status === 'uploading') return showToast('Der Upload läuft noch.');
    if (!mayCreate || blocked) {
      showToast(blocked ?? 'Du kannst hier keine Präsentationen anlegen.', 'danger');
      return;
    }
    droppedCount.current = files.length;
    uploaded.current = 0;
    for (const file of files) await upload.run(file);
    // One that failed has said so itself.
    if (files.length > 1 && uploaded.current === files.length)
      showToast(`${files.length} Präsentationen hochgeladen`);
  };
  const openPicked = async () => {
    const files = await pickPresentations().catch((error: unknown) => {
      if (error instanceof Error) showToast(error.message, 'danger');
      return [];
    });
    if (files.length === 0 || upload.state.status === 'uploading') return;
    droppedCount.current = files.length;
    uploaded.current = 0;
    for (const each of files) {
      picked.current = each;
      await upload.run(each.file);
    }
    picked.current = null;
    if (files.length > 1 && uploaded.current === files.length)
      showToast(`${files.length} Präsentationen hochgeladen`);
  };
  const { dragOver, handlers: dropHandlers } = useFileDrop((files) => void dropFiles(files));

  // Right click on empty space (not on a deck – its own menu has run – nor a control).
  const pageMenu = useDeckContextMenu();
  const onPageContextMenu = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    if (isOnControl(event.target)) return;
    pageMenu.onContextMenu(event);
  };
  const bridge = desktopBridge();
  // What is made or opened here – the page's menu and the command panel (⌘K) alike.
  const makeActions: MenuAction[] = [
    ...(mayCreate
      ? [
          {
            label: 'Neue Präsentation',
            icon: 'add',
            onSelect: () => void navigate(routes.newReview(workspace.id)),
            disabled: Boolean(blocked),
            title: blocked ?? undefined,
          } satisfies MenuAction,
          // A file on this computer opens as a presentation – an ODP stays that file (BER-201):
          // in the desktop app through its bridge, in a browser that can through its own access.
          ...(bridge || webFilesSupported()
            ? [
                {
                  label: 'Öffnen …',
                  icon: 'description',
                  onSelect: () => void (bridge ? bridge.openFiles() : openPicked()),
                  disabled: !bridge && Boolean(blocked),
                  title: (!bridge && blocked) || undefined,
                } satisfies MenuAction,
              ]
            : []),
        ]
      : []),
  ];
  usePageCommands({ group: 'Präsentationen', actions: makeActions, workspaceId: workspace.id });
  const pageActions: MenuAction[] = [
    ...makeActions,
    {
      label: 'Einstellungen',
      icon: 'settings',
      // The same page as "Einstellungen" in the profile menu.
      onSelect: () => void navigate(routes.preferences()),
    },
  ];

  return (
    <div
      ref={pageRef}
      tabIndex={-1}
      // The cards' thumbnail glow reaches past the page gutter: clipped, so phones don't scroll
      // sideways (clip, not hidden – no scroll container, sticky bars keep working).
      className="dot-grid relative min-h-full overflow-x-clip outline-none"
      // Selection in the viewer's own reviewer colour, like their comments (BER-99).
      style={selectionStyle(user.color)}
      onContextMenu={onPageContextMenu}
      onMouseDown={selection.onMouseDown}
      {...dropHandlers}
    >
      <title>{`Präsentationen | ${workspace.name} | Slider`}</title>

      {/* The chat's panel (`HomeChat`) stands beside the list, not over it – as the header; at
        once, not eased (tiles drawn anew each frame flicker). */}
      <main className="@container flex flex-col gap-6 px-4 pt-2 pb-16 md:px-8 md:[body:has([data-cloud-panel])_&]:mr-[400px]">
        <PageHeader
          layout="inline"
          subtitleSize="body"
          titleRow
          title={<WorkspaceViews workspaceId={workspace.id} current="reviews" />}
          subtitle={
            // Only the plan's deck limit, when there is one.
            decksQuery.data !== undefined &&
            workspace.usage.maxDecks !== null && (
              <span className={decksFull ? 'text-warning' : undefined}>
                {formatDeckUsage(workspace.usage)}
              </span>
            )
          }
        />

        {mayCreate && blocked && (
          <p id={limitNoticeId} className="max-w-[720px] text-body leading-5 text-fg">
            {blocked}
          </p>
        )}

        {selectedDecks.length > 0 ? (
          <SelectionBar
            label="Ausgewählte Präsentationen"
            count={selectedDecks.length}
            actions={bulk.actions}
            onClear={selection.clear}
            // Sticks to the top while scrolling: the actions stay reachable in a long selection.
            className="sticky top-3 z-(--z-chrome) flex-wrap"
          />
        ) : (
          <ReviewsToolbar
            search={
              <ViewSearch
                label="Präsentationen durchsuchen"
                contentLabel="Auch Folien und Kommentare durchsuchen"
                contentPlaceholder="Namen, Folien, Kommentare…"
                value={query}
                onChange={setQuery}
                content={searchContent}
                onContentChange={setSearchContent}
                searching={searchingContent && contentSearch.isFetching}
              />
            }
            tab={tab}
            onTabChange={setTab}
            counts={{ ...countByTab(decks, folder), trash: trashed.data?.length ?? 0 }}
            sort={sort}
            onSortChange={setSort}
            view={view}
            onViewChange={setView}
            action={
              mayCreate
                ? (iconOnly) => (
                    <Button
                      variant="secondary"
                      size="toolbar"
                      icon="add"
                      aria-label="Neue Präsentation"
                      disabled={Boolean(blocked)}
                      title={blocked ?? (iconOnly ? 'Neue Präsentation' : undefined)}
                      aria-describedby={blocked ? limitNoticeId : undefined}
                      onClick={goToNew}
                      className={iconOnly ? 'w-10 px-0' : undefined}
                    >
                      {!iconOnly && 'Neue Präsentation'}
                    </Button>
                  )
                : undefined
            }
          />
        )}

        <section aria-label="Präsentationen" aria-busy={decksQuery.isPending}>
          {tab === 'trash' && trashed.isPending ? (
            <DeckCollectionSkeleton view="list" count={3} />
          ) : tab === 'trash' && trashed.isLoadingError ? (
            <EmptyState
              title="Papierkorb konnte nicht geladen werden"
              message={trashed.error.message}
              action={
                <Button variant="secondary" icon="refresh" onClick={() => void trashed.refetch()}>
                  Erneut versuchen
                </Button>
              }
            />
          ) : tab === 'trash' ? (
            <TrashedDecks
              workspaceId={workspace.id}
              onNotify={showToast}
              query={query}
              order={deckOrder(sort, openedAt)}
              empty={<NoResults hasDecks query={query} tab="trash" onAdd={goToNew} />}
            />
          ) : decksQuery.isPending ? (
            <DeckCollectionSkeleton view={view} />
          ) : decksQuery.isLoadingError ? (
            // Only without any list: a failed background refetch (a deploy, a blip) keeps the
            // loaded decks on screen instead of swapping them for the error.
            <EmptyState
              title="Präsentationen konnten nicht geladen werden"
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
          ) : visible.length === 0 && awaitingContent ? (
            <DeckCollectionSkeleton view={view} count={3} />
          ) : visible.length === 0 && searchingContent && contentSearch.isError ? (
            // Not „Keine Treffer“: nobody looked through the slides and comments.
            <EmptyState
              title="Die Suche hat nicht geklappt"
              message={contentSearch.error.message}
              action={
                <Button
                  variant="secondary"
                  icon="refresh"
                  onClick={() => void contentSearch.refetch()}
                >
                  Erneut versuchen
                </Button>
              }
            />
          ) : visible.length === 0 ? (
            <NoResults hasDecks={decks.length > 0} query={query} tab={tab} onAdd={goToNew} />
          ) : (
            <DeckCollection
              decks={visible}
              view={view}
              onNotify={showToast}
              selected={selection.selected}
              onModifiedClick={selection.onModifiedClick}
              onSelectionMenu={setSelectionMenuAt}
              searchHits={searchHits}
            />
          )}
        </section>
      </main>

      {/* Over the whole page while files are dragged over it, as on „Bibliothek“. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none fixed inset-3 z-(--z-panel) flex items-center justify-center rounded-panel border-2 border-dashed border-fg transition-opacity duration-200',
          dragOver && mayCreate && !blocked ? 'opacity-100' : 'opacity-0',
        )}
      >
        <span className="drop-glow absolute inset-0 rounded-panel" />
        <span className="glass relative rounded-chip px-4 py-2 text-body font-medium text-fg">
          Loslassen für eine neue Präsentation
        </span>
      </div>
      {upload.state.status === 'uploading' && (
        <UploadToast
          file={upload.state.file}
          progress={upload.state.progress}
          onCancel={upload.cancel}
        />
      )}

      {pageMenu.contextAt && (
        <ContextMenu
          label="Aktionen für die Präsentationen"
          actions={pageActions}
          at={pageMenu.contextAt}
          onClose={pageMenu.onContextClose}
        />
      )}
      {selectionMenuAt && selectedDecks.length > 0 && (
        <ContextMenu
          label={`Aktionen für ${selectedDecks.length} ausgewählte Präsentationen`}
          actions={bulk.actions}
          at={selectionMenuAt}
          onClose={() => setSelectionMenuAt(null)}
        />
      )}
      {bulk.dialog}
      {selection.box}
      <HomeChat
        workspace={workspace}
        // What it found is seen at once: every presentation, the search set to its words.
        onFilter={(words) => {
          setTab('all');
          setSearchContent(true);
          setQuery(words);
        }}
        toast={showToast}
      />
      <Toast toast={toast} />
    </div>
  );
}
