import { useQueries } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { cloudAccessAtLeast, type CloudArea, type CloudNode } from '@slider/shared';
import { cloudListQuery, useCloudList, type CloudPlace } from '@/lib/api';
import { pluralize } from '@/lib/format';
import { routes } from '@/lib/routes';
import { AvatarStack, Button, Icon, Menu, type MenuAction } from '@/ui';
import { AreaViews } from './components/AreaViews';
import { AreaMark } from './components/AreaMark';
import { CloudPage, type Crumb } from './components/CloudPage';
import { ColumnBrowser, type BrowserColumn } from './components/ColumnBrowser';
import { Empty, LoadFailed } from './components/Empty';
import { FileBrowser, FileBrowserSkeleton } from './components/FileBrowser';
import { FileIcon } from './components/FileIcon';
import { ListToolbar } from './components/ListToolbar';
import { useCloud, type CloudTarget } from './hooks/useCloud';
import { areaTrail, areasUnder, canHaveAreasUnder, isWorkspaceOwn } from './lib/areas';
import { useStoredChoice } from './hooks/useStoredChoice';
import { CLOUD_SORTS, CLOUD_VIEWS, filterNodes, sortNodes, type TypeFilter } from './lib/kinds';

/**
 * A place and what lies in it: one's own files, an area, or a folder in either – as rows, as
 * tiles (its folders then as cards) or as columns one steps through. What happened is told on
 * „Zuletzt“ alone.
 */
/** A place of its own each: the filter picked in one does not follow into the next. */
export function Component() {
  const { areaId, folderId } = useParams();
  return <Place key={`${areaId ?? ''}:${folderId ?? ''}`} />;
}

function Place() {
  const { areaId, folderId } = useParams();
  const ui = useCloud();
  const { workspace } = ui;
  const place: CloudPlace = { scope: 'folder', folder: folderId, area: areaId };
  const listing = useCloudList(workspace.id, place);
  const [filter, setFilter] = useState<TypeFilter>('all');
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
  // While its files load, an area's top says it from the area: „Hochladen“ stands at once and the
  // head does not shift when they come.
  const editable = cloudAccessAtLeast(data?.access ?? (area && !data ? area.access : null), 'edit');
  const atAreaTop = Boolean(area) && !folder;

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
  const target: CloudTarget | null =
    (data || area) && editable
      ? folder
        ? { parentId: folder.id, name: folder.name }
        : area
          ? { areaId: area.id, name: area.name }
          : { name: 'Meine Dateien' }
      : null;

  const under = atAreaTop && area ? areasUnder(areas, area) : [];
  const crumbs: Crumb[] = [];
  if (data) {
    if (data.sharedBy) {
      crumbs.push({ label: 'Geteilt', to: routes.cloudShared(workspace.id) });
    } else if (area) {
      // The workspace first, never „Bereiche“ (one of its tabs); the area itself where a folder
      // of it is open.
      const trail = areaTrail(workspace.id, areas, area);
      crumbs.push(...(folder ? trail : trail.slice(0, -1)));
    } else if (folder) {
      crumbs.push({ label: 'Meine Dateien', to: routes.cloudOwn(workspace.id) });
    } else {
      // „Meine Dateien“ itself, as Entwürfe and Mail: the workspace's name over it.
      crumbs.push({ label: workspace.name });
    }
    for (const each of data.path.slice(0, -1)) {
      crumbs.push({ label: each.name, to: routes.cloudFolder(workspace.id, each.id) });
    }
    if (crumbs.length > 0) crumbs.push({ label: name });
  } else if (atAreaTop && area) {
    // Its files still on their way: the path stands already, as it will.
    const above = areaTrail(workspace.id, areas, area).slice(0, -1);
    if (above.length > 0) crumbs.push(...above, { label: name });
  } else if (!areaId && !folderId) {
    crumbs.push({ label: workspace.name }, { label: name });
  }

  const all = data?.nodes ?? [];
  const shown = sortNodes(filterNodes(all, filter), sort);
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
  const columns: BrowserColumn[] = [{ id: 'top', nodes: inColumns(all) }];
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
      docTitle={name}
      title={
        atAreaTop && area ? (
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
              mode="folder"
              view={view}
              selection={selection}
              folderCards={filter === 'all' && view === 'tiles'}
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
