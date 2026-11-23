import { useState } from 'react';
import { Link } from 'react-router';
import { searchFold, type CloudAgentSummary } from '@slider/shared';
import { formatRelativeTime } from '@/lib/format';
import { routes } from '@/lib/routes';
import { useDeckContextMenu } from '@/features/reviews';
import { WorkspaceMark } from '@/features/workspaces';
import { Avatar, cn, Icon, IconButton, Toolbar, Tooltip } from '@/ui';
import { useCloud } from '../hooks/useCloud';
import { useStoredChoice } from '../hooks/useStoredChoice';
import { agentState, autoWords } from '../lib/kinds';
import { AgentAvatar } from './AgentAvatar';
import { AgentActions, AgentTitleInput, hasAgentActions } from './AgentActions';
import { AreaDot } from './AreaDot';
import { DeskSheet } from './DeskPicture';

/*
 * Agents as a list – on „Agenten“ (one's own, the workspace's) and in an area (its own): the
 * same tiles and rows everywhere, shown as picked once for all of them.
 */

/** The agents a page's search finds: every word in its order, what it said last or whose it is. */
export function agentsSaying(agents: readonly CloudAgentSummary[], query: string) {
  const words = searchFold(query.trim()).split(/\s+/).filter(Boolean);
  if (words.length === 0) return agents;
  return agents.filter((agent) => {
    const hay = searchFold(`${agent.title} ${agent.summary ?? ''} ${agent.owner.name}`);
    return words.every((word) => hay.includes(word));
  });
}

/** What a page's search says when no agent has it. */
export function agentsNone(query: string) {
  return `Keine Treffer für „${query.trim()}“ – gesucht wird im Auftrag, in der letzten Antwort und nach wem.`;
}

/** A card's height, the same for all – and for those not loaded yet. */
const CARD_HEIGHT = 'h-[148px]';

/** Tiles side by side, as many as fit – agents' and to-dos' alike. */
export const GRID =
  'grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]';

/** Where each sheet lies on the card, and where it goes on hover – as a folder's files do. */
const SHEETS = [
  'group-hover:-translate-y-1.5 group-hover:-rotate-3',
  '-ml-5 translate-y-1 group-hover:-translate-y-1 group-hover:rotate-2',
  '-ml-5 translate-y-2 group-hover:-translate-y-0.5 group-hover:-rotate-1',
] as const;

/** It works by itself – at a time, or when something it watches changes: what, at a glance. */
function Repeats({ agent }: { agent: CloudAgentSummary }) {
  const label = autoWords(agent);
  if (!label) return null;
  return (
    <Tooltip label={label} decorative>
      <Icon
        name={agent.paused ? 'pause' : agent.repeat ? 'replay' : 'visibility'}
        size={14}
        label={label}
        className="relative z-(--z-raised) shrink-0"
      />
    </Tooltip>
  );
}

/**
 * An agent's picture – with where it belongs at its corner: the workspace's mark, or its area's
 * dot. An area's dot also on one's own agent that stands in an area – but not inside that area,
 * where every agent is of it and the dot tells those given to its people. So a list of all of
 * them tells them apart at a glance, by the same marks they are picked by beside the order's
 * field.
 */
function Face({
  agent,
  size,
  showArea,
}: {
  agent: CloudAgentSummary;
  size: 32 | 48;
  /** The list is not one area's own: an agent's area is news. */
  showArea: boolean;
}) {
  const ui = useCloud();
  const area = agent.areaId ? ui.home?.areas.find((each) => each.id === agent.areaId) : null;
  const inArea = agent.areaId ? `im Bereich „${area?.name ?? ''}“`.replace(' „“', '') : '';
  const label = agent.areaId
    ? agent.shared
      ? `Agent des Bereichs${area ? ` „${area.name}“` : ''}`
      : showArea
        ? `Dein Agent ${inArea}`
        : null
    : agent.shared
      ? 'Agent des Workspace'
      : null;
  return (
    <span className="relative flex shrink-0">
      {/* On a card the face floats over it, as the files it made do – those only a little. */}
      <AgentAvatar id={agent.id} size={size} className={size === 48 ? 'shadow-soft' : undefined} />
      {label && (
        // The corner is this span's: the tooltip's own box stands where it is put – from the
        // mark to the right, since the face stands at the list's left edge, which would cut it.
        <span className="absolute -right-1.5 -bottom-1.5 z-(--z-raised) flex">
          <Tooltip label={label} decorative align="start">
            <span
              role="img"
              aria-label={label}
              className="flex size-[18px] items-center justify-center overflow-hidden rounded-[6px] bg-surface-1 ring-2 ring-canvas"
            >
              {area ? (
                <AreaDot color={area.color} />
              ) : agent.areaId ? (
                <Icon name="workspaces" size={12} className="text-fg-muted" />
              ) : (
                <WorkspaceMark
                  name={ui.workspace.name}
                  logoUrl={ui.workspace.logoUrl}
                  size={24}
                  className="size-full! rounded-none!"
                />
              )}
            </span>
          </Tooltip>
        </span>
      )}
    </span>
  );
}

