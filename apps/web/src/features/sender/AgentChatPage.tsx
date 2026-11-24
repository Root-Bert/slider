import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { isTagChat, type Attachment, type CloudAgentChat } from '@slider/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  senderKeys,
  tellTypingInCloudAgent,
  useCloudAgent,
  useMessageCloudAgent,
  useStopCloudAgent,
} from '@/lib/api';
import { chatMatches, useMarkedMatches, useShowHit } from '@/lib/chat-search';
import { draftKeys } from '@/lib/drafts';
import { routes } from '@/lib/routes';
import {
  AgentAsks,
  AgentAvatar,
  AgentChoices,
  AgentComposer,
  AgentDesk,
  CallEntry,
  useAgentAside,
  choicesIn,
  messageWords,
  plainNamed,
  withoutChoices,
  WithNamed,
} from '@/features/cloud';
import { AgentCallButton, CallBoxes, useAgentCall } from '@/features/calls';
import { ChatAnswer, ChatMessage } from '@/features/viewer';
import { ViewSearch } from '@/features/workspaces';
import { Avatar, ButtonLink, cn, EmptyState, Icon, useMediaQuery } from '@/ui';
import { agentFiles, ChatFiles } from './components/ChatFiles';
import { ChatTitle, useChatView } from './components/ChatTitle';
import { TypingLine } from './components/TypingLine';
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
  const message = useMessageCloudAgent(workspaceId, agentId);
  const stop = useStopCloudAgent(workspaceId, agentId);
  const agent = query.data;
  // The cards stand beside the chat from xl on (below they are hidden): only there a handle.
  const asideRef = useRef<HTMLDivElement>(null);
  const aside = useAgentAside(useMediaQuery('(min-width: 1024px)'), 360, asideRef);
  // One's call with it: a card at the top of the cards beside the chat, as in Cloud.
  const call = useAgentCall(agentId);
  // Its one chat (the chats of calls in conversations stay there).
  const chat: CloudAgentChat | undefined = agent?.chats.find((each) => each.id === agentId);
  const listRef = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);
  const messages = chat?.messages ?? [];
  const last = messages.at(-1);
  // The chat's search, beside its name; another agent starts without one.
  const [search, setSearch] = useState('');
  const wanted = search.trim();
  const searching = wanted !== '';
  useMarkedMatches(listRef, wanted);
  const showHit = useShowHit(listRef, searching, () => setSearch(''));
  // The chat or its „Dateien“, beside its name – as a conversation's (in the address).
  const { view, href: viewHref } = useChatView();

  // Another agent starts without a search.
  const [shown, setShown] = useState(agentId);
  if (shown !== agentId) {
    setShown(agentId);
    setSearch('');
  }
  useEffect(() => {
    pinned.current = true;
  }, [agentId]);
  // Opened, its answers are read (the server notes it when it is fetched): the count goes.
  const seen = agent?.chats.map((each) => each.messages.length).join() ?? '';
  useEffect(() => {
    if (seen) void queryClient.invalidateQueries({ queryKey: senderKeys.home(workspaceId) });
  }, [seen, workspaceId, queryClient]);
  useEffect(() => {
    const list = listRef.current;
    if (list && pinned.current) list.scrollTop = list.scrollHeight;
  }, [last?.text, chat?.doing, messages.length, chat?.id, view]);

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

  // Where it was called in a conversation it is written to only there (`@Agent`).
  const tagged = isTagChat(chat.id);
  const canWrite = agent.canWrite && !tagged;
  const choices =
    canWrite && !chat.running && last?.role === 'assistant' && last.state === 'done' && !last.call
      ? choicesIn(last.text)
      : [];
  const send = (text: string, attachments: Attachment[] = []) => {
    pinned.current = true;
    return message.mutateAsync({ text, attachments, chatId: chat.id }).then(
      () => true,
      (error: Error) => {
        ui.notify(error.message, 'danger');
        return false;
      },
    );
  };
  const shownMessages = searching
    ? messages.filter((each) => chatMatches(messageWords(each), wanted))
    : messages;
  const copied = (ok: boolean) =>
    ui.notify(ok ? 'Kopiert' : 'Nicht kopiert', ok ? 'neutral' : 'danger');

  return (
    <section aria-label={agent.title} className="flex min-h-0 flex-1 flex-col gap-3">
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
            <>
              <ol
                ref={listRef}
                aria-label="Nachrichten"
                onScroll={(event) => {
                  const list = event.currentTarget;
                  pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
                }}
                className="roll-away-list flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain py-3 pr-1 select-text [&>li:first-child]:mt-auto"
              >
                {searching && shownMessages.length === 0 && (
                  <li className="m-auto text-body text-fg-muted">Nichts gefunden.</li>
                )}
                {shownMessages.map((each) => (
                  <li
                    key={each.id}
                    data-message={each.id}
                    onClick={showHit(each.id)}
                    className={cn('flex flex-col', searching && 'cursor-pointer')}
                  >
                    {each.call ? (
                      // A call with it: one entry that opens the call's page, as in Cloud.
                      <CallEntry
                        call={each.call}
                        to={routes.messagesAgentCall(workspaceId, agent.id, each.call.id)}
                      />
                    ) : each.role === 'user' ? (
                      <ChatMessage
                        text={each.text}
                        attachments={each.attachments}
                        above={
                          each.author && (
                            <>
                              {chat?.calledIn && (
                                // Where it was called, before who called it: the chat keeps their words alone.
                                <span className="flex min-w-0 items-center gap-1">
                                  <Icon name="at" size={16} />
                                  <span className="truncate">{chat.calledIn}</span>
                                  {each.author.id !== ui.me.id && <span aria-hidden>|</span>}
                                </span>
                              )}
                              {each.author.id !== ui.me.id && each.author.name}
                              <Avatar author={each.author} size={20} nativeTitle={false} />
                            </>
                          )
                        }
                        onCopied={copied}
                      />
                    ) : (
                      <ChatAnswer
                        above={
                          <>
                            <AgentAvatar id={agent.id} size={22} className="rounded-mark" />
                            <span className="truncate">
                              {each.fromChat ? `Aus dem Chat „${each.fromChat}“` : agent.title}
                            </span>
                          </>
                        }
                        entry={{
                          id: each.id,
                          role: 'assistant',
                          text: withoutChoices(each.text),
                          state: each.state ?? 'done',
                          reading: each.state === 'answering' ? chat.doing : null,
                          readingIn: each.state === 'answering' ? (chat.doingIn ?? null) : null,
                          error: each.error,
                        }}
                        renderText={(run) => <WithNamed text={run} workspaceId={workspaceId} />}
                        copyText={(text) => plainNamed(withoutChoices(text))}
                        onCopied={copied}
                      />
                    )}
                    {each.asks && each.asks.length > 0 && !searching && (
                      <AgentAsks
                        workspaceId={workspaceId}
                        agentId={agent.id}
                        asks={each.asks}
                        onError={(text) => ui.notify(text, 'danger')}
                      />
                    )}
                    {each === last && !searching && (
                      <AgentChoices choices={choices} onPick={(text) => void send(text)} />
                    )}
                  </li>
                ))}
              </ol>
              <TypingLine people={chat.typing} />
              {canWrite ? (
                <AgentComposer
                  placeholder={`Nachricht an ${agent.title}`}
                  autoFocus
                  keep={{
                    key: draftKeys.agent(agent.id, chat.id),
                    target: {
                      kind: 'agent',
                      workspaceId,
                      agentId: agent.id,
                      chatId: chat.id,
                      name: agent.title,
                      chat: chat.id === agent.id ? null : chat.title,
                    },
                  }}
                  working={chat.running}
                  onTyping={() => tellTypingInCloudAgent(agent.id, chat.id)}
                  onStop={() =>
                    stop.mutate(chat.id, { onError: (error) => ui.notify(error.message, 'danger') })
                  }
                  onSend={send}
                />
              ) : (
                <p className="shrink-0 text-xs text-fg-subtle">
                  {tagged
                    ? 'Hier arbeitet der Agent für die Unterhaltung, in der er gerufen wurde – ruf ihn dort mit @Agent.'
                    : 'Du liest bei diesem Agenten mit.'}
                </p>
              )}
            </>
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
