import { useQueries } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { cloudAccessAtLeast, searchFold, type CloudArea, type CloudNode } from '@slider/shared';
import { cloudListQuery, useCloudList, type CloudPlace } from '@/lib/api';
import { pluralize } from '@/lib/format';
import { routes } from '@/lib/routes';
import { ViewSearch } from '@/features/workspaces';
import { AvatarStack, Button, Icon, Menu, type MenuAction } from '@/ui';
import { AreaViews } from './components/AreaViews';
import { AreaMark } from './components/AreaMark';
import { useChatFileFiling } from './components/ChatFileFiling';
import { CloudPage, type Crumb } from './components/CloudPage';
import { ColumnBrowser, type BrowserColumn } from './components/ColumnBrowser';
import { Empty, LoadFailed } from './components/Empty';
import { FileBrowser, FileBrowserSkeleton } from './components/FileBrowser';
import { FileIcon } from './components/FileIcon';
import { ListToolbar } from './components/ListToolbar';
import { ScopeTabs } from './components/ScopeTabs';
import { OWN_FILES, useCloud, type CloudTarget } from './hooks/useCloud';
import { areaTrail, areasUnder, canHaveAreasUnder, isWorkspaceOwn } from './lib/areas';
import { useStoredChoice } from './hooks/useStoredChoice';
import { useOpenedFrom } from './hooks/useOpenedFrom';
import { CLOUD_SORTS, CLOUD_VIEWS, filterNodes, sortNodes, type TypeFilter } from './lib/kinds';
import { ALL_SCOPE, OWN_SCOPE, scopeTabs, useScope, WORKSPACE_SCOPE } from './lib/scopes';

/**
 * A place and what lies in it: one's own files, an area, or a folder in either – as rows, as
 * tiles (its folders then as cards) or as columns one steps through. What happened is told on
 * „Zuletzt“ alone.
 */
/** A place of its own each: the filter picked in one does not follow into the next. */
export function Component() {
  const { areaId, folderId } = useParams();
  return areaId || folderId ? (
    <Place key={`${areaId ?? ''}:${folderId ?? ''}`} areaId={areaId} folderId={folderId} />
  ) : (
    <Overview />
  );
}

/**
 * „Dateien“: tabs as the title, as „Agenten“ and „Aufgaben“ – all one reaches (each with where it
 * lies), one's own, the workspace's, then each area's: what lies at its top.
 */
function Overview() {
  const ui = useCloud();
  const areas = ui.home?.areas ?? [];
  const { tabs, current } = scopeTabs(areas, useScope(), {
    own: 'Nur du siehst sie',
    workspace: 'Alle im Workspace sehen sie',
  });
  const root = areas.find((area) => isWorkspaceOwn(area));
  // The workspace's own not known (yet): all of it, never one's own under its name.
  const scope = current === WORKSPACE_SCOPE && !root ? ALL_SCOPE : current;
  const areaId =
    scope === WORKSPACE_SCOPE
      ? root?.id
      : scope === ALL_SCOPE || scope === OWN_SCOPE
        ? undefined
        : scope;
  return (
    <Place
      key={scope}
      areaId={areaId}
      all={scope === ALL_SCOPE}
      tabs={<ScopeTabs tabs={tabs} current={current} />}
    />
  );
}

