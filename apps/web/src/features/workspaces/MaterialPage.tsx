import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
} from 'react';
import { WORKSPACE_FONT_UPLOAD_MAX_BYTES, type WorkspaceFontUpload } from '@slider/shared';
import {
  useRemoveWorkspaceFontFamily,
  useUploadWorkspaceFonts,
  useWorkspaceFonts,
} from '@/lib/api';
import { accentColor, isLightAccent } from '@/lib/accent';
import { pluralize } from '@/lib/format';
import { useMarqueeSelect } from '@/lib/marquee-select';
import { useMultiSelect } from '@/lib/multi-select';
import { useWorkspaceFontFaces } from '@/lib/workspace-fonts';
import { AppHeader } from '@/shell/AppHeader';
import { useAccount } from '@/features/auth';
import { registerOfficeFonts } from '@/features/viewer';
import {
  Button,
  ConfirmDialog,
  ContextMenu,
  EmptyState,
  Notice,
  PageHeader,
  Toast,
  cn,
  useToast,
  type MenuAction,
} from '@/ui';
import { FontCollection, FontCollectionSkeleton } from './components/material/FontCollection';
import { FontSpecimens } from './components/material/FontSpecimens';
import {
  MaterialToolbar,
  type MaterialKind,
  type MaterialSort,
} from './components/material/MaterialToolbar';
import { WorkspaceViews } from './components/WorkspaceViews';
import { useWorkspace } from './hooks/useWorkspace';
import {
  familyKey,
  groupFamilies,
  sliderFamilies,
  type FontFamily,
  type MaterialView,
} from './lib/font-families';
import { atLeast } from './lib/roles';

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');

const SORTERS: Record<MaterialSort, (a: FontFamily, b: FontFamily) => number> = {
  name: (a, b) => a.family.localeCompare(b.family, 'de'),
  faces: (a, b) => b.faces.length - a.faces.length || a.family.localeCompare(b.family, 'de'),
  // Slider's fonts have no size of their own: after the uploaded ones.
  size: (a, b) => (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1),
};

const SLIDER_FAMILIES = sliderFamilies();

/**
 * `/w/:workspaceId/material` – "Workspace", next to "Reviews": what the workspace's decks draw
 * on, laid out like the reviews. For now its fonts: the ones Slider brings along, and its own –
 * TTF or OTF files, or the zip a font site hands out – which the slides are drawn in and the
 * editor offers. Members and admins add those (the button, or dropped anywhere on the page),
 * only admins remove them; everyone sees them. Fonts are selected like decks (⌘/Shift-click, a
 * selection box) and have their actions on right click.
 */