/** An agent as a row, as the files' list has them: its picture, its order, whose, how far. */
function AgentRow({
  agent,
  showArea,
  hrefOf,
}: {
  agent: CloudAgentSummary;
  showArea: boolean;
  hrefOf: ((agentId: string) => string) | undefined;
}) {
  const ui = useCloud();
  // A right click opens its menu at the pointer, as on a presentation – where it has one.
  const { onContextMenu, ...contextMenu } = useDeckContextMenu();
  const [renaming, setRenaming] = useState(false);
  return (
    <li
      onContextMenu={hasAgentActions(agent) ? onContextMenu : undefined}
      className="group relative flex h-13 items-center gap-3.5 rounded-control px-3 transition-colors hover:bg-surface-1 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-focus"
    >
      <Face agent={agent} size={32} showArea={showArea} />
      {renaming ? (
        <span className="relative z-(--z-raised) flex min-w-0 flex-1">
          <AgentTitleInput
            agent={agent}
            onDone={() => setRenaming(false)}
            className="text-sm font-medium"
          />
        </span>
      ) : (
        <Link
          to={hrefOf?.(agent.id) ?? routes.cloudAgent(ui.workspace.id, agent.id)}
          className="min-w-0 flex-1 truncate text-sm font-medium text-fg outline-none after:absolute after:inset-0"
        >
          {agent.title}
        </Link>
      )}
      {showArea && agent.areaId && (
        <span className="flex w-32 shrink-0 text-body text-fg-muted max-md:hidden">
          <AreaMark agent={agent} />
        </span>
      )}
      {agent.desk.length > 0 && (
        <span
          role="img"
          aria-label={`Auf dem Schreibtisch: ${agent.desk.map((file) => file.name).join(', ')}`}
          className="pointer-events-none flex shrink-0 items-center max-sm:hidden"
        >
          {agent.desk.map((file) => (
            <DeskSheet key={file.id} file={file} className="-ml-2 h-7 w-[46px] first:ml-0" />
          ))}
        </span>
      )}
      <span className="flex w-36 shrink-0 items-center gap-2 text-body text-fg-muted max-lg:hidden">
        <Avatar author={agent.owner} size={20} nativeTitle={false} />
        <span className="truncate">{agent.mine ? 'Du' : agent.owner.name}</span>
      </span>
      <span className="w-24 shrink-0 truncate text-body text-fg-muted max-md:hidden">
        {formatRelativeTime(agent.updatedAt)}
      </span>
      <span className="flex w-36 shrink-0 items-center justify-end gap-2 text-body text-fg-muted">
        <Repeats agent={agent} />
        {agent.running && <span className="size-1.5 animate-pulse rounded-full bg-fg-subtle" />}
        <span className="truncate">{agentState(agent)}</span>
      </span>
      {/* As wide as its menu, also where there is none: the columns stay in line. */}
      <span className="relative z-(--z-raised) flex h-8 w-8 shrink-0 items-center">
        <AgentActions agent={agent} {...contextMenu} onRename={() => setRenaming(true)} />
      </span>
    </li>
  );
}

