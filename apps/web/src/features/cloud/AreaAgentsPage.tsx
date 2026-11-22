import { Navigate, useParams } from 'react-router';
import { routes } from '@/lib/routes';
import { AreaAgents } from './components/AreaAgents';
import { AreaDot } from './components/AreaDot';
import { AreaViews } from './components/AreaViews';
import { CloudPage } from './components/CloudPage';
import { useCloud } from './hooks/useCloud';
import { areaTrail, isWorkspaceOwn } from './lib/areas';

/**
 * An area's agents: the view beside its files, under the same title. Everyone who sees the
 * area reads along; the workspace's own area has none.
 */
export function Component() {
  const { areaId } = useParams();
  const ui = useCloud();
  const { workspace } = ui;
  const areas = ui.home?.areas;
  const area = areas?.find((each) => each.id === areaId) ?? null;
  // Gone, not one's to see, or the workspace's own: the area's own page says so.
  if (areas && (!area || isWorkspaceOwn(area))) {
    return <Navigate to={routes.cloudArea(workspace.id, areaId ?? '')} replace />;
  }
  return (
    <CloudPage
      // The area's name first: the Cloud app names the tab by it, and this is the area's tab still.
      docTitle={area ? `${area.name} | Agenten` : 'Agenten'}
      title={area ? <AreaViews area={area} current="agents" /> : ' '}
      lead={area ? <AreaDot color={area.color} size="lg" /> : null}
      crumbs={
        area
          ? [...areaTrail(workspace.id, areas ?? [], area).slice(0, -1), { label: area.name }]
          : undefined
      }
      nodes={[]}
    >
      {() => (area ? <AreaAgents area={area} /> : null)}
    </CloudPage>
  );
}