export function Component() {
  const workspace = useWorkspace();
  const { user } = useAccount();
  const [toast, showToast] = useToast();
  const editable = atLeast(workspace.role, 'member');
  // Every deck of the workspace may be drawn in its fonts: only admins take them away.
  const canRemove = atLeast(workspace.role, 'admin');
  const fonts = useWorkspaceFonts(workspace.id);
  const upload = useUploadWorkspaceFonts(workspace.id);
  const remove = useRemoveWorkspaceFontFamily(workspace.id);
  useWorkspaceFontFaces(fonts.data);
  // Slider's fonts as the editor draws them; a face downloads once a card on screen shows it.
  useEffect(() => registerOfficeFonts(), []);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [skipped, setSkipped] = useState<WorkspaceFontUpload['skipped']>([]);
  const [removing, setRemoving] = useState<string[] | null>(null);
  const [removePending, setRemovePending] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [pageMenuAt, setPageMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [kind, setKind] = useState<MaterialKind>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<MaterialSort>('name');
  const [view, setView] = useState<MaterialView>('grid');

  const own = groupFamilies(fonts.data ?? []);
  const needle = query.trim().toLocaleLowerCase('de');
  const pick = (families: readonly FontFamily[]) =>
    families
      .filter((family) => family.family.toLocaleLowerCase('de').includes(needle))
      .toSorted(SORTERS[sort]);
  // The workspace's own first: they are what it chose.
  const visible = [
    ...(kind === 'slider-fonts' ? [] : pick(own)),
    ...(kind === 'workspace-fonts' ? [] : pick(SLIDER_FAMILIES)),
  ];
  const showsOwn = kind !== 'slider-fonts';

  // Multi-select: ⌘/Shift-click, ⌘A or a selection box dragged over empty space.
  const selection = useMultiSelect(visible.map(familyKey));
  const selectedFamilies = visible.filter((family) => selection.selected.has(familyKey(family)));
  const pageRef = useRef<HTMLDivElement>(null);
  const marqueeBoxRef = useRef<HTMLDivElement>(null);
  const marquee = useMarqueeSelect(pageRef, marqueeBoxRef, {
    attribute: 'data-font-key',
    ...selection.marquee,
  });

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
            label: 'Entfernen',
            icon: 'delete',
            tone: 'danger',
            onSelect: () => askRemove([family]),
          } satisfies MenuAction,
        ]
      : []),
  ];
  const removable = selectedFamilies.filter((family) => family.source === 'workspace');
  const selectionActions: MenuAction[] = [
    {
      label: `${selectedFamilies.length} Namen kopieren`,
      icon: 'contentCopy',
      onSelect: () => copyNames(selectedFamilies),
    },
    ...(canRemove && removable.length > 0
      ? [
          {
            label: `${pluralize(removable.length, 'eigene Schrift', 'eigene Schriften')} entfernen`,
            icon: 'delete',
            tone: 'danger',
            onSelect: () => askRemove(removable),
          } satisfies MenuAction,
        ]
      : []),
  ];
  const confirmRemove = async () => {
    if (!removing) return;
    setRemovePending(true);
    setRemoveError(null);
    try {
      for (const family of removing) await remove.mutateAsync(family);
      showToast(
        removing.length === 1
          ? `${removing[0]} entfernt`
          : `${pluralize(removing.length, 'Schrift', 'Schriften')} entfernt`,
      );
      setRemoving(null);
      selection.clear();
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : String(error));
    } finally {
      setRemovePending(false);
    }
  };

  // Right click on empty space (not on a font – its own menu has run – nor a control).
  const pageActions: MenuAction[] = editable
    ? [{ label: 'Neue Schrift', icon: 'add', onSelect: () => inputRef.current?.click() }]
    : [];
  const onPageContextMenu = (event: MouseEvent) => {
    if (event.defaultPrevented || event.shiftKey || pageActions.length === 0) return;
    if ((event.target as Element).closest('a, button, input, textarea, select, [role="menu"]'))
      return;
    event.preventDefault();
    setPageMenuAt({ x: event.clientX, y: event.clientY });
  };

  const send = (files: File[]) => {
    if (files.length === 0) return;
    const size = files.reduce((total, file) => total + file.size, 0);
    if (size > WORKSPACE_FONT_UPLOAD_MAX_BYTES) {
      showToast('Das sind zu viele Daten auf einmal (höchstens 80 MB).', 'danger');
      return;
    }
    const before = new Set(fonts.data?.map((font) => font.id));
    setSkipped([]);
    upload.mutate(files, {
      onSuccess: (result) => {
        setSkipped(result.skipped);
        const added = result.fonts.filter((font) => !before.has(font.id)).length;
        if (added > 0)
          showToast(`${pluralize(added, 'Schriftschnitt', 'Schriftschnitte')} hochgeladen`);
      },
      onError: (error) => showToast(error.message, 'danger'),
    });
  };
  const pickFiles = () => inputRef.current?.click();

  // Files dropped anywhere on the page are uploaded.
  const dropHandlers = editable
    ? {
        onDragEnter: (event: DragEvent) => {
          if (hasFiles(event)) setDragOver(true);
        },
        onDragOver: (event: DragEvent) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        },
        onDragLeave: (event: DragEvent) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
        },
        onDrop: (event: DragEvent) => {
          event.preventDefault();
          setDragOver(false);
          send([...event.dataTransfer.files]);
        },
      }
    : {};

  return (
    <div
      ref={pageRef}
      className="dot-grid relative min-h-full overflow-x-clip"
      // Selection in the viewer's own colour, as on "Reviews".
      style={
        {
          '--selection': accentColor(user.color),
          '--on-selection': isLightAccent(user.color)
            ? 'var(--color-on-primary)'
            : 'var(--color-primary-hover)',
        } as CSSProperties
      }
      onMouseDown={marquee.onMouseDown}
      onContextMenu={onPageContextMenu}
      {...dropHandlers}
    >
      <title>{`Workspace | ${workspace.name} | Slider`}</title>
      <AppHeader />

      <main className="flex flex-col gap-6 px-4 pt-2 pb-16 md:px-14">
        <PageHeader
          titleRow
          title={<WorkspaceViews workspaceId={workspace.id} current="material" />}
        />

        <MaterialToolbar
          kind={kind}
          onKindChange={setKind}
          counts={{
            all: own.length + SLIDER_FAMILIES.length,
            'slider-fonts': SLIDER_FAMILIES.length,
            'workspace-fonts': own.length,
          }}
          query={query}
          onQueryChange={setQuery}
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
                aria-label="Neue Schrift"
                loading={upload.isPending}
                onClick={pickFiles}
              >
                <span className="max-sm:hidden">
                  {upload.isPending ? 'Wird hochgeladen …' : 'Neue Schrift'}
                </span>
              </Button>
            )
          }
        />
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".ttf,.otf,.zip,font/ttf,font/otf,application/zip"
          className="hidden"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            // The same files twice in a row must fire `change` again.
            event.target.value = '';
            send(files);
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
          {showsOwn && fonts.isPending ? (
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
                  <Button icon="upload" loading={upload.isPending} onClick={pickFiles}>
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
              selected={selection.selected}
              onModifiedClick={selection.onModifiedClick}
              selectionActions={selectionActions}
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
          Loslassen zum Hochladen – TTF, OTF oder Zip
        </span>
      </div>

      {pageMenuAt && (
        <ContextMenu
          label="Aktionen für die Übersicht"
          actions={pageActions}
          at={pageMenuAt}
          onClose={() => setPageMenuAt(null)}
        />
      )}
      {marquee.active && (
        <div
          ref={marqueeBoxRef}
          data-selection-box
          aria-hidden
          className="pointer-events-none absolute z-(--z-panel) rounded-mark border border-(--selection) bg-(--selection)/15"
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={
          removing?.length === 1
            ? `${removing[0]} entfernen?`
            : `${pluralize(removing?.length ?? 0, 'Schrift', 'Schriften')} entfernen?`
        }
        description="Eine Schrift, die eine Review noch verwendet, lässt sich erst entfernen, wenn diese Review gelöscht ist."
        confirmLabel="Entfernen"
        confirmIcon="delete"
        pending={removePending}
        error={removeError ?? undefined}
        onConfirm={() => void confirmRemove()}
      />
      <Toast toast={toast} />
    </div>
  );
}
