import {
  CLOUD_AREA_MAX_DEPTH,
  cloudAccessAtLeast,
  type CloudArea,
  type CloudAreaColor,
  type CloudNode,
} from '@slider/shared';
import { routes } from '@/lib/routes';

/** The areas as lists show them: each followed by those under it, with how deep it lies. */
export function areaTree<A extends Pick<CloudArea, 'id' | 'parentId'>>(
  areas: readonly A[],
): { area: A; depth: number }[] {
  const known = new Set(areas.map((area) => area.id));
  const listed: { area: A; depth: number }[] = [];
  const add = (parentId: string | null, depth: number) => {
    for (const area of areas) {
      // Under one that is not in the list (filtered out) it stands at the top.
      const under = area.parentId !== null && known.has(area.parentId) ? area.parentId : null;
      if (under !== parentId || depth >= CLOUD_AREA_MAX_DEPTH) continue;
      listed.push({ area, depth });
      add(area.id, depth + 1);
    }
  };
  add(null, 0);
  return listed;
}

/**
 * The way to an area, as crumbs: the workspace first (its own area – the root of every trail,
 * never „Bereiche“, which is one of its tabs), the areas it lies under, then the area itself.
 * Each a link to its page; the workspace's own area alone is just itself. Files dragged onto one
 * go into that area, where one may put them there.
 */
export function areaTrail(
  workspaceId: string,
  areas: readonly CloudArea[],
  area: CloudArea,
): { label: string; to: string; into?: { areaId: string; name: string } }[] {
  const root = areas.find((each) => each.root);
  const chain = area.root
    ? [area]
    : [...(root ? [root] : []), ...areasAbove(areas, area).filter((each) => !each.root), area];
  return chain.map((each) => ({
    label: each.name,
    to: routes.cloudArea(workspaceId, each.id),
    ...(cloudAccessAtLeast(each.access, 'edit')
      ? { into: { areaId: each.id, name: each.name } }
      : {}),
  }));
}

/**
 * The area an agent lies in: its own, or – shared in none – the workspace's own (whose „Agenten“
 * lists it); one's own private one without an area in none.
 */
export function agentArea(
  areas: readonly CloudArea[],
  agent: { areaId: string | null; shared: boolean } | undefined,
): CloudArea | null {
  if (!agent) return null;
  if (agent.areaId) return areas.find((each) => each.id === agent.areaId) ?? null;
  return agent.shared ? (areas.find((each) => each.root) ?? null) : null;
}

/**
 * Where an agent lies – the start of its page's path and the side bar's row lit there. Opened
 * from „Agenten“ it stays there: „Agenten › <Agent>“, that row lit. Else an area's
 * (the workspace's own too) lies in that area: its way from the workspace, then the area's
 * „Agenten“, the area's row lit – a step back is that tab, as one came. One's own, without an
 * area, lies under „Agenten“, whose row the address lights already. `agents`: that list.
 */
export function agentHome(
  workspaceId: string,
  areas: readonly CloudArea[],
  area: CloudArea | null,
  /** Opened from „Agenten“ (`useOpenedFrom`): the path stays there, as one came. */
  from: string | null = null,
): { crumbs: { label: string; to: string }[]; agents: string; barRow?: string } {
  if (from) return { crumbs: [{ label: 'Agenten', to: from }], agents: from };
  if (!area) {
    const agents = routes.cloudAgents(workspaceId);
    return { crumbs: [{ label: 'Agenten', to: agents }], agents };
  }
  const agents = routes.cloudAreaAgents(workspaceId, area.id);
  return {
    crumbs: [...areaTrail(workspaceId, areas, area), { label: 'Agenten', to: agents }],
    agents,
    barRow: routes.cloudArea(workspaceId, area.id),
  };
}

/** The areas an area lies under, outermost first. */
export function areasAbove(areas: readonly CloudArea[], area: CloudArea): CloudArea[] {
  const above: CloudArea[] = [];
  for (
    let at = areas.find((each) => each.id === area.parentId);
    at && above.length < CLOUD_AREA_MAX_DEPTH;
    at = areas.find((each) => each.id === at?.parentId)
  ) {
    above.unshift(at);
  }
  return above;
}

/**
 * The areas standing right under one, as the side bar has them: under the workspace's own those
 * at the top.
 */
export function areasUnder(areas: readonly CloudArea[], area: CloudArea): CloudArea[] {
  const made = areas.filter((each) => !each.root);
  if (!area.root) return made.filter((each) => each.parentId === area.id);
  const known = new Set(made.map((each) => each.id));
  return made.filter((each) => each.parentId === null || !known.has(each.parentId));
}

/**
 * The workspace's own area: there from the start, named and open as the workspace is, never
 * deleted, without people or agents of its own.
 */
export const isWorkspaceOwn = (area: Pick<CloudArea, 'root'>) => area.root;

/** Whether an area may still get one under it. */
export const canHaveAreasUnder = (areas: readonly CloudArea[], area: CloudArea) =>
  // Under the workspace's own every area stands as it is.
  !isWorkspaceOwn(area) &&
  area.access === 'manage' &&
  areasAbove(areas, area).length + 1 < CLOUD_AREA_MAX_DEPTH;

/**
 * A folder's colour as drawn: its own, else its area's – not the workspace's own area's, which
 * shows a picture, no colour. `null`: the plain folder.
 */
export function folderColor(
  node: Pick<CloudNode, 'color' | 'areaId'>,
  areas: readonly Pick<CloudArea, 'id' | 'color' | 'root'>[] | undefined,
): CloudAreaColor | null {
  if (node.color) return node.color;
  const area = node.areaId ? areas?.find((each) => each.id === node.areaId) : undefined;
  return area && !isWorkspaceOwn(area) ? area.color : null;
}
