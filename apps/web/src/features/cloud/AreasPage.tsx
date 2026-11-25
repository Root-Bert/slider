import { useState } from 'react';
import { Link } from 'react-router';
import type { CloudArea } from '@slider/shared';
import { formatFileSize, formatRelativeTime, pluralize } from '@/lib/format';
import { routes } from '@/lib/routes';
import {
  Avatar,
  Badge,
  Button,
  cn,
  GlassPanel,
  Icon,
  Menu,
  SegmentedControl,
  TextField,
  type MenuAction,
} from '@/ui';
import { AreaMark } from './components/AreaMark';
import { AreaViews } from './components/AreaViews';
import { CloudPage } from './components/CloudPage';
import { Empty } from './components/Empty';
import { PeopleGraph } from './components/PeopleGraph';
import { useCloud } from './hooks/useCloud';
import { useStoredChoice } from './hooks/useStoredChoice';
import { canHaveAreasUnder, isWorkspaceOwn } from './lib/areas';
import { peopleFound } from './lib/people-graph';

/** How many of an area's people its card names before „+ n weitere“. */
const SHOWN_PEOPLE = 5;

/** The two ways to look at the same tree: what lies in the areas, or who works in them. */
const VIEWS = [
  { value: 'folders', label: 'Ordner', icon: 'folder' },
  { value: 'people', label: 'Personen', icon: 'groups' },
] as const;
type View = (typeof VIEWS)[number]['value'];
const VIEW_KEY = 'slider.cloud.areasView';

/** The lines of the tree, as wide and as light as a hairline. */
const LINE = 'bg-hairline-strong';
/** A branch: its tile, a stub up to the line of its siblings, and that line's two halves. */
const BRANCH = cn(
  'relative flex flex-col items-center px-2 pt-6',
  'before:absolute before:top-0 before:right-1/2 before:left-0 before:h-px before:bg-hairline-strong first-of-type:before:hidden',
  'after:absolute after:top-0 after:right-0 after:left-1/2 after:h-px after:bg-hairline-strong last:after:hidden',
);

/** What can be done with an area, for whoever manages it – the same in both views. */
function areaActions(
  ui: ReturnType<typeof useCloud>,
  area: CloudArea,
  areas: readonly CloudArea[],
): MenuAction[] {
  return area.access === 'manage'
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
}

function AreaCard({
  area,
  areas,
  view,
}: {
  area: CloudArea;
  areas: readonly CloudArea[];
  view: View;
}) {
  const ui = useCloud();
  const actions = areaActions(ui, area, areas);
  const shown = area.members.slice(0, SHOWN_PEOPLE);
  return (
    <div className="glass group relative flex w-60 flex-col gap-3 rounded-panel p-4 text-left transition-colors hover:bg-glass-hover has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-focus">
      <div className="flex items-start gap-3">
        <AreaMark area={area} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <Link
              to={routes.cloudArea(ui.workspace.id, area.id)}
              className="truncate text-base font-semibold text-fg outline-none after:absolute after:inset-0"
            >
              {area.name}
            </Link>
            {area.visibility === 'members' && (
              <Icon
                name="lock"
                size={14}
                className="shrink-0 text-fg-subtle"
                label="Nur für seine Personen"
              />
            )}
          </span>
          <span className="truncate text-xs text-fg-muted">
            {view === 'people' ? (
              pluralize(area.members.length, 'Person', 'Personen')
            ) : (
              <>
                {pluralize(area.fileCount, 'Datei', 'Dateien')}
                {area.sizeBytes > 0 && ` | ${formatFileSize(area.sizeBytes)}`}
              </>
            )}
          </span>
        </div>
        {actions.length > 0 && (
          <span className="relative z-(--z-raised) -mt-1 -mr-2">
            <Menu label={`Aktionen für den Bereich ${area.name}`} actions={actions} />
          </span>
        )}
      </div>
      {view === 'folders' && (area.description || area.activeAt) && (
        <p className="line-clamp-3 text-xs text-fg-muted">
          {area.description}
          {area.description && area.activeAt && ' | '}
          {area.activeAt && `zuletzt ${formatRelativeTime(area.activeAt)}`}
        </p>
      )}
      {view === 'people' && (
        <ul className="flex flex-col gap-0.5 border-t border-hairline pt-3">
          {shown.map((member) => (
            <li key={member.id} className="flex h-10 items-center gap-3">
              <Avatar author={member} size={28} nativeTitle={false} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body font-medium text-fg">
                  {member.id === ui.userId ? 'Du' : member.name}
                </span>
                {member.title && (
                  <span className="truncate text-xs text-fg-subtle">{member.title}</span>
                )}
              </span>
              {member.role === 'viewer' && <Badge>Betrachter</Badge>}
            </li>
          ))}
          {area.members.length > shown.length && (
            <li className="pt-1 text-xs text-fg-subtle">
              und {area.members.length - shown.length} weitere
            </li>
          )}
          {area.members.length === 0 && (
            <li className="py-1 text-xs text-fg-subtle">Noch niemand benannt.</li>
          )}
        </ul>
      )}
    </div>
  );
}

