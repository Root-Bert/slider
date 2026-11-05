import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { searchFold, type WorkspaceMaster } from '@slider/shared';
import {
  useCreateBlankDeck,
  useRemoveWorkspaceFontFamily,
  useRemoveWorkspaceMaster,
  useWorkspaceFonts,
  useWorkspaceMasters,
} from '@/lib/api';
import { useNavigate, useSearchParams } from 'react-router';
import { selectionStyle } from '@/lib/accent';
import { pluralize } from '@/lib/format';
import { OPEN_ON_BOARD, routes } from '@/lib/routes';
import { useCollectionSelection } from '@/lib/collection-selection';
import { isOnControl } from '@/lib/marquee-select';
import { readString, writeString } from '@/lib/storage';
import { useWorkspaceFontFaces } from '@/lib/workspace-fonts';
import { useAccount } from '@/features/auth';
import { registerOfficeFonts } from '@/features/viewer';
import {
  Button,
  ConfirmDialog,
  ContextMenu,
  EmptyState,
  Notice,
  PageHeader,
  SelectionBar,
  Toast,
  cn,
  useFileDrop,
  useToast,
  type MenuAction,
} from '@/ui';
import { FontCollection, FontCollectionSkeleton } from './components/material/FontCollection';
import { FontSpecimens } from './components/material/FontSpecimens';
import { MasterCollection, MasterCollectionSkeleton } from './components/material/MasterCollection';
import { MasterSpecimens } from './components/material/MasterSpecimens';
import {
  MaterialToolbar,
  type MaterialKind,
  type MaterialSort,
} from './components/material/MaterialToolbar';
import { WorkspaceViews } from './components/WorkspaceViews';
import {
  FONT_ACCEPT,
  MASTER_ACCEPT,
  useMaterialUpload,
  type UploadedKind,
} from './hooks/useMaterialUpload';
import { useWorkspace } from './hooks/useWorkspace';
import {
  familyKey,
  groupFamilies,
  sliderFamilies,
  type FontFamily,
  type MaterialView,
} from './lib/font-families';
import { downloadMaster } from './lib/masters';
import { atLeast } from './lib/roles';

const SORTERS: Record<MaterialSort, (a: FontFamily, b: FontFamily) => number> = {
  name: (a, b) => a.family.localeCompare(b.family, 'de'),
  faces: (a, b) => b.faces.length - a.faces.length || a.family.localeCompare(b.family, 'de'),
  // Slider's fonts have no size of their own: after the uploaded ones.
  size: (a, b) => (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1),
};

const byMasterName = (a: WorkspaceMaster, b: WorkspaceMaster) => a.name.localeCompare(b.name, 'de');

// Designs show no size: "Größe", chosen for the fonts, sorts them by name.
const MASTER_SORTERS: Record<MaterialSort, (a: WorkspaceMaster, b: WorkspaceMaster) => number> = {
  name: byMasterName,
  faces: (a, b) => b.layouts.length - a.layouts.length || byMasterName(a, b),
  size: byMasterName,
};

const SLIDER_FAMILIES = sliderFamilies();

/** `?filter=` of each kind. */
const KIND_PARAMS: Record<MaterialKind, string> = {
  masters: 'vorlagen',
  'workspace-fonts': 'workspace-schriften',
  'slider-fonts': 'slider-schriften',
};
/** The filter last shown, as its `?filter=` – the page opens on it again without one. */
const KIND_KEY = 'slider.material.filter';
const kindOf = (param: string | null): MaterialKind =>
  (Object.keys(KIND_PARAMS) as MaterialKind[]).find((kind) => KIND_PARAMS[kind] === param) ??
  'masters';

/**
 * `/w/:workspaceId/material` – "Bibliothek", next to "Projekte": what the workspace's decks draw
 * on, laid out like the reviews. Its fonts: the ones Slider brings along, and its own – TTF or
 * OTF files, or the zip a font site hands out – which the slides are drawn in and the editor
 * offers. And its slide masters: company designs, as templates (`.otp`, `.potx`), with a
 * picture of each layout. Members and admins add both (the "Hinzufügen" menu, or files dropped
 * anywhere on the page), only admins remove them; everyone sees them. Templates and fonts are
 * selected like decks (⌘/Shift-click, ⌘A, a selection box; the selection bar in the toolbar's
 * place) and have their actions on right click.
 */
