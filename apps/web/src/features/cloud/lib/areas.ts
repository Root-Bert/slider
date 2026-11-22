import { CLOUD_AREA_MAX_DEPTH, type CloudArea } from '@slider/shared';
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
 * Each a link to its page; the workspace's own area alone is just itself.
 */
export function areaTrail(
  workspaceId: string,
  areas: readonly CloudArea[],
  area: CloudArea,
): { label: string; to: string }[] {
  const root = areas.find((each) => each.root);
  const chain = area.root
    ? [area]
    : [...(root ? [root] : []), ...areasAbove(areas, area).filter((each) => !each.root), area];
  return chain.map((each) => ({ label: each.name, to: routes.cloudArea(workspaceId, each.id) }));
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