function AgentCard({
  agent,
  showArea,
  hrefOf,
}: {
  agent: CloudAgentSummary;
  showArea: boolean;
  hrefOf: ((agentId: string) => string) | undefined;
}) {
  const ui = useCloud();
  // A right click opens its menu at the pointer, as on a presentation – where it has one.
  const { onContextMenu, ...contextMenu } = useDeckContextMenu();
  const [renaming, setRenaming] = useState(false);
  return (
    // Every card as high as the next: with files, with words, or with neither yet.
    <li
      onContextMenu={hasAgentActions(agent) ? onContextMenu : undefined}
      className={cn(
        'group glass relative flex flex-col gap-3 rounded-panel p-4 transition-colors hover:bg-glass-hover has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-focus',
        CARD_HEIGHT,
      )}
    >
      <div className="flex min-h-0 flex-1 items-start gap-3">
        <Face agent={agent} size={48} showArea={showArea} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-start gap-2">
            {renaming ? (
              <span className="relative z-(--z-raised) flex min-w-0 flex-1">
                <AgentTitleInput
                  agent={agent}
                  onDone={() => setRenaming(false)}
                  className="text-body font-medium"
                />
              </span>
            ) : (
              <Link
                to={hrefOf?.(agent.id) ?? routes.cloudAgent(ui.workspace.id, agent.id)}
                className="min-w-0 flex-1 truncate text-body font-medium text-fg outline-none after:absolute after:inset-0"
              >
                {agent.title}
              </Link>
            )}
            <span className="relative z-(--z-raised) -mt-1.5 -mr-1 flex h-8 items-center">
              <AgentActions agent={agent} {...contextMenu} onRename={() => setRenaming(true)} />
            </span>
          </div>
          {agent.desk.length > 0 ? (
            // What lies on its desk, made or changed by it: a peek at it, beside its face.
            <div
              role="img"
              aria-label={`Auf dem Schreibtisch: ${agent.desk.map((file) => file.name).join(', ')}`}
              className="pointer-events-none flex h-[52px] items-start pl-2.5"
            >
              {agent.desk.map((file, at) => (
                <DeskSheet
                  key={file.id}
                  file={file}
                  className={cn(
                    'h-[46px] w-[76px] shrink-0 transition-transform duration-300 ease-out motion-reduce:transition-none',
                    SHEETS[at],
                  )}
                />
              ))}
              {agent.openFiles > agent.desk.length && (
                <span className="ml-3 self-center text-xs text-fg-muted">
                  +{agent.openFiles - agent.desk.length}
                </span>
              )}
            </div>
          ) : (
            // Nothing made yet: how its last answer begins.
            agent.summary && (
              <p className="line-clamp-3 text-xs leading-[17px] text-fg-muted">{agent.summary}</p>
            )
          )}
        </div>
      </div>
      <div className="mt-auto flex items-center gap-2 text-xs text-fg-muted">
        <Avatar author={agent.owner} size={20} nativeTitle={false} />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="shrink-0 truncate">
            {agent.mine ? 'Du' : agent.owner.name} | {formatRelativeTime(agent.updatedAt)}
          </span>
          {showArea && agent.areaId && <AreaMark agent={agent} bar />}
        </span>
        <Repeats agent={agent} />
        {agent.running && <span className="size-1.5 animate-pulse rounded-full bg-fg-subtle" />}
        <span className="shrink-0">{agentState(agent)}</span>
      </div>
    </li>
  );
}

/** The area an agent stands in – where the list is not that area's own. */
function AreaMark({ agent, bar = false }: { agent: CloudAgentSummary; bar?: boolean }) {
  const ui = useCloud();
  const area = ui.home?.areas.find((each) => each.id === agent.areaId);
  if (!area) return null;
  return (
    <span title={`Im Bereich „${area.name}“`} className="flex min-w-0 items-center gap-1.5">
      {bar && <span aria-hidden>|</span>}
      <AreaDot color={area.color} />
      <span className="truncate">{area.name}</span>
    </span>
  );
}

const AGENT_VIEWS = ['tiles', 'list'] as const;
export type AgentView = (typeof AGENT_VIEWS)[number];
/** Tiles or rows: one choice for every list of agents. */
export const useAgentView = () => useStoredChoice('slider.cloud.agents-view', AGENT_VIEWS, 'tiles');

export function AgentViewToggle({
  view,
  onChange,
}: {
  view: AgentView;
  onChange: (view: AgentView) => void;
}) {
  return (
    <Toolbar role="group" label="Ansicht" className="ml-auto shrink-0">
      <IconButton
        icon="gridView"
        label="Kachelansicht"
        size="sm"
        iconSize={18}
        active={view === 'tiles'}
        onClick={() => onChange('tiles')}
      />
      <IconButton
        icon="viewList"
        label="Listenansicht"
        size="sm"
        iconSize={18}
        active={view === 'list'}
        onClick={() => onChange('list')}
      />
    </Toolbar>
  );
}

export function AgentListSkeleton() {
  return (
    <div aria-hidden className={GRID}>
      {[0, 1, 2].map((row) => (
        <div key={row} className={cn('skeleton rounded-panel', CARD_HEIGHT)} />
      ))}
    </div>
  );
}

export function AgentList({
  label,
  agents,
  view,
  showArea = false,
  hrefOf,
}: {
  /** What the list is called („Meine Agenten“). */
  label: string;
  agents: readonly CloudAgentSummary[];
  view: AgentView;
  /** Each agent names the area it stands in – where agents of several places are listed. */
  showArea?: boolean;
  /** Where an agent opens – its page in Cloud unless said (Sender: its chat there). */
  hrefOf?: (agentId: string) => string;
}) {
  return view === 'tiles' ? (
    <ul aria-label={label} className={GRID}>
      {agents.map((agent) => (
        <AgentCard key={agent.id} agent={agent} showArea={showArea} hrefOf={hrefOf} />
      ))}
    </ul>
  ) : (
    <ul aria-label={label} className="flex flex-col">
      {agents.map((agent) => (
        <AgentRow key={agent.id} agent={agent} showArea={showArea} hrefOf={hrefOf} />
      ))}
    </ul>
  );
}
