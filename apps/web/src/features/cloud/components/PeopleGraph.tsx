import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Link } from 'react-router';
import type { CloudArea, CloudAreaMember } from '@slider/shared';
import { pluralize } from '@/lib/format';
import { routes } from '@/lib/routes';
import { Avatar, Badge, Button, cn, Icon, IconButton, Menu, type MenuAction } from '@/ui';
import { WorkspaceMark } from '@/features/workspaces';
import { useCloud } from '../hooks/useCloud';

/** Where the lines to the areas begin: around the workspace's picture and name. */
const HUB_EDGE = 52;
import { DOT, layoutPeopleGraph } from '../lib/people-graph';
import { AreaDot, areaColor } from './AreaDot';

/** Where the graph stands in its frame: moved by `x`, `y` (px), `k` times as large. */
interface Camera {
  x: number;
  y: number;
  k: number;
}
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
/** Up to this many people every dot has its name under it; beyond that, names come by pointing. */
const NAMED = 24;
/** From this zoom on every dot has its name under it. */
const NAME_ZOOM = 0.7;
const clamp = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/**
 * „Bereiche“ › „Personen“ as a net: the workspace in the middle, the areas around it, each
 * area's people as dots around it – who works in several areas stands in each of them, and
 * all their dots light up together. Free to move (drag) and to zoom (pinch, ⌘ and the wheel, the buttons), so it holds
 * hundreds of people; an area picked – or a name typed in the page's bar (`query`) – lights up
 * its people.
 */
