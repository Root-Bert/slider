/*
 * Where everything stands in „Bereiche“ › „Personen“: the workspace in the middle, its areas
 * around it (sub-areas further out, beyond their own), and each area's people as a cloud of
 * dots around it. Who works in several areas has a dot in each of them (lines across would be
 * chaos). Worked out once per set of areas, the same every time (no chance in it), in
 * the graph's own units (px at zoom 1).
 */

/** A person's dot with the room around it. */
export const DOT = 46;
/** An area without people still takes this much room. */
const INNER = 40;
/** Room the workspace takes in the middle: its picture with its name beneath, clear of an area's name. */
const HUB = 96;
/** Where the lines to the areas begin when nobody stands round the workspace. */
const HUB_EDGE = 52;
/** The first ring of people round the workspace: clear of its picture and name (`HUB_NAME`). */
const HUB_RING = 96;
/** The workspace's name is no wider than this with people round it (px at zoom 1). */
export const HUB_NAME = 120;
/** Room between two areas' clouds. */
const GAP = 72;
/** The golden angle: clouds on the same spot move apart in different directions. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export interface GraphAreaInput {
  id: string;
  parentId: string | null;
  members: readonly { id: string }[];
}

export interface GraphArea {
  id: string;
  x: number;
  y: number;
  /** As far as its own people reach. */
  radius: number;
  /** The area it hangs on; `null`: the workspace. */
  parentId: string | null;
}

export interface GraphPerson {
  /** One per dot: a person has a dot in each of their areas. */
  key: string;
  id: string;
  x: number;
  y: number;
  /** All the areas the person works in. */
  areaIds: string[];
}

export interface PeopleGraph {
  areas: GraphArea[];
  /** Also those in no area: round the workspace, `areaIds` empty. */
  people: GraphPerson[];
  /** Where the lines to the areas begin: round the workspace and its people. */
  hubEdge: number;
  /** Everything lies within. */
  bounds: { left: number; top: number; right: number; bottom: number };
}

/**
 * Where an area's `count` people stand around its middle: evenly on rings. Up to seven share one
 * ring round an empty middle (two side by side, three a triangle, four a square …), up to eleven
 * one in the middle and the rest round it; more: on as few rings as hold them, each its share by
 * its length.
 */
export function cloudOf(count: number): { x: number; y: number }[] {
  if (count <= 0) return [];
  if (count === 1) return [{ x: 0, y: 0 }];
  const rings: number[] = [];
  if (count <= 7) rings.push(count);
  else if (count <= 11) rings.push(count - 1);
  else {
    const rest = count - 1;
    let depth = 0;
    for (let room = 0; room < rest; room += Math.ceil(2 * Math.PI * depth)) depth += 1;
    const weight = (depth * (depth + 1)) / 2;
    let left = rest;
    for (let ring = 1; ring <= depth; ring += 1) {
      const share =
        ring === depth
          ? left
          : Math.min(Math.ceil(2 * Math.PI * ring), Math.round((rest * ring) / weight));
      rings.push(share);
      left -= share;
    }
  }
  const spots = count > 7 ? [{ x: 0, y: 0 }] : [];
  // Nothing in the middle of a single ring to keep clear of.
  let inner = count > 7 ? 0 : -Infinity;
  rings.forEach((many, index) => {
    // Never closer than a dot to the next on the ring, nor to the ring inside.
    const far = Math.max(
      DOT * 0.6,
      DOT / (2 * Math.sin(Math.PI / Math.max(many, 2))),
      inner + DOT * 0.9,
    );
    inner = far;
    // One ring: odd counts point up, even ones stand flat. Several: every other ring turns by
    // half a step, so its dots stand between those of the ring inside.
    const turn = rings.length === 1 ? (many % 2 === 0 ? 1 : 0) : index % 2;
    const start = -Math.PI / 2 + (turn * Math.PI) / many;
    for (let i = 0; i < many; i += 1) {
      const angle = start + (i * 2 * Math.PI) / many;
      spots.push({ x: Math.cos(angle) * far, y: Math.sin(angle) * far });
    }
  });
  return spots;
}

