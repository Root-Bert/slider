import { Navigate, useLocation } from 'react-router';
import { useCloudList } from '@/lib/api';
import { routes } from '@/lib/routes';
import { CloudPage } from './components/CloudPage';
import { Empty } from './components/Empty';
import { AreaHome, PlaceHome, type PlaceChrome } from './components/PlaceHome';
import { ScopeTabs } from './components/ScopeTabs';
import { useCloud } from './hooks/useCloud';
import { isWorkspaceOwn } from './lib/areas';
import { NOTES_FOLDER, OWN_TEMPLATE } from './lib/pages';
import { OWN_SCOPE, scopeTabs, useScope, WORKSPACE_SCOPE } from './lib/scopes';

/*
 * „Seiten“, as Notion: each place has its page – one's own, the workspace's, each area's – the
 * tabs as the title. No list of pages: one lands on the place's Startseite (`PlaceHome`) and makes
 * pages from it („/Seite“), which lie beside it. One's own lie in „Meine Dateien“'s folder
 * „Notizen“, an area's at its top; they are files, shared, moved and deleted as files are.
 */

export function Component() {
  const ui = useCloud();
  const { workspace } = ui;
  const areas = ui.home?.areas ?? [];
  const { tabs, current } = scopeTabs(
    areas,
    useScope(),
    { own: 'Nur du siehst sie', workspace: 'Alle im Workspace sehen sie' },
    { all: false },
  );
  const chrome = {
    docTitle: 'Seiten',
    title: <ScopeTabs tabs={tabs} current={current} />,
    barRow: routes.cloudPages(workspace.id),
    crumbs: [{ label: 'Seiten' }],
  };
  if (current === OWN_SCOPE) return <OwnHome chrome={chrome} />;
  const areaId =
    current === WORKSPACE_SCOPE ? areas.find((each) => isWorkspaceOwn(each))?.id : current;
  if (!areaId) {
    return (
      <CloudPage {...chrome} nodes={[]}>
        {() => (
          <Empty
            icon="article"
            title="Keine Seite hier"
            message="Diesen Bereich gibt es nicht mehr."
          />
        )}
      </CloudPage>
    );
  }
  // Another place is another page (made or not).
  return <AreaHome key={areaId} areaId={areaId} chrome={chrome} />;
}

/** One's own Startseite: in „Notizen“, which the first one makes. */
function OwnHome({ chrome }: { chrome: PlaceChrome }) {
  const ui = useCloud();
  const { workspace } = ui;
  const ownFiles = ui.home?.ownFiles !== false;
  const top = useCloudList(workspace.id, { scope: 'folder' }, ownFiles);
  const folder =
    top.data?.nodes.find((node) => node.kind === 'folder' && node.name === NOTES_FOLDER) ?? null;
  const inside = useCloudList(
    workspace.id,
    { scope: 'folder', folder: folder?.id ?? '' },
    Boolean(folder),
  );
  if (!ownFiles) {
    return (
      <CloudPage {...chrome} nodes={[]}>
        {() => (
          <Empty
            icon="article"
            title="Keine eigenen Seiten"
            message="Eigene Dateien sind in diesem Workspace aus."
          />
        )}
      </CloudPage>
    );
  }
  return (
    <PlaceHome
      nodes={folder ? inside.data?.nodes : top.data ? [] : undefined}
      onTaken={() => void (folder ? inside.refetch() : top.refetch())}
      place={folder ? { areaId: null, parentId: folder.id } : null}
      newHome={folder ? { parentId: folder.id } : { path: NOTES_FOLDER }}
      template={OWN_TEMPLATE}
      canWrite
      chrome={chrome}
    />
  );
}

/** `/dateien/notizen` (before „Seiten“): leads there, with what the address said. */
export function Redirect() {
  const { search } = useLocation();
  const ui = useCloud();
  return <Navigate to={`${routes.cloudPages(ui.workspace.id)}${search}`} replace />;
}
