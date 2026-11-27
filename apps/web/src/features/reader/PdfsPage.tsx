import { useEffect, useEffectEvent, useRef, useState, type MouseEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { CLOUD_TRASH_DAYS, searchFold, type ReaderPdf } from '@slider/shared';
import { useImportPdf, usePdfs } from '@/lib/api';
import { selectionStyle } from '@/lib/accent';
import { selectableItemProps, useCollectionSelection } from '@/lib/collection-selection';
import { isTextTarget } from '@/lib/dom';
import { withCount } from '@/lib/format';
import { isOnControl } from '@/lib/marquee-select';
import { routes } from '@/lib/routes';
import { useViewChoice } from '@/lib/view-choice';
import { usePageCommands } from '@/features/commands';
import { useAccount } from '@/features/auth';
import { useDeckContextMenu, useStoredChoice } from '@/features/reviews';
import {
  canCreateDecks,
  useWorkspace,
  ViewSearch,
  ViewTitles,
  VIEW_NAMES,
  ViewToolbar,
} from '@/features/workspaces';
import {
  Button,
  cn,
  ContextMenu,
  EmptyState,
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
import { DeletePdfsDialog, PdfCard, PdfRow, TrashedPdfRow } from './components/PdfItems';
import { useReaderDesktopActions } from './hooks/useReaderDesktop';
import {
  isPdfFile,
  PDF_ACCEPT,
  PDF_SORT_LABELS,
  PDF_SORTS,
  pdfOrder,
  selectPdfs,
  type PdfTab,
} from './lib/pdfs';

const VIEWS = ['grid', 'list'] as const;
const NONE: readonly ReaderPdf[] = [];
const SORT_OPTIONS = PDF_SORTS.map((value) => ({
  value,
  label: PDF_SORT_LABELS[value],
}));

/** Upright pages stand closer than slides: more of them in a row. */
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

/** Reader's start: every PDF of the workspace, built like Slider's „Präsentationen“. */
export function Component() {
  const navigate = useNavigate();
  const location = useLocation();
  const workspace = useWorkspace();
  const { user } = useAccount();
  const mayCreate = canCreateDecks(workspace.role);
  const [toast, showToast] = useToast();

  const inTrash = location.pathname === routes.pdfsTrash(workspace.id);
  const [openOnly, setOpenOnly] = useState(false);
  const tab: PdfTab = inTrash ? 'trash' : openOnly ? 'open' : 'all';
  const setTab = (next: PdfTab) => {
    setOpenOnly(next === 'open');
    const to = next === 'trash' ? routes.pdfsTrash(workspace.id) : routes.pdfs(workspace.id);
    if (to !== location.pathname) void navigate(to);
  };
  const [query, setQuery] = useState('');
  const [sort, setSort] = useStoredChoice('reader.pdfs.sort', PDF_SORTS, 'updated');
  const [view, setView] = useViewChoice('reader.pdfs.view', VIEWS, 'grid');

  const list = usePdfs(workspace.id);
  const trash = usePdfs(workspace.id, 'trash');
  const pdfs = list.data ?? NONE;
  const visible = tab === 'trash' ? [] : selectPdfs(pdfs, { tab, query, sort });
  const needle = searchFold(query.trim());
  const trashed = (trash.data ?? NONE)
    .filter((pdf) => searchFold(pdf.title).includes(needle))
    .sort(pdfOrder(sort));

  const pageRef = useRef<HTMLDivElement>(null);
  const selection = useCollectionSelection(
    pageRef,
    visible.map((pdf) => pdf.id),
  );
  const picked = visible.filter((pdf) => selection.selected.has(pdf.id));
  const deletable = picked.filter((pdf) => pdf.permissions.canManage);
  const [deleting, setDeleting] = useState<readonly ReaderPdf[] | null>(null);
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

  // PDFs dropped on the page, or picked, are brought in: one opens, several stay listed.
  const importFile = useImportPdf(workspace.id);
  const [importing, setImporting] = useState(false);
  const importFiles = async (files: File[]) => {
    if (files.length === 0 || importing) return;
    if (!mayCreate) return showToast('Du kannst hier keine PDFs hinzufügen.', 'danger');
    const fitting = files.filter(isPdfFile);
    if (fitting.length === 0) return showToast('Das ist kein PDF.', 'danger');
    setImporting(true);
    let done = 0;
    let last: ReaderPdf | undefined;
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
    if (fitting.length === 1 && last) void navigate(routes.pdf(last.id));
    else if (done > 1) showToast(`${done} PDFs hinzugefügt`);
  };
  const { dragOver, handlers: dropHandlers } = useFileDrop((files) => void importFiles(files));
  const fileInput = useRef<HTMLInputElement>(null);
  const pickFiles = () => fileInput.current?.click();

  // The app's menu bar: „PDF hinzufügen …“ acts on this page.
  useReaderDesktopActions((action) => {
    if (action === 'open' && mayCreate) pickFiles();
  });

  const pageMenu = useDeckContextMenu();
  const onPageContextMenu = (event: MouseEvent) => {
    if (event.defaultPrevented || isOnControl(event.target)) return;
    pageMenu.onContextMenu(event);
  };
  // What is brought here – the page's menu and the command panel (⌘K) alike.
  const makeActions: MenuAction[] = mayCreate
    ? [{ label: 'PDF hinzufügen', icon: 'upload', onSelect: pickFiles }]
    : [];
  usePageCommands({ group: 'PDFs', actions: makeActions, workspaceId: workspace.id });
  const pageActions: MenuAction[] = [
    ...makeActions,
    {
      label: 'Einstellungen',
      icon: 'settings',
      onSelect: () => void navigate(routes.preferences()),
    },
  ];

  const openCount = pdfs.filter((pdf) => pdf.openComments > 0).length;
  const segments: Segment<PdfTab>[] = [
    { value: 'all', label: 'Alle', icon: 'pictureAsPdf', count: pdfs.length },
    { value: 'open', label: 'Offen', icon: 'chatBubble', count: openCount },
    {
      value: 'trash',
      label: 'Papierkorb',
      icon: 'delete',
      count: trash.data?.length ? trash.data.length : undefined,
    },
  ];
  const addPdf = mayCreate ? (
    <Button icon="upload" loading={importing} onClick={pickFiles}>
      PDF hinzufügen
    </Button>
  ) : undefined;
  const retry = (refetch: () => unknown) => (
    <Button variant="secondary" icon="refresh" onClick={() => void refetch()}>
      Erneut versuchen
    </Button>
  );
  const Item = view === 'grid' ? PdfCard : PdfRow;
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
      <title>{`PDFs | ${workspace.name} | Reader`}</title>
      <input
        ref={fileInput}
        type="file"
        accept={PDF_ACCEPT}
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
          title={
            <ViewTitles
              views={[
                {
                  key: 'pdfs',
                  label: 'PDFs',
                  to: routes.pdfs(workspace.id),
                  name: VIEW_NAMES.first,
                },
              ]}
              current="pdfs"
            />
          }
        />

        {picked.length > 0 ? (
          <SelectionBar
            label="Ausgewählte PDFs"
            count={picked.length}
            actions={bulkActions}
            onClear={selection.clear}
            className="sticky top-3 z-(--z-chrome) flex-wrap"
          />
        ) : (
          <ViewToolbar
            filter={(iconOnly) => (
              <SegmentedControl
                label="PDFs filtern"
                segments={segments}
                value={tab}
                onChange={setTab}
                iconOnly={iconOnly}
              />
            )}
            action={
              mayCreate
                ? (iconOnly) => (
                    <Button
                      variant="secondary"
                      size="toolbar"
                      icon="upload"
                      aria-label={iconOnly ? 'PDF hinzufügen' : undefined}
                      title={iconOnly ? 'PDF hinzufügen' : undefined}
                      loading={importing}
                      onClick={pickFiles}
                      className={iconOnly ? 'w-10 px-0' : undefined}
                    >
                      {iconOnly ? false : 'PDF hinzufügen'}
                    </Button>
                  )
                : undefined
            }
            search={
              <ViewSearch
                label="PDFs durchsuchen"
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

        <section aria-label="PDFs" aria-busy={list.isPending}>
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
              {trashed.map((pdf) => (
                <TrashedPdfRow key={pdf.id} pdf={pdf} onNotify={showToast} />
              ))}
            </ul>
          ) : list.isPending ? (
            <Skeleton view={view} />
          ) : list.isLoadingError ? (
            <EmptyState
              title="PDFs konnten nicht geladen werden"
              message={list.error.message}
              action={retry(list.refetch)}
            />
          ) : pdfs.length === 0 ? (
            <EmptyState
              title="Noch keine PDFs"
              message={
                mayCreate
                  ? 'Zieh ein PDF hierher, um es auszufüllen, zu unterschreiben und gemeinsam zu kommentieren.'
                  : 'In diesem Workspace gibt es noch keine PDFs. Sobald jemand eines hinzufügt, erscheint es hier.'
              }
              action={addPdf}
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
              {visible.map((pdf) => (
                <li key={pdf.id} className="min-w-0" {...selectableItemProps(pdf.id, selectable)}>
                  <Item pdf={pdf} selected={selection.selected.has(pdf.id)} onNotify={showToast} />
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
          Loslassen, um hinzuzufügen
        </span>
      </div>

      {pageMenu.contextAt && (
        <ContextMenu
          label="Aktionen für die PDFs"
          actions={pageActions}
          at={pageMenu.contextAt}
          onClose={pageMenu.onContextClose}
        />
      )}
      {selectionMenuAt && picked.length > 0 && (
        <ContextMenu
          label={`Aktionen für ${picked.length} ausgewählte PDFs`}
          actions={bulkActions}
          at={selectionMenuAt}
          onClose={() => setSelectionMenuAt(null)}
        />
      )}
      {deleting && (
        <DeletePdfsDialog
          pdfs={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(count) => {
            setDeleting(null);
            selection.clear();
            showToast(count === 1 ? 'PDF gelöscht' : `${count} PDFs gelöscht`);
          }}
        />
      )}
      {selection.box}
      <Toast toast={toast} />
    </div>
  );
}