/**
 * Where `count` people stand round the workspace's picture: lined up on as few rings round it as
 * hold them, each its share by its length, so every ring is evenly full.
 */
function hubRingsOf(count: number): { x: number; y: number }[] {
  const rings: number[] = [];
  let room = 0;
  for (let far = HUB_RING; room < count; far += DOT * 0.9) {
    rings.push(far);
    room += Math.floor((2 * Math.PI * far) / DOT);
  }
  const length = rings.reduce((sum, far) => sum + far, 0);
  const spots: { x: number; y: number }[] = [];
  let left = count;
  rings.forEach((far, index) => {
    const many =
      index === rings.length - 1
        ? left
        : Math.min(Math.floor((2 * Math.PI * far) / DOT), Math.round((count * far) / length));
    left -= many;
    // One ring as a cloud: odd counts point up, even ones stand flat (two: left and right).
    // Several: every other ring turns by half a step, between the dots of the ring inside.
    const turn = rings.length === 1 ? (many % 2 === 0 ? 1 : 0) : index % 2;
    const start = -Math.PI / 2 + (turn * Math.PI) / Math.max(many, 1);
    for (let i = 0; i < many; i += 1) {
      const angle = start + (i * 2 * Math.PI) / many;
      spots.push({ x: Math.cos(angle) * far, y: Math.sin(angle) * far });
    }
  });
  return spots;
}

/**
 * `loose`: who is in the workspace but in none of `input`'s areas – lined up round the
 * workspace in the middle.
 */