function Place({
  areaId,
  folderId,
  all: across = false,
  tabs,
}: {
  areaId?: string;
  folderId?: string;
  /** Everything one reaches, each with where it lies („Alle“ of „Dateien“). */
  all?: boolean;
  /** On „Dateien“: its tabs stand as the title, an area's own things (people, menu) stay on its page. */
  tabs?: ReactNode;
}) {
  const ui = useCloud();
  const { workspace } = ui;
  const overview = Boolean(tabs);
  const place: CloudPlace = across
    ? { scope: 'all' }
    : { scope: 'folder', folder: folderId, area: areaId };
  const listing = useCloudList(workspace.id, place);
  const [filter, setFilter] = useState<TypeFilter>('all');
  // The page's own field: only what lies here with it in its name.
  const [query, setQuery] = useState('');
  const needle = searchFold(query.trim());
  const [sort, setSort] = useStoredChoice('slider.cloud.sort', CLOUD_SORTS, 'name');
  const [view, setView] = useStoredChoice('slider.cloud.view', CLOUD_VIEWS, 'list');

  const data = listing.data;
  const areas = ui.home?.areas ?? [];
  // An area's top is known before its files are: its tabs stand at once, and the switch from its
  // chat morphs them already the first time.
  const area =
    data?.area ??
    (!data && areaId && !folderId ? areas.find((each) => each.id === areaId) : null) ??
    null;
  const folder = data?.folder ?? null;
  // In an area's „Chat-Dateien“: where the AI would rather put each file, one click away.
  const filing = useChatFileFiling(folder);
  // While its files load, an area's top says it from the area: „Hochladen“ stands at once and the
  // head does not shift when they come.
  const editable = cloudAccessAtLeast(data?.access ?? (area && !data ? area.access : null), 'edit');
  // On „Dateien“ an area's tab is its files alone: its views, people and menu stand on its page.
  const atAreaTop = Boolean(area) && !folder && !overview;

  // Not loaded (yet, or the server is away): an area's page is still called by its name, a
  // folder's by none – never „Meine Dateien“, which it is not.
  const name =
    folder?.name ??
    area?.name ??
    (areaId
      ? (areas.find((each) => each.id === areaId)?.name ?? '')
      : folderId && !data
        ? ''
        : data?.sharedBy
          ? 'Geteilt'
          : 'Meine Dateien');
  const target: CloudTarget | null = across
    ? // All of it: what comes in goes to one's own, as „Neu“ from here.
      ui.home?.ownFiles !== false
      ? OWN_FILES
      : null
    : (data || area) && editable
      ? folder
        ? { parentId: folder.id, name: folder.name }
        : area
          ? { areaId: area.id, name: area.name }
          : { name: 'Meine Dateien' }
      : null;

  const under = atAreaTop && area ? areasUnder(areas, area) : [];
  // A folder opened from „Dateien“ (any of its tabs) stays there: „Dateien › … › <Ordner>“, that
  // row lit – from its area it goes through the area.
  const folders = routes.cloudFolder(workspace.id, '');
  const from = useOpenedFrom(folderId ? [routes.cloudFiles(workspace.id)] : [], (path) =>
    path.startsWith(folders),
  );
  const crumbs: Crumb[] = [];
  if (overview) {
    // „Dateien“ itself, as „Agenten“: its row's name alone – not under the workspace, whose
    // name stands for its own area.
    crumbs.push({ label: 'Dateien' });
  } else if (data) {
    if (from) {
      crumbs.push({ label: 'Dateien', to: from });
    } else if (data.sharedBy) {
      crumbs.push({ label: 'Geteilt', to: routes.cloudShared(workspace.id) });
    } else if (area) {
      // The workspace first, never „Bereiche“ (one of its tabs); the area itself where a folder
      // of it is open. The workspace's own at its top: its name alone, as on every page.
      const trail = areaTrail(workspace.id, areas, area);
      crumbs.push(...(folder ? trail : trail.slice(0, -1)));
    } else if (folder) {
      crumbs.push({ label: 'Meine Dateien', to: routes.cloudOwn(workspace.id), into: OWN_FILES });
    }
    for (const each of data.path.slice(0, -1)) {
      crumbs.push({
        label: each.name,
        to: routes.cloudFolder(workspace.id, each.id),
        // Dragged onto it, files go into that folder – as onto a folder in the list.
        into: editable ? { parentId: each.id, name: each.name } : undefined,
      });
    }
    crumbs.push({ label: name });
  } else if (atAreaTop && area) {
    // Its files still on their way: the path stands already, as it will.
    crumbs.push(...areaTrail(workspace.id, areas, area).slice(0, -1), { label: name });
  }

  // The side bar lights where it lies, as the path starts: an area's folder its area, one's own
  // „Dateien“, a shared one „Geteilt“ – on „Dateien“ itself its address says it.
  const barRow = overview
    ? undefined
    : from
      ? routes.cloudFiles(workspace.id)
      : data?.sharedBy
        ? routes.cloudShared(workspace.id)
        : area
          ? routes.cloudArea(workspace.id, area.id)
          : folder
            ? routes.cloudFiles(workspace.id)
            : undefined;

  const all = data?.nodes ?? [];
  const named = needle ? all.filter((node) => searchFold(node.name).includes(needle)) : all;
  const shown = sortNodes(filterNodes(named, filter), sort);
  // Filtered by kind, folders step aside: the chips ask for files.
  const visible = filter === 'all' ? shown : shown.filter((node) => node.kind === 'file');

  // As columns: the folders opened one after the other, each one's content beside it. Folders
  // stay whatever the filter – they are the way on.
  const [trail, setTrail] = useState<readonly string[]>([]);
  const inColumns = (nodes: readonly CloudNode[]) =>
    sortNodes(
      filter === 'all'
        ? nodes
        : [...nodes.filter((node) => node.kind === 'folder'), ...filterNodes(nodes, filter)],
      sort,
    );
  const asColumns = view === 'columns';
  const opened = useQueries({
    queries: (asColumns ? trail : []).map((id) =>
      cloudListQuery(workspace.id, { scope: 'folder', folder: id, area: areaId }),
    ),
  });
  const columns: BrowserColumn[] = [{ id: 'top', nodes: inColumns(named) }];
  for (const [depth, id] of (asColumns ? trail : []).entries()) {
    // Gone from the column before (moved, deleted, filtered away): the columns end there.
    if (!columns[depth]?.nodes?.some((node) => node.id === id)) break;
    const list = opened[depth];
    columns.push({
      id,
      nodes: list?.data ? inColumns(list.data.nodes) : null,
      error: list?.isLoadingError ? list.error.message : undefined,
    });
  }
  const pickable = asColumns ? columns.flatMap((column) => column.nodes ?? []) : visible;
  // Everything in here, the folders' files included.
  const fileCount = all.reduce(
    (sum, node) => sum + (node.kind === 'file' ? 1 : (node.fileCount ?? 0)),
    0,
  );

  // Only what nothing else on the page says: how many files stands on „Alle“ below, who sees an
  // area by its people beside the title (and the lock in the side bar).
  const subtitle = !data
    ? null
    : atAreaTop && area
      ? area.description || null
      : data.sharedBy
        ? `Geteilt von ${data.sharedBy.name}`
        : null;

  const areaActions: MenuAction[] =
    area && atAreaTop && area.access === 'manage'
      ? [
          ...(canHaveAreasUnder(areas, area)
            ? [
                {
                  label: 'Neuer Unterbereich',
                  icon: 'workspaces',
                  onSelect: () => ui.newArea(area),
                } satisfies MenuAction,
              ]
            : []),
          // The workspace's own: its people are the workspace's, and it stays.
          ...(area.root
            ? []
            : [
                {
                  label: 'Personen …',
                  icon: 'groups',
                  onSelect: () => ui.areaPeople(area),
                } satisfies MenuAction,
              ]),
          { label: 'Bereich bearbeiten', icon: 'edit', onSelect: () => ui.editArea(area) },
          ...(isWorkspaceOwn(area)
            ? []
            : [
                {
                  label: 'Löschen',
                  icon: 'delete',
                  tone: 'danger',
                  onSelect: () => ui.deleteArea(area),
                } satisfies MenuAction,
              ]),
        ]
      : [];

  return (
    <CloudPage
      docTitle={overview ? 'Dateien' : name}
      title={
        tabs ? (
          tabs
        ) : atAreaTop && area ? (
          // An area's views: its files, its agents and its chat beside them.
          <AreaViews area={area} current="files" />
        ) : listing.isPending && !name ? (
          ' '
        ) : (
          name
        )
      }
      lead={
        atAreaTop && area ? (
          <AreaMark area={area} size="lg" />
        ) : folder ? (
          <FileIcon kind="folder" type={null} />
        ) : null
      }
      crumbs={crumbs}
      barRow={barRow}
      subtitle={subtitle}
      nodes={pickable}
      target={target}
      actions={
        <>
          {atAreaTop && area && area.members.length > 0 && (
            <AvatarStack authors={area.members} max={4} size={28} interactive />
          )}
          {folder && editable && ui.home?.sharing && (
            <Button variant="secondary" icon="personAdd" onClick={() => ui.share(folder)}>
              Teilen
            </Button>
          )}
          {target && (
            <Button variant="secondary" icon="upload" onClick={() => ui.pickAndUpload(target)}>
              Hochladen
            </Button>
          )}
          {areaActions.length > 0 && (
            <Menu label={`Aktionen für den Bereich ${area?.name ?? ''}`} actions={areaActions} />
          )}
        </>
      }
      toolbar={
        <ListToolbar
          search={
            <ViewSearch
              label={`${across ? 'Dateien' : name || 'Ordner'} durchsuchen`}
              value={query}
              onChange={setQuery}
            />
          }
          filter={filter}
          onFilterChange={setFilter}
          count={all.length > 0 ? fileCount : undefined}
          sort={sort}
          onSortChange={setSort}
          view={view}
          onViewChange={setView}
          columns
        />
      }
    >
      {(selection) => (
        <>
          {under.length > 0 && <AreasUnder areas={under} />}
          {listing.isPending ? (
            <FileBrowserSkeleton view={view} />
          ) : listing.isLoadingError ? (
            <LoadFailed message={listing.error.message} onRetry={() => void listing.refetch()} />
          ) : all.length === 0 ? (
            <Empty
              icon={folder ? 'folderOpen' : 'cloud'}
              title="Noch nichts hier"
              message={
                target
                  ? 'Zieh Dateien oder ganze Ordner hierher oder lade sie über „Hochladen“ hoch.'
                  : 'Hier wurde noch nichts abgelegt.'
              }
              action={
                target && (
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      icon="upload"
                      onClick={() => ui.pickAndUpload(target)}
                    >
                      Dateien hochladen
                    </Button>
                    <Button variant="soft" icon="folder" onClick={() => ui.newFolder(target)}>
                      Neuer Ordner
                    </Button>
                  </div>
                )
              }
            />
          ) : needle && named.length === 0 ? (
            <Empty
              icon="search"
              title={`Keine Treffer für „${query.trim()}“`}
              message="Gesucht wird in den Namen von dem, was hier liegt – überall sucht die Suche links."
            />
          ) : asColumns ? (
            <ColumnBrowser
              columns={columns}
              trail={trail}
              selection={selection}
              onPick={(depth, node) =>
                setTrail((now) => [
                  ...now.slice(0, depth),
                  ...(node.kind === 'folder' ? [node.id] : []),
                ])
              }
            />
          ) : visible.length === 0 ? (
            <p className="flex items-center gap-2 py-10 text-body text-fg-subtle">
              <Icon name="filterList" size={18} />
              Hier liegt nichts von dieser Art.
            </p>
          ) : (
            <FileBrowser
              nodes={visible}
              // All of it: where each lies beside it, as „Geteilt“.
              mode={across ? 'across' : 'folder'}
              view={view}
              selection={selection}
              aside={filing}
            />
          )}
        </>
      )}
    </CloudPage>
  );
}

/** The areas under the open one, above what lies in it: the way on, as in the side bar. */
function AreasUnder({ areas }: { areas: readonly CloudArea[] }) {
  return (
    <nav aria-label="Unterbereiche">
      <ul className="flex flex-wrap gap-2">
        {areas.map((area) => (
          <li key={area.id}>
            <Link
              to={routes.cloudArea(area.workspaceId, area.id)}
              className="glass flex h-11 max-w-72 items-center gap-2.5 rounded-panel pr-4 pl-3 text-body text-fg outline-none transition-colors hover:bg-glass-hover focus-visible:ring-2 focus-visible:ring-focus"
            >
              <AreaMark area={area} />
              <span className="min-w-0 truncate font-medium">{area.name}</span>
              {area.visibility === 'members' && (
                <Icon
                  name="lock"
                  size={12}
                  className="shrink-0 text-fg-faint"
                  label="Nur für seine Personen"
                />
              )}
              <span className="shrink-0 text-xs text-fg-muted">
                {pluralize(area.fileCount, 'Datei', 'Dateien')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
