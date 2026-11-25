import { AgentAvatar } from './components/AgentAvatar';
import { AgentAuto } from './components/AgentAuto';
import { DeleteAgentDialog } from './components/AgentActions';
import { AgentShare } from './components/AgentShare';
import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { CloudAgentDetail } from '@slider/shared';
import { useCloudAgent } from '@/lib/api';
import { routes } from '@/lib/routes';
import { ViewSearch } from '@/features/workspaces';
import { agentFiles, ChatFiles, ChatViews, useChatView } from '@/features/sender';
import { AgentCallButton, CallBoxes, useAgentCall } from '@/features/calls';
import { Avatar, cn, Icon, IconButton, Tooltip, useMediaQuery } from '@/ui';
import { AgentChat } from './components/AgentChat';
import { agentArea, agentHome } from './lib/areas';
import { CloudPage } from './components/CloudPage';
import { LoadFailed } from './components/Empty';
import { AgentDesk } from './components/AgentDesk';
import { useCloud } from './hooks/useCloud';
import { useOpenedFrom } from './hooks/useOpenedFrom';
import {
  AsideToggle,
  useAgentAside,
  useAgentCardsShown,
  useAsideRoom,
} from './components/AgentAside';

/** The agent's one chat – its id the agent's (the chats of calls in conversations stay there). */
function Chats({
  agent,
  search,
}: {
  agent: CloudAgentDetail;
  search: { query: string; clear: () => void };
}) {
  const chat = agent.chats.find((each) => each.id === agent.id) ?? null;
  return (
    // Stacked over the cards (phone), the chat keeps most of the window and the cards follow
    // when the page scrolls – squeezed beside them, its first line lay in the list's fade.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 max-lg:h-[calc(100svh-20rem)] max-lg:flex-none">
      <AgentChat key={agent.id} agent={agent} chat={chat} search={search} takesHanded />
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

/** One agent: its chat, and beside it the desk with what it wrote. */
export function Component() {
  const { agentId = '' } = useParams();
  const ui = useCloud();
  const navigate = useNavigate();
  const found = useCloudAgent(ui.workspace.id, agentId);
  const [deleting, setDeleting] = useState(false);
  // Below the wide layout the cards stand under the chat and the page scrolls as one.
  const stacked = useMediaQuery('(max-width: 1023px)');
  // Side by side the cards can be put away (the switch at the tool bar's end); stacked they stay.
  const [cardsKept, setCardsKept] = useAgentCardsShown();
  // Side by side without room (the AI's panel open): the cards stand back, the panel shows the call.
  const [rowRef, room] = useAsideRoom();
  const cards = stacked || (cardsKept && room);
  const asideRef = useRef<HTMLDivElement>(null);
  const aside = useAgentAside(!stacked && cards, 380, asideRef);
  // The chat's search; another agent starts without one.
  const [searched, setSearched] = useState({ agentId, query: '' });
  const query = searched.agentId === agentId ? searched.query : '';
  const search = { query, clear: () => setSearched({ agentId, query: '' }) };
  const agent = found.data;
  // Its chat or its „Dateien“, beside its name – as every chat's.
  const { view, href: viewHref } = useChatView();
  // In a call with it: the call and its orders are the first cards beside the chat.
  const call = useAgentCall(agent?.id);
  // An area's agent stands in its area: the path leads through it, its row is lit.
  const area = agentArea(ui.home?.areas ?? [], agent);
  // From „Agenten“ the path stays there; from its area (or a link) it goes through the area.
  const from = useOpenedFrom([routes.cloudAgents(ui.workspace.id)], (path) =>
    path.startsWith(routes.cloudAgent(ui.workspace.id, agentId)),
  );
  const where = agentHome(ui.workspace.id, ui.home?.areas ?? [], area, from);
  return (
    <CloudPage
      docTitle={agent?.title ?? 'Agent'}
      title={
        found.isPending ? (
          ' '
        ) : agent ? (
          <ChatViews name={agent.title} view={view} href={viewHref} />
        ) : (
          'Agent'
        )
      }
      lead={
        agent ? (
          // At work: the green dot on its picture, as a person's who is there.
          <AgentAvatar id={agent.id} size={40} working={agent.running} />
        ) : (
          <Icon name="autoAwesome" size={28} className="shrink-0 text-fg-muted" />
        )
      }
      crumbs={[...where.crumbs, { label: agent?.title ?? 'Agent' }]}
      barRow={where.barRow}
      toolbar={
        agent ? (
          <div className="flex items-center gap-3 max-sm:flex-wrap">
            <ViewSearch
              label={view === 'files' ? 'Dateien durchsuchen' : 'Chat durchsuchen'}
              value={query}
              onChange={(next) => setSearched({ agentId, query: next })}
              className="ml-auto w-64 max-sm:w-full"
            />
            {/* Without room (the AI's panel open) the cards cannot show: no toggle that does nothing. */}
            {!stacked && room && (
              <AsideToggle
                shown={cards}
                onToggle={() => setCardsKept(!cards)}
                label="Karten des Agenten"
                title="Karten des Agenten – Schreibtisch, Arbeitet von selbst, Anruf"
              />
            )}
          </div>
        ) : null
      }
      nodes={[]}
      fill={!stacked}
      actions={
        agent && (
          <>
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
          <div ref={rowRef} className="flex min-h-0 flex-1 flex-col gap-5 lg:flex-row lg:gap-0">
            {view === 'files' ? (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col max-lg:h-[calc(100svh-20rem)] max-lg:flex-none">
                <ChatFiles
                  files={agentFiles(agent)}
                  workspaceId={ui.workspace.id}
                  search={query}
                  notify={ui.notify}
                />
              </div>
            ) : (
              <Chats agent={agent} search={search} />
            )}
            {/* Between chat and cards a handle: pulled, the cards take that width; double-click
                back to the default. Only side by side – stacked there is nothing to share. */}
            {aside.handle}
            {/* The cards: with a call over them they scroll as one, the desk as long as it is
                (still down to the bottom when short); on a phone the call's cards go over the chat.
                Side by side they can be put away, the chat then takes the page. */}
            {cards && (
              <div
                ref={asideRef}
                style={aside.style}
                className={cn(
                  'flex min-h-0 flex-col gap-5 lg:shrink-0',
                  call && 'max-lg:contents lg:overflow-y-auto lg:overscroll-contain',
                )}
              >
                {call && (
                  <CallBoxes call={call} className="flex flex-col gap-5 max-lg:order-first" />
                )}
                <AgentAuto agent={agent} />
                <div className={cn('flex flex-1 flex-col', !call && 'min-h-0')}>
                  <AgentDesk agent={agent} workspaceId={ui.workspace.id} notify={ui.notify} />
                </div>
              </div>
            )}
            {deleting && (
              <DeleteAgentDialog
                agent={agent}
                workspaceId={ui.workspace.id}
                notify={ui.notify}
                onClose={() => setDeleting(false)}
                onDeleted={() => void navigate(where.agents)}
              />
            )}
          </div>
        )
      }
    </CloudPage>
  );
}