export function layoutPeopleGraph(
  input: readonly GraphAreaInput[],
  loose: readonly string[] = [],
): PeopleGraph {
  const onHub = hubRingsOf(loose.length);
  const ringed = Math.max(0, ...onHub.map((spot) => Math.hypot(spot.x, spot.y)));
  const hub = onHub.length > 0 ? Math.max(HUB, ringed + DOT / 2 + 10) : HUB;
  const hubEdge = onHub.length > 0 ? ringed + DOT / 2 + 6 : HUB_EDGE;
  const known = new Set(input.map((area) => area.id));
  const parentOf = (area: GraphAreaInput) =>
    area.parentId !== null && known.has(area.parentId) ? area.parentId : null;

  // Each person once, with all their areas.
  const areasOf = new Map<string, string[]>();
  for (const area of input) {
    for (const member of area.members) {
      const list = areasOf.get(member.id);
      if (list) {
        if (!list.includes(area.id)) list.push(area.id);
      } else areasOf.set(member.id, [area.id]);
    }
  }
  // Who works in several areas stands in each of them: no lines across the page.
  const own = new Map<string, string[]>(
    input.map((area) => [area.id, [...new Set(area.members.map((member) => member.id))]]),
  );

  const areas = new Map<string, GraphArea>();
  for (const area of input) {
    const count = own.get(area.id)?.length ?? 0;
    areas.set(area.id, {
      id: area.id,
      x: 0,
      y: 0,
      radius: Math.max(
        INNER,
        Math.max(0, ...cloudOf(count).map((spot) => Math.hypot(spot.x, spot.y))) + DOT / 2 + 10,
      ),
      parentId: parentOf(area),
    });
  }
  const childrenOf = (parentId: string | null) =>
    [...areas.values()].filter((area) => area.parentId === parentId);

  // The top areas on a ring around the workspace, each with as much of it as it is wide …
  const top = childrenOf(null);
  const around = top.reduce((sum, area) => sum + 2 * area.radius + GAP, 0);
  const widest = Math.max(0, ...top.map((area) => area.radius));
  const ring = Math.max(around / (2 * Math.PI), hub + widest + GAP);
  let turned = -Math.PI / 2;
  for (const area of top) {
    const share = ((2 * area.radius + GAP) / Math.max(around, 1)) * 2 * Math.PI;
    const angle = turned + share / 2;
    turned += share;
    area.x = Math.cos(angle) * ring;
    area.y = Math.sin(angle) * ring;
  }
  // … and the areas under one beyond it, fanned out away from the middle.
  const place = (parent: GraphArea, towards: number) => {
    const children = childrenOf(parent.id);
    children.forEach((child, index) => {
      const angle = towards + (index - (children.length - 1) / 2) * 0.7;
      const far = parent.radius + child.radius + GAP;
      child.x = parent.x + Math.cos(angle) * far;
      child.y = parent.y + Math.sin(angle) * far;
      place(child, angle);
    });
  };
  for (const area of top) place(area, Math.atan2(area.y, area.x));

  // Clouds that still lie over each other move apart; the workspace keeps its middle.
  const list = [...areas.values()];
  const apart = (a: GraphArea, bx: number, by: number, room: number, both: GraphArea | null) => {
    let dx = a.x - bx;
    let dy = a.y - by;
    let far = Math.hypot(dx, dy);
    if (far >= room) return false;
    if (far < 0.01) {
      // On the same spot: apart by where they stand in the list, not by chance.
      const angle = list.indexOf(a) * GOLDEN;
      dx = Math.cos(angle);
      dy = Math.sin(angle);
      far = 1;
    }
    const push = (room - far) / far / (both ? 2 : 1);
    a.x += dx * push;
    a.y += dy * push;
    if (both) {
      both.x -= dx * push;
      both.y -= dy * push;
    }
    return true;
  };
  for (let round = 0; round < 300; round += 1) {
    let moved = false;
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i];
      if (!a) continue;
      if (apart(a, 0, 0, hub + a.radius + GAP / 2, null)) moved = true;
      for (let j = i + 1; j < list.length; j += 1) {
        const b = list[j];
        if (b && apart(a, b.x, b.y, a.radius + b.radius + GAP, b)) moved = true;
      }
    }
    if (!moved) break;
  }

  // An area's own people: evenly on rings around it.
  const people: GraphPerson[] = [];
  for (const area of list) {
    const ids = own.get(area.id) ?? [];
    const spots = cloudOf(ids.length);
    ids.forEach((id, index) => {
      const spot = spots[index] ?? { x: 0, y: 0 };
      people.push({
        key: `${area.id}:${id}`,
        id,
        x: area.x + spot.x,
        y: area.y + spot.y,
        areaIds: areasOf.get(id) ?? [area.id],
      });
    });
  }

  // Who is in no area: round the workspace.
  loose.forEach((id, index) => {
    const spot = onHub[index] ?? { x: 0, y: 0 };
    people.push({ key: `workspace:${id}`, id, x: spot.x, y: spot.y, areaIds: [] });
  });

  const bounds = { left: -hub, top: -hub, right: hub, bottom: hub };
  const reach = (x: number, y: number, room: number) => {
    bounds.left = Math.min(bounds.left, x - room);
    bounds.top = Math.min(bounds.top, y - room);
    bounds.right = Math.max(bounds.right, x + room);
    bounds.bottom = Math.max(bounds.bottom, y + room);
  };
  // The area's name stands above its people.
  for (const area of list) reach(area.x, area.y, area.radius + 44);
  return { areas: list, people, hubEdge, bounds };
}

/** How many people a search typed beside the net finds (by name or title) – each once. */
export function peopleFound(
  areas: readonly { members: readonly { id: string; name: string; title?: string | null }[] }[],
  query: string,
): number {
  const words = query.trim().toLowerCase();
  if (words === '') return 0;
  return new Set(
    areas.flatMap((area) =>
      area.members
        .filter((member) => `${member.name} ${member.title ?? ''}`.toLowerCase().includes(words))
        .map((member) => member.id),
    ),
  ).size;
}
