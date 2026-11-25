import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import type { CloudAgentChat } from '@slider/shared';
import { useQueryClient } from '@tanstack/react-query';
import { senderKeys, useCloudAgent } from '@/lib/api';
import { routes } from '@/lib/routes';
import { AgentAvatar, AgentChat, AgentDesk, useAgentAside, useAsideRoom } from '@/features/cloud';
import { AgentCallButton, CallBoxes, useAgentCall } from '@/features/calls';
import { ViewSearch } from '@/features/workspaces';
import { ButtonLink, cn, EmptyState, useMediaQuery } from '@/ui';
import { agentFiles, ChatFiles } from './components/ChatFiles';
import { ChatTitle, useChatView } from './components/ChatTitle';
import { MenuButton } from './components/MenuButton';
import { useSender } from './hooks/useSender';
import { PAGE_HEADER } from './lib/title';

/**
 * An agent as a conversation: its chat with everyone it is shared with, written to from here as
 * from its page in Cloud, its desk beside it as there – what it names and made opens in its app
 * (a PDF in Reader, a document in Writer, a presentation in Slider) or in Cloud. Its settings
 * are in Cloud.
 */
export function Component() {
  const { agentId = '' } = useParams();
  const ui = useSender();
  const workspaceId = ui.workspace.id;
  const queryClient = useQueryClient();
  const query = useCloudAgent(workspaceId, agentId);
  const agent = query.data;
  // The cards stand beside the chat from xl on (below they are hidden): only there a handle.
  const asideRef = useRef<HTMLDivElement>(null);
  const [pageRef, room] = useAsideRoom();
  const aside = useAgentAside(useMediaQuery('(min-width: 1024px)') && room, 360, asideRef);
  // One's call with it: a card at the top of the cards beside the chat, as in Cloud.
  const call = useAgentCall(agentId);
  // Its one chat (the chats of calls in conversations stay there).
  const chat: CloudAgentChat | undefined = agent?.chats.find((each) => each.id === agentId);
  // The chat's search, beside its name; another agent starts without one.
  const [search, setSearch] = useState('');
  // The chat or its „Dateien“, beside its name – as a conversation's (in the address).
  const { view, href: viewHref } = useChatView();

  // Another agent starts without a search.
  const [shown, setShown] = useState(agentId);
  if (shown !== agentId) {
    setShown(agentId);
    setSearch('');
  }
  // Opened, its answers are read (the server notes it when it is fetched): the count goes.
  const seen = agent?.chats.map((each) => each.messages.length).join() ?? '';
  useEffect(() => {
    if (seen) void queryClient.invalidateQueries({ queryKey: senderKeys.home(workspaceId) });
  }, [seen, workspaceId, queryClient]);
  if (query.isError && !agent) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <MenuButton />
        <div className="m-auto">
          <EmptyState
            title="Agent nicht gefunden"
            message="Es gibt ihn nicht mehr, oder er ist nicht mit dir geteilt."
          />
        </div>
      </div>
    );
  }
  if (!agent || !chat) return null;

  return (
    <section ref={pageRef} aria-label={agent.title} className="flex min-h-0 flex-1 flex-col gap-3">
      <header className={cn(PAGE_HEADER, 'max-sm:flex-wrap')}>
        <MenuButton />
        <AgentAvatar id={agent.id} size={32} />
        <ChatTitle name={agent.title} view={view} href={viewHref} className="flex-1" />
        <ViewSearch
          label={view === 'files' ? 'Dateien durchsuchen' : 'Chat durchsuchen'}
          value={search}
          onChange={setSearch}
          // On a phone on a line of its own, under the name.
          className="w-64 max-sm:order-last max-sm:w-full"
        />
        <AgentCallButton agent={agent} />
        <ButtonLink
          to={routes.cloudAgent(workspaceId, agent.id)}
          variant="ghost"
          size="sm"
          icon="openInNew"
          title="In Cloud öffnen"
          className="shrink-0"
        >
          {/* On a phone the mark alone: the agent's name keeps the room. */}
          <span className="max-sm:sr-only">In Cloud öffnen</span>
        </ButtonLink>
      </header>
      <div className={cn('flex min-h-0 flex-1', !aside.handle && 'gap-5')}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {view === 'files' ? (
            <ChatFiles
              files={agentFiles(agent)}
              workspaceId={workspaceId}
              search={search}
              notify={ui.notify}
            />
          ) : (
            // The one agent chat, as in Cloud: its messages and the field every conversation has.
            <AgentChat
              key={agent.id}
              agent={agent}
              chat={chat}
              autoFocus
              search={{ query: search, clear: () => setSearch('') }}
              takesHanded
            />
          )}
        </div>
        {/* Beside the chat where there is room, as in Cloud – wide enough for two tiles a row;
            the handle between them sizes it, as there. */}
        {aside.handle}
        <div
          ref={asideRef}
          style={aside.style}
          className={cn(
            'flex min-h-0 w-[360px] shrink-0 flex-col gap-5 max-lg:hidden',
            !aside.handle && 'hidden',
            call && aside.handle && 'overflow-y-auto overscroll-contain',
          )}
        >
          {call && aside.handle && <CallBoxes call={call} className="flex flex-col gap-5" />}
          <div className={cn('flex flex-1 flex-col', !(call && aside.handle) && 'min-h-0')}>
            <AgentDesk agent={agent} workspaceId={workspaceId} notify={ui.notify} />
          </div>
        </div>
      </div>
    </section>
  );
}