export function PeopleGraph({
  areas,
  query,
  actionsFor,
}: {
  areas: readonly CloudArea[];
  query: string;
  actionsFor: (area: CloudArea) => MenuAction[];
}) {
  const ui = useCloud();
  const graph = useMemo(() => layoutPeopleGraph(areas), [areas]);
  const areaOf = useMemo(() => new Map(areas.map((area) => [area.id, area])), [areas]);
  const memberOf = useMemo(() => {
    const members = new Map<string, CloudAreaMember>();
    for (const area of areas) for (const member of area.members) members.set(member.id, member);
    return members;
  }, [areas]);

  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Until moved or zoomed by hand the whole graph is shown, whatever the frame's size.
  const [moved, setMoved] = useState<Camera | null>(null);
  const fitted = useMemo<Camera>(() => {
    const { left, top, right, bottom } = graph.bounds;
    const k = clamp(
      Math.min(1, (size.width - 48) / (right - left), (size.height - 48) / (bottom - top)),
    );
    return {
      k,
      x: size.width / 2 - (k * (left + right)) / 2,
      y: size.height / 2 - (k * (top + bottom)) / 2,
    };
  }, [graph.bounds, size]);
  const camera = moved ?? fitted;
  const cameraNow = useRef(camera);
  useEffect(() => {
    cameraNow.current = camera;
  });

  /** Zooms about a point of the frame (its middle when none is given). */
  const zoomBy = (factor: number, at?: { x: number; y: number }) => {
    const now = cameraNow.current;
    const k = clamp(now.k * factor);
    const px = at?.x ?? size.width / 2;
    const py = at?.y ?? size.height / 2;
    setMoved({
      k,
      x: px - ((px - now.x) / now.k) * k,
      y: py - ((py - now.y) / now.k) * k,
    });
  };
  const zoomRef = useRef(zoomBy);
  useEffect(() => {
    zoomRef.current = zoomBy;
  });
  // Pinch, or ⌘/Ctrl and the wheel, zooms; the wheel alone scrolls the page as everywhere.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const box = element.getBoundingClientRect();
      zoomRef.current(Math.exp(-event.deltaY * 0.01), {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const [picked, setPicked] = useState<string | null>(null);
  const [overArea, setOverArea] = useState<string | null>(null);
  // The dot the pointer is on: a person stands once in each of their areas.
  const [overDot, setOverDot] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const drag = useRef<{ x: number; y: number; from: Camera; far: boolean } | null>(null);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('button, a, input')) return;
    drag.current = { x: event.clientX, y: event.clientY, from: cameraNow.current, far: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const held = drag.current;
    if (!held) return;
    const dx = event.clientX - held.x;
    const dy = event.clientY - held.y;
    if (!held.far && Math.hypot(dx, dy) < 4) return;
    held.far = true;
    setDragging(true);
    setMoved({ k: held.from.k, x: held.from.x + dx, y: held.from.y + dy });
  };
  const onPointerUp = () => {
    // A click on the open ground lets go of the picked area.
    if (drag.current && !drag.current.far) setPicked(null);
    drag.current = null;
    setDragging(false);
  };

  const words = query.trim().toLowerCase();
  const lit = overArea ?? picked;
  const pointed = overDot ? graph.people.find((person) => person.key === overDot) : undefined;
  const overPerson = pointed?.id ?? null;
  const someLit = lit !== null || overPerson !== null || words !== '';
  const isLit = (personId: string, areaIds: readonly string[]) =>
    personId === overPerson ||
    (lit !== null && areaIds.includes(lit)) ||
    (words !== '' &&
      `${memberOf.get(personId)?.name ?? ''} ${memberOf.get(personId)?.title ?? ''}`
        .toLowerCase()
        .includes(words));
  const pickedArea = picked ? areaOf.get(picked) : undefined;

  const pointedMember = overPerson ? memberOf.get(overPerson) : undefined;
  const named = memberOf.size <= NAMED;
  // Zoomed far out, the names of the areas and of the workspace stay readable.
  const label = Math.min(2.2, Math.max(1, 1 / camera.k));
  const firstName = (member: CloudAreaMember) =>
    member.id === ui.userId ? 'Du' : (member.name.split(' ')[0] ?? member.name);

  return (
    // As tall as the page has room: the net scrolls and zooms in itself, the page stays put.
    // Free on the page's ground as „Ordner“'s tree, no box around it (the user, 2026-11-23:
    // „Order ist so frei und personen mit box. Personen sollen auch frei sein.“).
    <div className="relative min-h-[320px] flex-1">
      <div
        ref={frame}
        role="group"
        aria-label="Wer arbeitet wo"
        className="absolute inset-0 cursor-grab touch-none overflow-hidden select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        // Dragging moves the graph: the page's selection box stays out of it.
        onMouseDown={(event) => event.stopPropagation()}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.k})` }}
        >
          <svg aria-hidden width="1" height="1" className="absolute top-0 left-0 overflow-visible">
            {graph.areas.map((area) => {
              const parent = area.parentId
                ? graph.areas.find((each) => each.id === area.parentId)
                : null;
              // From edge to edge: no line runs under the workspace or through an area's people.
              const fromX = parent?.x ?? 0;
              const fromY = parent?.y ?? 0;
              const far = Math.hypot(area.x - fromX, area.y - fromY);
              const start = parent ? parent.radius + 6 : HUB_EDGE;
              const end = far - area.radius - 6;
              if (far < 1 || end <= start) return null;
              const dx = (area.x - fromX) / far;
              const dy = (area.y - fromY) / far;
              return (
                <line
                  key={area.id}
                  x1={fromX + dx * start}
                  y1={fromY + dy * start}
                  x2={fromX + dx * end}
                  y2={fromY + dy * end}
                  strokeLinecap="round"
                  className="stroke-hairline-strong"
                  strokeWidth={1}
                />
              );
            })}
          </svg>

          <div
            className="absolute top-0 left-0 flex flex-col items-center gap-1.5 whitespace-nowrap"
            style={{
              transform: `translate(-50%, -20px) scale(${label})`,
              transformOrigin: '50% 20px',
            }}
          >
            <WorkspaceMark name={ui.workspace.name} logoUrl={ui.workspace.logoUrl} size={40} />
            <span className="text-xs font-medium text-fg-muted">{ui.workspace.name}</span>
          </div>

          {/* The people come first; an area is only the ground they stand on. */}
          {graph.areas.map((spot) => {
            const area = areaOf.get(spot.id);
            if (!area) return null;
            return (
              <span
                key={spot.id}
                aria-hidden
                className="absolute top-0 left-0 rounded-full transition-opacity duration-150"
                style={{
                  width: spot.radius * 2,
                  height: spot.radius * 2,
                  transform: `translate(${spot.x - spot.radius}px, ${spot.y - spot.radius}px)`,
                  backgroundColor: areaColor(area.color),
                  opacity: lit === area.id ? 0.14 : 0.06,
                }}
              />
            );
          })}

          <ul aria-label="Personen">
            {graph.people.map((person) => {
              const member = memberOf.get(person.id);
              if (!member) return null;
              const on = isLit(person.id, person.areaIds);
              return (
                <li
                  key={person.key}
                  className={cn(
                    'absolute top-0 left-0 flex flex-col items-center transition-opacity duration-150',
                    someLit && !on && 'opacity-20',
                  )}
                  style={{
                    transform: `translate(${person.x - DOT / 2}px, ${person.y - DOT / 2}px)`,
                    width: DOT,
                  }}
                  onPointerEnter={() => setOverDot(person.key)}
                  onPointerLeave={() => setOverDot(null)}
                >
                  <span className="flex items-center justify-center" style={{ height: DOT }}>
                    <Avatar author={member} size={32} nativeTitle={false} />
                  </span>
                  <span className="sr-only">
                    {member.name}
                    {member.title ? `, ${member.title}` : ''}
                  </span>
                  {(named || camera.k >= NAME_ZOOM || (on && someLit)) && (
                    <span
                      aria-hidden
                      className="-mt-1.5 max-w-[60px] truncate rounded-mark bg-surface-1/80 px-1 text-tiny whitespace-nowrap text-fg"
                    >
                      {firstName(member)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          <ul aria-label="Bereiche">
            {graph.areas.map((spot) => {
              const area = areaOf.get(spot.id);
              if (!area) return null;
              return (
                <li
                  key={spot.id}
                  className="absolute top-0 left-0"
                  style={{ transform: `translate(${spot.x}px, ${spot.y - spot.radius}px)` }}
                >
                  <button
                    type="button"
                    aria-pressed={picked === area.id}
                    onClick={() => setPicked(picked === area.id ? null : area.id)}
                    onPointerEnter={() => setOverArea(area.id)}
                    onPointerLeave={() => setOverArea(null)}
                    style={{ transform: `translate(-50%, -100%) scale(${label})` }}
                    className={cn(
                      'flex h-7 max-w-[180px] origin-bottom cursor-pointer items-center gap-1.5 rounded-full px-2 text-fg-muted transition-colors outline-none hover:bg-glass-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus',
                      picked === area.id && 'bg-glass-hover text-fg',
                      someLit && lit !== area.id && words === '' && !overPerson && 'opacity-60',
                    )}
                  >
                    <AreaDot color={area.color} />
                    <span className="truncate text-xs font-medium">{area.name}</span>
                    <span className="text-xs text-fg-subtle tabular-nums">
                      {area.members.length}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Who the pointer is on: name, what they do, where they work. */}
      {pointed && pointedMember && !dragging && (
        <div
          aria-hidden
          className="glass pointer-events-none absolute top-0 left-0 z-(--z-raised) flex max-w-64 flex-col gap-0.5 rounded-control px-3 py-2"
          style={{
            transform: `translate(${pointed.x * camera.k + camera.x}px, ${
              pointed.y * camera.k + camera.y - (DOT / 2) * camera.k - 8
            }px) translate(-50%, -100%)`,
          }}
        >
          <span className="flex items-center gap-2">
            <span className="truncate text-body font-medium text-fg">
              {pointedMember.id === ui.userId ? 'Du' : pointedMember.name}
            </span>
            {pointedMember.role === 'viewer' && <Badge>Betrachter</Badge>}
          </span>
          {pointedMember.title && (
            <span className="truncate text-xs text-fg-muted">{pointedMember.title}</span>
          )}
          <span className="text-xs text-fg-subtle">
            {pointed.areaIds.map((id) => areaOf.get(id)?.name ?? '').join(' | ')}
          </span>
        </div>
      )}

      {/* On the page's edges, as the bar above and the zoom below. */}
      {pickedArea && (
        <div className="glass absolute top-0 left-0 flex max-w-72 items-center gap-3 rounded-panel py-2 pr-2 pl-3">
          <AreaDot color={pickedArea.color} size="lg" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              <Link
                to={routes.cloudArea(ui.workspace.id, pickedArea.id)}
                className="truncate rounded-mark text-body font-semibold text-fg outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus"
              >
                {pickedArea.name}
              </Link>
              {pickedArea.visibility === 'members' && (
                <Icon
                  name="lock"
                  size={14}
                  className="shrink-0 text-fg-subtle"
                  label="Nur für seine Personen"
                />
              )}
            </span>
            <span className="text-xs text-fg-muted">
              {pluralize(pickedArea.members.length, 'Person', 'Personen')}
            </span>
          </span>
          {actionsFor(pickedArea).length > 0 && (
            <Menu
              label={`Aktionen für den Bereich ${pickedArea.name}`}
              actions={actionsFor(pickedArea)}
            />
          )}
        </div>
      )}

      <div className="glass absolute right-0 bottom-0 flex items-center gap-0.5 rounded-control p-1">
        <IconButton
          icon="remove"
          label="Verkleinern"
          size="sm"
          variant="subtle"
          disabled={camera.k <= MIN_ZOOM}
          onClick={() => zoomBy(1 / 1.3)}
        />
        <span className="w-10 text-center text-xs text-fg-muted tabular-nums">
          {Math.round(camera.k * 100)} %
        </span>
        <IconButton
          icon="add"
          label="Vergrößern"
          size="sm"
          variant="subtle"
          disabled={camera.k >= MAX_ZOOM}
          onClick={() => zoomBy(1.3)}
        />
        <Button variant="ghost" size="sm" disabled={moved === null} onClick={() => setMoved(null)}>
          Alles zeigen
        </Button>
      </div>
    </div>
  );
}
