import { AgentAvatar } from './components/AgentAvatar';
import { AgentAuto } from './components/AgentAuto';
import { DeleteAgentDialog } from './components/AgentActions';
import { AgentShare } from './components/AgentShare';
import { useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { isTagChat, MAX_CLOUD_AGENT_CHATS, type CloudAgentDetail } from '@slider/shared';
import { useCloudAgent } from '@/lib/api';
import { ViewSearch } from '@/features/workspaces';
import { formatRelativeTime } from '@/lib/format';
import { routes } from '@/lib/routes';
import { AgentCallButton, CallBoxes, useAgentCall } from '@/features/calls';
import {
  Avatar,
  cn,
  GlassPanel,
  Icon,
  IconButton,
  SegmentedControl,
  Tooltip,
  useMediaQuery,
} from '@/ui';
import { AgentChat } from './components/AgentChat';
import { areaTrail } from './lib/areas';
import { CloudPage } from './components/CloudPage';
import { LoadFailed } from './components/Empty';
import { AgentDesk } from './components/AgentDesk';
import { useCloud } from './hooks/useCloud';
import { agentState } from './lib/kinds';
import { useAgentAside } from './components/AgentAside';

/** A chat's name on its tab: short enough for several side by side. */
const tabTitle = (title: string) =>
  title.length > 26 ? `${title.slice(0, 25).trimEnd()}…` : title;
const NEW_CHAT = 'new';

/** The agent's chats side by side – one shown, and a new one to open beside them. */
/** Which chat shows: the one picked – or the first, when that is gone or none may be opened. */
function chatShown(agent: CloudAgentDetail, picked: string) {
  const chat = agent.chats.find((each) => each.id === picked) ?? null;
  const canOpen =
    agent.canWrite &&
    agent.chats.filter((each) => !isTagChat(each.id)).length < MAX_CLOUD_AGENT_CHATS;
  // A chat that is gone, or „new“ without the right to open one: the first.
  const shown = chat ?? (picked === NEW_CHAT && canOpen ? null : (agent.chats[0] ?? null));
  return { shown, value: shown?.id ?? NEW_CHAT, canOpen };
}

/**
 * The agent's chats as tabs, with „Neuer Chat“ – the page's tool bar, as every other page's tabs
 * (a glass pill, `Geteilt`, an area's channels), so the chat below starts level with the desk.
 */
function ChatTabs({
  agent,
  picked,
  onPick,
}: {
  agent: CloudAgentDetail;
  picked: string;
  onPick: (chatId: string) => void;
}) {
  const { value, canOpen } = chatShown(agent, picked);
  if (agent.chats.length <= 1 && !canOpen) return null;
  return (
    <GlassPanel className="w-fit max-w-full min-w-0 overflow-x-auto p-1">
      <SegmentedControl
        label="Chats"
        mode="tabs"
        value={value}
        onChange={onPick}
        segments={[
          ...agent.chats.map((each) => ({
            value: each.id,
            label: tabTitle(each.title),
            // A tag chat with the mark of a call (`@Agent`).
            icon: each.running
              ? ('autoAwesome' as const)
              : isTagChat(each.id)
                ? ('at' as const)
                : undefined,
          })),
          ...(canOpen ? [{ value: NEW_CHAT, label: 'Neuer Chat', icon: 'add' as const }] : []),
        ]}
      />
    </GlassPanel>
  );
}

function Chats({
  agent,
  picked,
  onPick,
  search,
}: {
  agent: CloudAgentDetail;
  picked: string;
  onPick: (chatId: string) => void;
  search: { query: string; clear: () => void };
}) {
  const { shown, value } = chatShown(agent, picked);
  return (
    // Stacked over the cards (phone), the chat keeps most of the window and the cards follow
    // when the page scrolls – squeezed beside them, its first line lay in the list's fade.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 max-lg:h-[calc(100svh-20rem)] max-lg:flex-none">
      <AgentChat key={value} agent={agent} chat={shown} onOpened={onPick} search={search} />
    </div>
  );
}

/** Who else has the agent open right now. */
function Here({ agent }: { agent: CloudAgentDetail }) {
  if (agent.here.length === 0) return null;
  const shown = agent.here.slice(0, 5);
  return (
    <ul aria-label="Gerade hier" className="mr-1 flex items-center -space-x-1.5">
      {shown.map((person) => (
        <li key={person.id} className="flex">
          <Tooltip label={person.name} decorative>
            <Avatar author={person} size={28} nativeTitle={false} className="ring-2 ring-canvas" />
          </Tooltip>
        </li>
      ))}
      {agent.here.length > shown.length && (
        <li className="pl-3 text-xs text-fg-muted">+{agent.here.length - shown.length}</li>
      )}
    </ul>
  );
}

/** One agent: its chats, and beside them the desk with what it wrote. */
export function Component() {
  const { agentId = '' } = useParams();
  const ui = useCloud();
  const navigate = useNavigate();
  const found = useCloudAgent(ui.workspace.id, agentId);
  const [deleting, setDeleting] = useState(false);
  // Below the wide layout the cards stand under the chat and the page scrolls as one.
  const stacked = useMediaQuery('(max-width: 1023px)');
  const asideRef = useRef<HTMLDivElement>(null);
  const aside = useAgentAside(!stacked, 380, asideRef);
  // Which of its chats shows; another agent starts at its first.
  // `?chat=`: a chat other than the first (a draft in „Entwürfe“ opens where it was written).
  const asked = useSearchParams()[0].get('chat') ?? agentId;
  const [picked, setPicked] = useState({ agentId, asked, chatId: asked });
  const chatId = picked.agentId === agentId && picked.asked === asked ? picked.chatId : asked;
  const pick = (next: string) => setPicked({ agentId, asked, chatId: next });
  // The chats' search, right of their tabs; another agent starts without one.
  const [searched, setSearched] = useState({ agentId, query: '' });
  const query = searched.agentId === agentId ? searched.query : '';
  const search = { query, clear: () => setSearched({ agentId, query: '' }) };
  const agent = found.data;
  // In a call with it: the call and its orders are the first cards beside the chat.
  const call = useAgentCall(agent?.id);
  // An area's agent stands in its area: the way back leads there.
  const area = ui.home?.areas.find((each) => each.id === agent?.areaId) ?? null;
  const back = area
    ? routes.cloudAreaAgents(ui.workspace.id, area.id)
    : routes.cloudAgents(ui.workspace.id);
  return (
    <CloudPage
      docTitle={agent?.title ?? 'Agent'}
      title={found.isPending ? ' ' : (agent?.title ?? 'Agent')}
      lead={
        agent ? (
          <AgentAvatar id={agent.id} size={40} />
        ) : (
          <Icon name="autoAwesome" size={28} className="shrink-0 text-fg-muted" />
        )
      }
      crumbs={[
        ...(area
          ? areaTrail(ui.workspace.id, ui.home?.areas ?? [], area).slice(0, -1)
          : [{ label: ui.workspace.name }]),
        { label: area?.name ?? 'Agenten', to: back },
        { label: agent?.title ?? 'Agent' },
      ]}
      toolbar={
        agent ? (
          // On a phone the search on a line of its own, under the tabs.
          <div className="flex items-center gap-3 max-sm:flex-wrap">
            <ChatTabs agent={agent} picked={chatId} onPick={pick} />
            <ViewSearch
              label="Chat durchsuchen"
              value={query}
              onChange={(next) => setSearched({ agentId, query: next })}
              className="ml-auto w-64 max-sm:w-full"
            />
          </div>
        ) : null
      }
      nodes={[]}
      fill={!stacked}
      actions={
        agent && (
          <>
            {/* Whose order, since when, how far – beside the buttons; the tabs are the tool bar. */}
            <span className="mr-1 text-sm whitespace-nowrap text-fg-muted max-lg:hidden">
              Beauftragt von {agent.mine ? 'dir' : agent.owner.name} |{' '}
              {formatRelativeTime(agent.createdAt)} | {agentState(agent)}
            </span>
            <Here agent={agent} />
            <AgentCallButton agent={agent} />
            <AgentShare agent={agent} />
            {agent.canDelete && (
              // As small and quiet as „Anrufen“ beside it.
              <IconButton
                icon="delete"
                label="Agent löschen"
                variant="subtle"
                size="sm"
                onClick={() => setDeleting(true)}
              />
            )}
          </>
        )
      }
    >
      {() =>
        found.isPending ? (
          <div aria-hidden className="skeleton min-h-0 flex-1 rounded-panel" />
        ) : !agent ? (
          <LoadFailed
            message={found.error?.message ?? 'Diesen Agenten gibt es nicht.'}
            onRetry={() => void found.refetch()}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-5 lg:flex-row lg:gap-0">
            <Chats agent={agent} picked={chatId} onPick={pick} search={search} />
            {/* Between chat and cards a handle: pulled, the cards take that width; double-click
                back to the default. Only side by side – stacked there is nothing to share. */}
            {aside.handle}
            {/* The cards: with a call over them they scroll as one, the desk as long as it is
                (still down to the bottom when short); on a phone the call's cards go over the chat. */}
            <div
              ref={asideRef}
              style={aside.style}
              className={cn(
                'flex min-h-0 flex-col gap-5 lg:shrink-0',
                call && 'max-lg:contents lg:overflow-y-auto lg:overscroll-contain',
              )}
            >
              {call && <CallBoxes call={call} className="flex flex-col gap-5 max-lg:order-first" />}
              <AgentAuto agent={agent} />
              <div className={cn('flex flex-1 flex-col', !call && 'min-h-0')}>
                <AgentDesk agent={agent} workspaceId={ui.workspace.id} notify={ui.notify} />
              </div>
            </div>
            {deleting && (
              <DeleteAgentDialog
                agent={agent}
                workspaceId={ui.workspace.id}
                notify={ui.notify}
                onClose={() => setDeleting(false)}
                onDeleted={() => void navigate(back)}
              />
            )}
          </div>
        )
      }
    </CloudPage>
  );
}