export function Component() {
  const workspace = useWorkspace();
  const { user } = useAccount();
  const [toast, showToast] = useToast();
  const editable = atLeast(workspace.role, 'member');
  // Every deck of the workspace may be drawn in its fonts: only admins take them away.
  const canRemove = atLeast(workspace.role, 'admin');
  const fonts = useWorkspaceFonts(workspace.id);
  const remove = useRemoveWorkspaceFontFamily(workspace.id);
  const masters = useWorkspaceMasters(workspace.id);
  // Templates designed here and never saved: no project leads to them, so the library does.
  const removeMaster = useRemoveWorkspaceMaster(workspace.id);
  // A presentation built on a design: its first layout, straight into the editor.
  const createDeck = useCreateBlankDeck(workspace.id);
  const navigate = useNavigate();
  useWorkspaceFontFaces(fonts.data);
  // Slider's fonts as the editor draws them; a face downloads once a card on screen shows it.
  useEffect(() => registerOfficeFonts(), []);

  const inputRef = useRef<HTMLInputElement>(null);
  const masterInputRef = useRef<HTMLInputElement>(null);
  const [removingMasters, setRemovingMasters] = useState<WorkspaceMaster[] | null>(null);
  const [selectionMenuAt, setSelectionMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [removing, setRemoving] = useState<string[] | null>(null);
  const [removePending, setRemovePending] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [pageMenuAt, setPageMenuAt] = useState<{ x: number; y: number } | null>(null);
  // In the URL: a design's page leads back to its filter, and a link can open one.
  const [params, setParams] = useSearchParams();
  const kind = kindOf(params.get('filter') ?? readString(KIND_KEY));
  useEffect(() => writeString(KIND_KEY, KIND_PARAMS[kind]), [kind]);
  const setKind = (next: MaterialKind) =>
    setParams(
      (current) => {
        current.set('filter', KIND_PARAMS[next]);
        return current;
      },
      { replace: true },
    );
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<MaterialSort>('name');
  const [view, setView] = useState<MaterialView>('grid');

  // Names by default; with the search's button also a template's layouts and a font's „für
  // Calibri“ and „aus „…““, as the cards show them. Off again on every visit, as on "Präsentationen".
  const [searchContent, setSearchContent] = useState(false);

  const own = groupFamilies(fonts.data ?? []);
  const needle = searchFold(query.replace(/\s+/g, ' ').trim());
  const matches = (texts: readonly (string | null)[]) =>
    texts.some((text) => text !== null && searchFold(text).includes(needle));
  const pick = (families: readonly FontFamily[]) =>
    families
      .filter((family) =>
        matches(
          searchContent ? [family.family, ...family.standsIn, family.takenFrom] : [family.family],
        ),
      )
      .toSorted(SORTERS[sort]);
  const showsOwn = kind === 'workspace-fonts';
  const visibleMasters = (masters.data ?? [])
    .filter((master) =>
      matches(
        searchContent
          ? [master.name, ...master.layouts.flatMap((layout) => [layout.name, layout.master])]
          : [master.name],
      ),
    )
    .toSorted(MASTER_SORTERS[sort]);
  const visible =
    kind === 'workspace-fonts' ? pick(own) : kind === 'slider-fonts' ? pick(SLIDER_FAMILIES) : [];

  // Multi-select of what the filter shows: ⌘/Shift-click, ⌘A or a selection box dragged over
  // empty space.
  const pageRef = useRef<HTMLDivElement>(null);
  const selection = useCollectionSelection(
    pageRef,
    kind === 'masters' ? visibleMasters.map((master) => master.id) : visible.map(familyKey),
  );
  const selectedFamilies = visible.filter((family) => selection.selected.has(familyKey(family)));
  const selectedMasters = visibleMasters.filter((master) => selection.selected.has(master.id));
  const selectable = {
    selected: selection.selected,
    onModifiedClick: selection.onModifiedClick,
    onSelectionMenu: setSelectionMenuAt,
  };
  const askRemoveMasters = (list: WorkspaceMaster[]) => {
    setRemoveError(null);
    setRemovingMasters(list);
  };

  const copyNames = (families: readonly FontFamily[]) => {
    const names = families.map((family) => family.family);
    navigator.clipboard
      ?.writeText(names.join(', '))
      .then(() => showToast(names.length === 1 ? 'Name kopiert' : `${names.length} Namen kopiert`))
      .catch(() => showToast('Konnte nicht in die Zwischenablage kopieren.', 'danger'));
  };
  const askRemove = (families: readonly FontFamily[]) => {
    setRemoveError(null);
    setRemoving(families.map((family) => family.family));
  };
  const actionsFor = (family: FontFamily): MenuAction[] => [
    { label: 'Name kopieren', icon: 'contentCopy', onSelect: () => copyNames([family]) },
    // Slider's own fonts stay; uploaded ones only admins remove.
    ...(canRemove && family.source === 'workspace'
      ? [
          {
            label: 'Löschen',
            icon: 'delete',
            tone: 'danger',
            onSelect: () => askRemove([family]),
          } satisfies MenuAction,
        ]
      : []),
  ];
  const removable = selectedFamilies.filter((family) => family.source === 'workspace');
  const masterSelectionActions: MenuAction[] = [
    {
      label: 'Herunterladen',
      icon: 'download',
      onSelect: () => selectedMasters.forEach(downloadMaster),
    },
    ...(canRemove
      ? [
          {
            label: 'Löschen',
            icon: 'delete',
            tone: 'danger',
            onSelect: () => askRemoveMasters(selectedMasters),
          } satisfies MenuAction,
        ]
      : []),
  ];
  const fontSelectionActions: MenuAction[] = [
    {
      label: `${selectedFamilies.length} Namen kopieren`,
      icon: 'contentCopy',
      onSelect: () => copyNames(selectedFamilies),
    },
    ...(canRemove && removable.length > 0
      ? [
          {
            label: `${pluralize(removable.length, 'eigene Schrift', 'eigene Schriften')} löschen`,
            icon: 'delete',
            tone: 'danger',
            onSelect: () => askRemove(removable),
          } satisfies MenuAction,
        ]
      : []),
  ];
  const selectionCount = kind === 'masters' ? selectedMasters.length : selectedFamilies.length;
  const selectionActions = kind === 'masters' ? masterSelectionActions : fontSelectionActions;

  /**
   * Deletes `list` one after another (fonts, templates). A failure keeps the dialog open with
   * only what is left – trying again doesn't ask for what is gone already.
   */
  const removeEach = async <T,>(
    list: readonly T[],
    removeOne: (item: T) => Promise<unknown>,
    setLeft: (left: T[] | null) => void,
    toast: string,
  ) => {
    setRemovePending(true);
    setRemoveError(null);
    let done = 0;
    try {
      for (const item of list) {
        await removeOne(item);
        done++;
      }
      showToast(toast);
      setLeft(null);
      selection.clear();
    } catch (error) {
      setLeft(list.slice(done));
      setRemoveError(error instanceof Error ? error.message : String(error));
    } finally {
      setRemovePending(false);
    }
  };
  const confirmRemove = () =>
    removing &&
    removeEach(
      removing,
      (family) => remove.mutateAsync(family),
      setRemoving,
      removing.length === 1
        ? `${removing[0]} gelöscht`
        : `${pluralize(removing.length, 'Schrift', 'Schriften')} gelöscht`,
    );
  const confirmRemoveMasters = () =>
    removingMasters &&
    removeEach(
      removingMasters,
      (master) => removeMaster.mutateAsync(master.id),
      setRemovingMasters,
      removingMasters.length === 1
        ? `${removingMasters[0]!.name} gelöscht`
        : `${pluralize(removingMasters.length, 'Vorlage', 'Vorlagen')} gelöscht`,
    );

  const pickFiles = () => inputRef.current?.click();
  const pickMaster = () => masterInputRef.current?.click();

  // „Neues Asset“: its own page – a template to design, or files to upload.
  const goToNew = () => void navigate(routes.newMaterial(workspace.id));
  // Right click on empty space (not on a font – its own menu has run – nor a control).
  const pageActions: MenuAction[] = editable
    ? [{ label: 'Neues Asset', icon: 'add', onSelect: goToNew }]
    : [];
  const onPageContextMenu = (event: MouseEvent) => {
    if (event.defaultPrevented || event.shiftKey || pageActions.length === 0) return;
    if (isOnControl(event.target)) return;
    event.preventDefault();
    setPageMenuAt({ x: event.clientX, y: event.clientY });
  };

  const { sendAny, sendMasters, sendFonts, skipped, uploadingFonts, uploadingMaster } =
    useMaterialUpload(workspace.id, {
      notify: showToast,
      onAdded: (added: UploadedKind) => setKind(added),
    });
  // Files dropped anywhere on the page are uploaded.
  const { dragOver, handlers: dropHandlers } = useFileDrop(sendAny);

  return (
    <div
      ref={pageRef}
      className="dot-grid relative min-h-full overflow-x-clip"
      // Selection in the viewer's own colour, as on "Projekte".
      style={selectionStyle(user.color)}
      onMouseDown={selection.onMouseDown}
      onContextMenu={onPageContextMenu}
      {...(editable ? dropHandlers : {})}
    >
      <title>{`Bibliothek | ${workspace.name} | Slider`}</title>

      <main className="flex flex-col gap-6 px-4 pt-2 pb-16 md:px-14">
        <PageHeader
          titleRow
          title={<WorkspaceViews workspaceId={workspace.id} current="material" />}
        />

        {selectionCount > 0 ? (
          <SelectionBar
            label={kind === 'masters' ? 'Ausgewählte Vorlagen' : 'Ausgewählte Schriften'}
            count={selectionCount}
            actions={selectionActions}
            onClear={selection.clear}
            // Sticks to the top while scrolling, as on "Präsentationen".
            className="sticky top-3 z-(--z-chrome) flex-wrap"
          />
        ) : (
          <MaterialToolbar
            kind={kind}
            onKindChange={(next) => {
              selection.clear();
              setKind(next);
            }}
            counts={{
              'slider-fonts': SLIDER_FAMILIES.length,
              'workspace-fonts': own.length,
              masters: masters.data?.length ?? 0,
            }}
            query={query}
            onQueryChange={setQuery}
            content={searchContent}
            onContentChange={setSearchContent}
            sort={sort}
            onSortChange={setSort}
            view={view}
            onViewChange={setView}
            action={
              editable && (
                <Button
                  variant="secondary"
                  size="toolbar"
                  icon="add"
                  aria-label="Neues Asset"
                  loading={uploadingFonts || uploadingMaster}
                  onClick={goToNew}
                >
                  <span className="max-sm:hidden">Neues Asset</span>
                </Button>
              )
            }
          />
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={FONT_ACCEPT}
          className="hidden"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            // The same files twice in a row must fire `change` again.
            event.target.value = '';
            sendFonts(files);
          }}
        />
        <input
          ref={masterInputRef}
          type="file"
          multiple
          accept={MASTER_ACCEPT}
          className="hidden"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            sendMasters(files);
          }}
        />

        {skipped.length > 0 && (
          <Notice
            tone="warning"
            variant="plain"
            size="sm"
            title="Nicht übernommen"
            className="max-w-[720px]"
          >
            <ul className="flex flex-col gap-0.5">
              {skipped.map((item, i) => (
                <li key={`${item.name}-${i}`}>
                  {item.name}: {item.reason}
                </li>
              ))}
            </ul>
          </Notice>
        )}

        <section aria-label="Schriften" aria-busy={showsOwn && fonts.isPending}>
          {kind === 'masters' ? (
            masters.isPending ? (
              <MasterCollectionSkeleton view={view} />
            ) : masters.isError ? (
              <EmptyState
                title="Vorlagen konnten nicht geladen werden"
                message={masters.error.message}
                action={
                  <Button variant="secondary" icon="refresh" onClick={() => void masters.refetch()}>
                    Erneut versuchen
                  </Button>
                }
              />
            ) : masters.data.length === 0 ? (
              <EmptyState
                illustration={<MasterSpecimens />}
                title="Noch keine Vorlagen"
                message={
                  editable
                    ? 'Ladet euer Firmendesign als Vorlage hoch. Slider liest Master und Layouts daraus aus.'
                    : 'Sobald jemand ein Firmendesign hochlädt, erscheinen seine Master und Layouts hier.'
                }
                action={
                  editable && (
                    <Button icon="upload" loading={uploadingMaster} onClick={pickMaster}>
                      Vorlage hochladen
                    </Button>
                  )
                }
              />
            ) : visibleMasters.length === 0 ? (
              <EmptyState
                illustration={<MasterSpecimens />}
                title={`Keine Treffer für „${query.trim()}“`}
                message="Versuche einen anderen Suchbegriff."
              />
            ) : (
              <MasterCollection
                {...selectable}
                workspaceId={workspace.id}
                masters={visibleMasters}
                canRename={editable}
                onNotify={showToast}
                view={view}
                // Only an ODP design can be edited in Slider; the server makes nothing of a
                // PowerPoint one yet.
                createActionFor={(master) =>
                  editable && master.format === 'odp'
                    ? {
                        label: 'Neue Präsentation',
                        icon: 'add',
                        onSelect: () =>
                          createDeck.mutate(master.id, {
                            onSuccess: (deck) =>
                              void navigate(routes.deck(deck.id), {
                                viewTransition: true,
                                state: OPEN_ON_BOARD,
                              }),
                            onError: (error) => showToast(error.message, 'danger'),
                          }),
                      }
                    : null
                }
                actionsFor={(master) => [
                  // Designed in Slider: back into the editor it was designed in.
                  ...(editable && master.draftDeckId
                    ? [
                        {
                          label: 'Bearbeiten',
                          icon: 'slideMaster',
                          onSelect: () =>
                            void navigate(routes.deck(master.draftDeckId!), {
                              viewTransition: true,
                            }),
                        } satisfies MenuAction,
                      ]
                    : []),
                  {
                    label: 'Herunterladen',
                    icon: 'download',
                    onSelect: () => downloadMaster(master),
                  },
                  ...(canRemove
                    ? [
                        {
                          label: 'Löschen',
                          icon: 'delete',
                          tone: 'danger',
                          onSelect: () => askRemoveMasters([master]),
                        } satisfies MenuAction,
                      ]
                    : []),
                ]}
              />
            )
          ) : showsOwn && fonts.isPending ? (
            <FontCollectionSkeleton view={view} />
          ) : showsOwn && fonts.isError ? (
            <EmptyState
              title="Schriften konnten nicht geladen werden"
              message={fonts.error.message}
              action={
                <Button variant="secondary" icon="refresh" onClick={() => void fonts.refetch()}>
                  Erneut versuchen
                </Button>
              }
            />
          ) : kind === 'workspace-fonts' && own.length === 0 ? (
            <EmptyState
              illustration={<FontSpecimens />}
              title="Noch keine eigenen Schriften"
              message={
                editable
                  ? 'Ladet eure Hausschriften hoch – als TTF oder OTF, gern auch als Zip. Folien, die sie verwenden, werden dann darin gezeichnet, und der Editor bietet sie an.'
                  : 'Folien werden in freien Schriften gezeichnet, die euren ähneln. Sobald jemand Hausschriften hochlädt, erscheinen sie hier.'
              }
              action={
                editable && (
                  <Button icon="upload" loading={uploadingFonts} onClick={pickFiles}>
                    Schriften hochladen
                  </Button>
                )
              }
            />
          ) : visible.length === 0 ? (
            <EmptyState
              illustration={<FontSpecimens />}
              title={`Keine Treffer für „${query.trim()}“`}
              message="Versuche einen anderen Suchbegriff."
            />
          ) : (
            <FontCollection
              families={visible}
              view={view}
              actionsFor={actionsFor}
              {...selectable}
            />
          )}
        </section>
      </main>

      {/* Over the whole page while files are dragged over it. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none fixed inset-3 z-(--z-panel) flex items-center justify-center rounded-panel border-2 border-dashed border-fg transition-opacity duration-200',
          dragOver ? 'opacity-100' : 'opacity-0',
        )}
      >
        <span className="drop-glow absolute inset-0 rounded-panel" />
        <span className="glass relative rounded-chip px-4 py-2 text-body font-medium text-fg">
          Loslassen zum Hochladen: Schriften oder Vorlagen
        </span>
      </div>

      {pageMenuAt && (
        <ContextMenu
          label="Aktionen für die Bibliothek"
          actions={pageActions}
          at={pageMenuAt}
          onClose={() => setPageMenuAt(null)}
        />
      )}
      {selectionMenuAt && selectionCount > 0 && (
        <ContextMenu
          label={`Aktionen für ${selectionCount} ausgewählte ${kind === 'masters' ? 'Vorlagen' : 'Schriften'}`}
          actions={selectionActions}
          at={selectionMenuAt}
          onClose={() => setSelectionMenuAt(null)}
        />
      )}
      {selection.box}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={
          removing?.length === 1
            ? `${removing[0]} löschen?`
            : `${pluralize(removing?.length ?? 0, 'Schrift', 'Schriften')} löschen?`
        }
        description="Eine Schrift, die eine Präsentation noch verwendet, lässt sich erst löschen, wenn diese Präsentation gelöscht ist."
        confirmLabel="Löschen"
        confirmIcon="delete"
        pending={removePending}
        error={removeError ?? undefined}
        onConfirm={() => void confirmRemove()}
      />
      <ConfirmDialog
        open={removingMasters !== null}
        onClose={() => setRemovingMasters(null)}
        title={
          removingMasters?.length === 1
            ? `${removingMasters[0]!.name} löschen?`
            : `${pluralize(removingMasters?.length ?? 0, 'Vorlage', 'Vorlagen')} löschen?`
        }
        description={
          removingMasters?.length === 1
            ? 'Die Datei und die Bilder ihrer Layouts werden gelöscht. Präsentationen bleiben, wie sie sind.'
            : 'Die Dateien und die Bilder ihrer Layouts werden gelöscht. Präsentationen bleiben, wie sie sind.'
        }
        confirmLabel="Löschen"
        confirmIcon="delete"
        pending={removePending}
        error={removeError ?? undefined}
        onConfirm={() => void confirmRemoveMasters()}
      />
      <Toast toast={toast} />
    </div>
  );
}
