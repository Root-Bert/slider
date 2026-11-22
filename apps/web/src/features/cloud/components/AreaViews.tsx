import type { CloudArea } from '@slider/shared';
import { routes } from '@/lib/routes';
import { ViewTitles, VIEW_NAMES } from '@/features/workspaces';

/**
 * An area's title: its name, then „Chat“, „Aufgaben“ and „Agenten“ beside it – its views, as
 * „Präsentationen“ and „Bibliothek“ are a workspace's in Slider. The open one is large, the
 * others links to it. The workspace's own area has no agents of its own: its third is
 * „Bereiche“, the tree of the areas in it (the user, 2026-11-19: „bereiche soll ein "tab" in
 * mein workspace sein neben Chat“).
 */
export function AreaViews({
  area,
  current,
}: {
  area: CloudArea;
  current: 'files' | 'agents' | 'chat' | 'todos' | 'areas';
}) {
  return (
    <ViewTitles
      current={current}
      views={[
        {
          key: 'files',
          label: area.name,
          to: routes.cloudArea(area.workspaceId, area.id),
          name: VIEW_NAMES.first,
        },
        {
          key: 'chat',
          label: 'Chat',
          to: routes.cloudAreaChat(area.workspaceId, area.id),
          name: VIEW_NAMES.second,
        },
        {
          key: 'todos',
          label: 'Aufgaben',
          to: routes.cloudAreaTodos(area.workspaceId, area.id),
          name: VIEW_NAMES.todos,
        },
        area.root
          ? {
              key: 'areas',
              label: 'Bereiche',
              to: routes.cloudAreas(area.workspaceId),
              name: VIEW_NAMES.agents,
            }
          : {
              key: 'agents',
              label: 'Agenten',
              to: routes.cloudAreaAgents(area.workspaceId, area.id),
              name: VIEW_NAMES.agents,
            },
      ]}
    />
  );
}
