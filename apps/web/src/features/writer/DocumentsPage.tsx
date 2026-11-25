import { useEffect, useEffectEvent, useRef, useState, type MouseEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  CLOUD_TRASH_DAYS,
  searchFold,
  type WriterDocument,
  type WriterTemplate,
} from '@slider/shared';
import { useCreateDocument, useDocuments, useImportDocument } from '@/lib/api';
import { selectionStyle } from '@/lib/accent';
import { selectableItemProps, useCollectionSelection } from '@/lib/collection-selection';
import { isTextTarget } from '@/lib/dom';
import { withCount } from '@/lib/format';
import { isOnControl } from '@/lib/marquee-select';
import { routes } from '@/lib/routes';
import { useAccount } from '@/features/auth';
import { usePageCommands } from '@/features/commands';
import { useDeckContextMenu, useStoredChoice } from '@/features/reviews';
import {
  canCreateDecks,
  useWorkspace,
  ViewSearch,
  ViewToolbar,
  WorkspaceViews,
} from '@/features/workspaces';
import {
  Button,
  cn,
  ContextMenu,
  EmptyState,
  Menu,
  PageHeader,
  SegmentedControl,
  Select,
  SelectionBar,
  Toast,
  useFileDrop,
  useToast,
  type MenuAction,
  type Segment,
} from '@/ui';
import {
  DeleteDocumentsDialog,
  DocumentCard,
  DocumentRow,
  TrashedDocumentRow,
} from './components/DocumentItems';
import { DOCUMENT_TEMPLATES } from './lib/templates';
import { useWriterDesktopActions } from './hooks/useWriterDesktop';
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_SORT_LABELS,
  DOCUMENT_SORTS,
  documentOrder,
  isImportable,
  selectDocuments,
  type DocumentTab,
} from './lib/documents';

const VIEWS = ['grid', 'list'] as const;
const NONE: readonly WriterDocument[] = [];
const SORT_OPTIONS = DOCUMENT_SORTS.map((value) => ({
  value,
  label: DOCUMENT_SORT_LABELS[value],
}));

/** Upright sheets stand closer than slides: more of them in a row. */
const GRID =
  'grid grid-cols-2 gap-x-8 gap-y-10 @min-[636px]:grid-cols-3 @min-[900px]:grid-cols-4 @min-[1136px]:grid-cols-5';