/** The areas under one (`null`: at the top), each with its own under it, joined by lines. */
function Branches({
  parentId,
  areas,
  view,
}: {
  parentId: string | null;
  areas: readonly CloudArea[];
  view: View;
}) {
  const known = new Set(areas.map((area) => area.id));
  // As `areaTree` has it: under one that is not in the list, an area stands at the top.
  const under = areas.filter(
    (area) =>
      (area.parentId !== null && known.has(area.parentId) ? area.parentId : null) === parentId,
  );
  if (under.length === 0) return null;
  return (
    <ul className="relative flex justify-center pt-6">
      <span aria-hidden className={cn('absolute top-0 left-1/2 h-6 w-px', LINE)} />
      {under.map((area) => (
        <li key={area.id} className={BRANCH}>
          <span aria-hidden className={cn('absolute top-0 left-1/2 h-6 w-px', LINE)} />
          <AreaCard area={area} areas={areas} view={view} />
          <Branches parentId={area.id} areas={areas} view={view} />
        </li>
      ))}
    </ul>
  );
}

/** „Bereiche“: every area open to the caller, with its people – who works where. */
export function Component() {
  const ui = useCloud();
  // The workspace's own area is the tree's top, not one of these.
  const root = ui.home?.areas.find((area) => area.root);
  const areas = (ui.home?.areas ?? []).filter((area) => !isWorkspaceOwn(area));
  const people = new Set(areas.flatMap((area) => area.members.map((member) => member.id)));
  const [view, setView] = useStoredChoice<View>(
    VIEW_KEY,
    VIEWS.map((each) => each.value),
    'folders',
  );
  // Typed where it stands, in the bar beside the views: lights up the net's people.
  const [query, setQuery] = useState('');
  const words = query.trim().toLowerCase();
  // Who is in none of the areas is found too: the workspace's own area holds everyone.
  const found = peopleFound(root ? [...areas, root] : areas, query);
  return (
    <CloudPage
      docTitle={root ? `${root.name} | Bereiche` : 'Bereiche'}
      // A tab of the workspace's own area, beside its files and its chat: its name above, as there.
      title={root ? <AreaViews area={root} current="areas" /> : 'Bereiche'}
      crumbs={root ? [{ label: root.name }] : undefined}
      barRow={root ? routes.cloudArea(ui.workspace.id, root.id) : undefined}
      lead={root ? <AreaMark area={root} size="lg" /> : null}
      nodes={[]}
      // The net takes the room the page has and moves in itself; the tree scrolls with the page.
      fill={view === 'people' && areas.length > 0}
      actions={
        ui.home?.canCreateAreas && (
          <Button variant="secondary" icon="add" onClick={() => ui.newArea()}>
            Neuer Bereich
          </Button>
        )
      }
    >
      {() => (
        <>
          {!ui.home ? (
            <div aria-hidden className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
              {[0, 1, 2].map((card) => (
                <div key={card} className="skeleton h-56 rounded-panel" />
              ))}
            </div>
          ) : areas.length === 0 ? (
            <Empty
              icon="workspaces"
              title="Noch kein Bereich"
              message="Ein Bereich ist der Ort eines Teams: mit Farbe, Leuten und allem, woran es arbeitet."
              action={
                ui.home.canCreateAreas && (
                  <Button variant="primary" icon="add" onClick={() => ui.newArea()}>
                    Neuer Bereich
                  </Button>
                )
              }
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <GlassPanel className="p-1">
                  <SegmentedControl
                    label="Ansicht"
                    segments={VIEWS}
                    value={view}
                    onChange={setView}
                  />
                </GlassPanel>
                {view === 'people' && (
                  <div className="ml-auto flex items-center gap-3">
                    {words !== '' && (
                      <span className="text-xs text-fg-muted" role="status">
                        {found === 0 ? 'Niemand gefunden' : pluralize(found, 'Person', 'Personen')}
                      </span>
                    )}
                    <div className="w-56">
                      <TextField
                        aria-label="Person suchen"
                        placeholder="Person suchen"
                        icon="search"
                        autoComplete="off"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
              {/* People: a net to move and zoom in – an area can have hundreds of them. */}
              {view === 'people' && (
                <PeopleGraph
                  areas={areas}
                  everyone={root?.members ?? []}
                  query={query}
                  workspace={ui.workspace}
                  userId={ui.userId}
                  areaTo={(area) => routes.cloudArea(ui.workspace.id, area.id)}
                  actionsFor={(area) => areaActions(ui, area, areas)}
                />
              )}
              {/* Wider than the page it scrolls sideways; `w-max` keeps the tree in one piece. */}
              <div className={cn('-mx-3 overflow-x-auto px-3 pb-4', view === 'people' && 'hidden')}>
                <div className="mx-auto flex w-max flex-col items-center">
                  {/* The workspace itself: an area as those under it, to open as they are. */}
                  {root ? (
                    <AreaCard area={root} areas={ui.home.areas} view={view} />
                  ) : (
                    <div className="glass flex items-center gap-3 rounded-panel px-4 py-3">
                      <Icon name="workspaces" size={20} className="text-fg-muted" />
                      <span className="flex flex-col">
                        <span className="text-base font-semibold text-fg">{ui.workspace.name}</span>
                        <span className="text-xs text-fg-muted">
                          {view === 'people'
                            ? pluralize(people.size, 'Person', 'Personen')
                            : pluralize(areas.length, 'Bereich', 'Bereiche')}
                        </span>
                      </span>
                    </div>
                  )}
                  <Branches parentId={null} areas={areas} view={view} />
                </div>
              </div>
            </>
          )}
        </>
      )}
    </CloudPage>
  );
}
