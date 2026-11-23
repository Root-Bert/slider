import { Navigate, useParams } from 'react-router';
import { routes } from '@/lib/routes';
import { AreaMark } from './components/AreaMark';
import { AreaViews } from './components/AreaViews';
import { CloudPage } from './components/CloudPage';
import { TodoList } from './components/todos/TodoList';
import { useCloud } from './hooks/useCloud';
import { areaTrail } from './lib/areas';

/** An area's to-dos: its plan, by status, beside its files under the same title. */
export function Component() {
  const { areaId } = useParams();
  const ui = useCloud();
  const { workspace } = ui;
  const areas = ui.home?.areas;
  const area = areas?.find((each) => each.id === areaId) ?? null;
  // Gone or not one's to see: the area's own page says so.
  if (areas && !area) return <Navigate to={routes.cloudArea(workspace.id, areaId ?? '')} replace />;
  return (
    <CloudPage
      // The area's name first: the Cloud app names the tab by it, and this is the area's tab still.
      docTitle={area ? `${area.name} | Aufgaben` : 'Aufgaben'}
      title={area ? <AreaViews area={area} current="todos" /> : ' '}
      lead={area ? <AreaMark area={area} size="lg" /> : null}
      crumbs={
        area
          ? [...areaTrail(workspace.id, areas ?? [], area).slice(0, -1), { label: area.name }]
          : undefined
      }
      nodes={[]}
    >
      {() => (area ? <TodoList area={area} /> : null)}
    </CloudPage>
  );
}