function Skeleton({ view }: { view: 'grid' | 'list' }) {
  const items = Array.from({ length: view === 'grid' ? 5 : 3 }, (_, index) => index);
  if (view === 'list') {
    return (
      <div className="glass flex flex-col gap-1 rounded-panel p-1.5" aria-hidden>
        {items.map((index) => (
          <div key={index} className="flex items-center gap-4 px-3 py-2.5">
            <div className="skeleton aspect-[210/297] w-10 rounded-thumb" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="skeleton h-3.5 w-40 rounded-thumb" />
              <div className="skeleton h-3 w-56 rounded-thumb" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={GRID} aria-hidden>
      {items.map((index) => (
        <div key={index} className="flex flex-col gap-3">
          <div className="skeleton aspect-[210/297] rounded-control" />
          <div className="skeleton h-4 w-3/5 rounded-thumb" />
        </div>
      ))}
    </div>
  );
}

/** Writer's start: every text document of the workspace, built like Slider's „Präsentationen“. */
export function Component() {
  const navigate = useNavigate();
  const location = useLocation();
  const workspace = useWorkspace();
  const { user } = useAccount();
  const mayCreate = canCreateDecks(workspace.role);
  const [toast, showToast] = useToast();

  const inTrash = location.pathname === routes.documentsTrash(workspace.id);
  const [openOnly, setOpenOnly] = useState(false);
  const tab: DocumentTab = inTrash ? 'trash' : openOnly ? 'open' : 'all';
  const setTab = (next: DocumentTab) => {
    setOpenOnly(next === 'open');
    const to =
      next === 'trash' ? routes.documentsTrash(workspace.id) : routes.documents(workspace.id);
    if (to !== location.pathname) void navigate(to);
  };
  const [query, setQuery] = useState('');
  const [sort, setSort] = useStoredChoice('writer.documents.sort', DOCUMENT_SORTS, 'updated');
  const [view, setView] = useStoredChoice('writer.documents.view', VIEWS, 'grid');

  const list = useDocuments(workspace.id);
  const trash = useDocuments(workspace.id, 'trash');
  const documents = list.data ?? NONE;
  const visible = tab === 'trash' ? [] : selectDocuments(documents, { tab, query, sort });
  const needle = searchFold(query.trim());
  const trashed = (trash.data ?? NONE)
    .filter((document) => searchFold(document.title).includes(needle))
    .sort(documentOrder(sort));

  const pageRef = useRef<HTMLDivElement>(null);
  const selection = useCollectionSelection(
    pageRef,
    visible.map((document) => document.id),
  );
  const picked = visible.filter((document) => selection.selected.has(document.id));
  const deletable = picked.filter((document) => document.permissions.canManage);
  const [deleting, setDeleting] = useState<readonly WriterDocument[] | null>(null);
  const [selectionMenuAt, setSelectionMenuAt] = useState<{ x: number; y: number } | null>(null);
  const bulkActions: MenuAction[] = [
    {
      label: withCount('Löschen', deletable.length, picked.length),
      icon: 'delete',
      tone: 'danger',
      disabled: deletable.length === 0,
      onSelect: () => setDeleting(deletable),
    },
  ];
  // ⌫ and Entf ask to delete what is picked, as in Slider and Cloud.
  const onDeleteKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    if (event.defaultPrevented || isTextTarget(event.target) || deletable.length === 0) return;
    if (document.querySelector('dialog[open], [role="menu"]')) return;
    event.preventDefault();
    setDeleting(deletable);
  });
  useEffect(() => {
    window.addEventListener('keydown', onDeleteKey);
    return () => window.removeEventListener('keydown', onDeleteKey);
  }, []);

  // A new document opens at once: it is written in, not set up.
  const create = useCreateDocument(workspace.id);
  const createFrom = (template: WriterTemplate) => {
    if (!mayCreate || create.isPending) return;
    create.mutate(
      { template },
      {
        onSuccess: (document) => void navigate(routes.document(document.id)),
        onError: (error) => showToast(error.message, 'danger'),
      },
    );
  };
  const newActions: MenuAction[] = DOCUMENT_TEMPLATES.map(({ template, label, icon }) => ({
    label,
    icon,
    onSelect: () => createFrom(template),
  }));

  // Text files dropped on the page, or picked, become documents: one opens, several stay listed.
  const importFile = useImportDocument(workspace.id);
  const [importing, setImporting] = useState(false);
  const importFiles = async (files: File[]) => {
    if (files.length === 0 || importing) return;
    if (!mayCreate) return showToast('Du kannst hier keine Dokumente anlegen.', 'danger');
    const fitting = files.filter(isImportable);
    if (fitting.length === 0) {
      return showToast('Das ist keine Textdatei, die sich öffnen lässt.', 'danger');
    }
    setImporting(true);
    let done = 0;
    let last: WriterDocument | undefined;
    for (const file of fitting) {
      try {
        last = await importFile.mutateAsync(file);
        done += 1;
      } catch (error) {
        showToast(
          `„${file.name}“: ${error instanceof Error ? error.message : 'nicht geöffnet'}`,
          'danger',
        );
      }
    }
    setImporting(false);
    if (fitting.length === 1 && last) void navigate(routes.document(last.id));
    else if (done > 1) showToast(`${done} Dokumente hinzugefügt`);
  };
  const { dragOver, handlers: dropHandlers } = useFileDrop((files) => void importFiles(files));
  const fileInput = useRef<HTMLInputElement>(null);
  const pickFiles = () => fileInput.current?.click();

  // The app's menu bar: „Neues Dokument“ and „Öffnen …“ act on this page.
  useWriterDesktopActions((action) => {
    if (action === 'new') createFrom('plain');
    else if (action === 'open' && mayCreate) pickFiles();
  });

  const pageMenu = useDeckContextMenu();
  const onPageContextMenu = (event: MouseEvent) => {
    if (event.defaultPrevented || isOnControl(event.target)) return;
    pageMenu.onContextMenu(event);
  };
  // What is made or opened here – the page's menu and the command panel (⌘K) alike.
  const makeActions: MenuAction[] = mayCreate
    ? [
        { label: 'Neues Dokument', icon: 'add', onSelect: () => createFrom('plain') },
        { label: 'Öffnen …', icon: 'description', onSelect: pickFiles },
      ]
    : [];
  usePageCommands({ group: 'Dokumente', actions: makeActions, workspaceId: workspace.id });
  const pageActions: MenuAction[] = [
    ...makeActions,
    {
      label: 'Einstellungen',
      icon: 'settings',
      onSelect: () => void navigate(routes.preferences()),
    },
  ];

  const openCount = documents.filter((document) => document.openComments > 0).length;
  const segments: Segment<DocumentTab>[] = [
    { value: 'all', label: 'Alle', icon: 'article', count: documents.length },
    { value: 'open', label: 'Offen', icon: 'chatBubble', count: openCount },
    {
      value: 'trash',
      label: 'Papierkorb',
      icon: 'delete',
      count: trash.data?.length ? trash.data.length : undefined,
    },
  ];
  const newDocument = mayCreate ? (
    <Button icon="add" loading={create.isPending} onClick={() => createFrom('plain')}>
      Neues Dokument
    </Button>
  ) : undefined;
  const retry = (refetch: () => unknown) => (
    <Button variant="secondary" icon="refresh" onClick={() => void refetch()}>
      Erneut versuchen
    </Button>
  );
  const Item = view === 'grid' ? DocumentCard : DocumentRow;
  const selectable = {
    selected: selection.selected,
    onModifiedClick: selection.onModifiedClick,
    onSelectionMenu: setSelectionMenuAt,
  };

  return (
    <div
      ref={pageRef}
      tabIndex={-1}
      className="dot-grid relative min-h-full overflow-x-clip outline-none"
      style={selectionStyle(user.color)}
      onContextMenu={onPageContextMenu}
      onMouseDown={selection.onMouseDown}
      {...dropHandlers}
    >
      <title>{`Dokumente | ${workspace.name} | Writer`}</title>
      <input
        ref={fileInput}
        type="file"
        accept={DOCUMENT_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          void importFiles(files);
        }}
      />

      <main className="@container flex flex-col gap-6 px-4 pt-2 pb-16 md:px-8">
        <PageHeader
          layout="inline"
          subtitleSize="body"
          titleRow
          title={<WorkspaceViews workspaceId={workspace.id} current="reviews" app="writer" />}
        />

        {picked.length > 0 ? (
          <SelectionBar
            label="Ausgewählte Dokumente"
            count={picked.length}
            actions={bulkActions}
            onClear={selection.clear}
            className="sticky top-3 z-(--z-chrome) flex-wrap"
          />
        ) : (
          <ViewToolbar
            filter={(iconOnly) => (
              <SegmentedControl
                label="Dokumente filtern"
                segments={segments}
                value={tab}
                onChange={setTab}
                iconOnly={iconOnly}
              />
            )}
            action={
              mayCreate
                ? (iconOnly) =>
                    iconOnly ? (
                      <Button
                        variant="secondary"
                        size="toolbar"
                        icon="add"
                        aria-label="Neues Dokument"
                        title="Neues Dokument"
                        loading={create.isPending || importing}
                        onClick={() => createFrom('plain')}
                        className="w-10 px-0"
                      >
                        {false}
                      </Button>
                    ) : (
                      <Menu
                        label="Neues Dokument"
                        actions={newActions}
                        triggerIcon="add"
                        triggerText="Neues Dokument"
                        triggerTextSize="toolbar"
                        triggerLoading={create.isPending || importing}
                      />
                    )
                : undefined
            }
            search={
              <ViewSearch
                label="Dokumente durchsuchen"
                contentPlaceholder="Namen…"
                value={query}
                onChange={setQuery}
                content={false}
              />
            }
            sort={
              <Select
                aria-label="Sortieren nach"
                size="toolbar"
                value={sort}
                onChange={setSort}
                options={SORT_OPTIONS}
              />
            }
            view={view}
            onViewChange={setView}
            listOnly={tab === 'trash'}
          />
        )}

        <section aria-label="Dokumente" aria-busy={list.isPending}>
          {tab === 'trash' && trash.isPending ? (
            <Skeleton view="list" />
          ) : tab === 'trash' && trash.isLoadingError ? (
            <EmptyState
              title="Papierkorb konnte nicht geladen werden"
              message={trash.error.message}
              action={retry(trash.refetch)}
            />
          ) : tab === 'trash' && trashed.length === 0 ? (
            query.trim() !== '' ? (
              <EmptyState
                title={`Keine Treffer für „${query.trim()}“`}
                message="Versuche einen anderen Suchbegriff."
              />
            ) : (
              <EmptyState
                title="Hier ist nichts"
                message={`Was du löschst, liegt hier noch ${CLOUD_TRASH_DAYS} Tage.`}
              />
            )
          ) : tab === 'trash' ? (
            <ul className="flex flex-col">
              {trashed.map((document) => (
                <TrashedDocumentRow key={document.id} document={document} onNotify={showToast} />
              ))}
            </ul>
          ) : list.isPending ? (
            <Skeleton view={view} />
          ) : list.isLoadingError ? (
            <EmptyState
              title="Dokumente konnten nicht geladen werden"
              message={list.error.message}
              action={retry(list.refetch)}
            />
          ) : documents.length === 0 ? (
            <EmptyState
              title="Noch keine Dokumente"
              message={
                mayCreate
                  ? 'Schreib ein neues Dokument oder zieh eine Textdatei hierher, um gemeinsam daran zu arbeiten.'
                  : 'In diesem Workspace gibt es noch keine Dokumente. Sobald jemand eines anlegt, erscheint es hier.'
              }
              action={newDocument}
            />
          ) : visible.length === 0 && query.trim() !== '' ? (
            <EmptyState
              title={`Keine Treffer für „${query.trim()}“`}
              message="Versuche einen anderen Suchbegriff."
            />
          ) : visible.length === 0 ? (
            <EmptyState
              title="Hier ist nichts"
              message="Keine offenen Kommentare, alles erledigt."
            />
          ) : (
            <ul
              className={view === 'grid' ? GRID : 'glass flex flex-col gap-1 rounded-panel p-1.5'}
            >
              {visible.map((document) => (
                <li
                  key={document.id}
                  className="min-w-0"
                  {...selectableItemProps(document.id, selectable)}
                >
                  <Item
                    document={document}
                    selected={selection.selected.has(document.id)}
                    onNotify={showToast}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <div
        aria-hidden
        className={cn(
          'pointer-events-none fixed inset-3 z-(--z-panel) flex items-center justify-center rounded-panel border-2 border-dashed border-fg transition-opacity duration-200',
          dragOver && mayCreate ? 'opacity-100' : 'opacity-0',
        )}
      >
        <span className="drop-glow absolute inset-0 rounded-panel" />
        <span className="glass relative rounded-chip px-4 py-2 text-body font-medium text-fg">
          Loslassen für ein neues Dokument
        </span>
      </div>

      {pageMenu.contextAt && (
        <ContextMenu
          label="Aktionen für die Dokumente"
          actions={pageActions}
          at={pageMenu.contextAt}
          onClose={pageMenu.onContextClose}
        />
      )}
      {selectionMenuAt && picked.length > 0 && (
        <ContextMenu
          label={`Aktionen für ${picked.length} ausgewählte Dokumente`}
          actions={bulkActions}
          at={selectionMenuAt}
          onClose={() => setSelectionMenuAt(null)}
        />
      )}
      {deleting && (
        <DeleteDocumentsDialog
          documents={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(count) => {
            setDeleting(null);
            selection.clear();
            showToast(count === 1 ? 'Dokument gelöscht' : `${count} Dokumente gelöscht`);
          }}
        />
      )}
      {selection.box}
      <Toast toast={toast} />
    </div>
  );
}
