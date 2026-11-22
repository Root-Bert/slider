import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { isTagChat, type CloudAgentChat, type CloudAgentDetail } from '@slider/shared';
import {
  tellTypingInCloudAgent,
  useMessageCloudAgent,
  useOpenCloudAgentChat,
  useStopCloudAgent,
} from '@/lib/api';
import { draftKeys } from '@/lib/drafts';
import { routes } from '@/lib/routes';
import { ChatAnswer, ChatMessage } from '@/features/viewer';
import { Avatar, cn, Icon } from '@/ui';
import { useCloud } from '../hooks/useCloud';
import { choicesIn, withoutChoices } from '../lib/choices';
import { plainNamed, type Named } from '../lib/named';
import { AgentAvatar } from './AgentAvatar';
import { AgentComposer } from './AgentComposer';
import { AgentChoices, AgentWatching } from './AgentWatching';
import { CallEntry } from './CallRecord';
import { WithNamed } from './Named';

/** Opens what an answer named: a file shows its details beside, the rest is gone to. */
function useOpenNamed() {
  const ui = useCloud();
  const navigate = useNavigate();
  return (named: Named) => {
    if (named.kind === 'file') ui.openFile(named.id);
    else if (named.kind === 'folder') void navigate(routes.cloudFolder(ui.workspace.id, named.id));
    else if (named.kind === 'area') void navigate(routes.cloudArea(ui.workspace.id, named.id));
    else void navigate(routes.deck(named.id));
  };
}

/** Inline, the column follows the answer while it stands at most this far from its end. */
const FOLLOW_PX = 120;

/** The box that scrolls an inline chat (`MailAside`'s column). */
function scrollParent(element: HTMLElement) {
  for (let box = element.parentElement; box; box = box.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(box).overflowY)) return box;
  }
  return null;
}

/** „Vera schreibt …“ – who is writing a message in the chat right now. */
function Typing({ chat }: { chat: CloudAgentChat }) {
  const [first, ...more] = chat.typing;
  if (!first) return null;
  return (
    <p aria-live="polite" className="flex shrink-0 items-center gap-2 px-1 text-xs text-fg-subtle">
      <Avatar author={first} size={16} nativeTitle={false} />
      {more.length === 0
        ? `${first.name} schreibt …`
        : `${first.name} und ${more.length === 1 ? (more[0]?.name ?? '') : `${more.length} weitere`} schreiben …`}
    </p>
  );
}

/**
 * One of the agent's chats – `chat` null: a new one beside the others, which starts with its
 * first message. Everyone who may write writes here, and sees the others doing it.
 */
export function AgentChat({
  agent,
  chat,
  onOpened,
  inline = false,
  autoFocus,
  onSend,
}: {
  agent: CloudAgentDetail;
  chat: CloudAgentChat | null;
  onOpened: (chatId: string) => void;
  /** A part of a column that scrolls as one (`MailAside`): its messages no scroll of their own. */
  inline?: boolean;
  /** The field focused as it shows – by default only in a new chat. */
  autoFocus?: boolean;
  /** Writes to the open chat in place of the plain message (beside a mail: which one). */
  onSend?: (text: string, chatId: string) => Promise<boolean>;
}) {
  const ui = useCloud();
  const message = useMessageCloudAgent(ui.workspace.id, agent.id);
  const openChat = useOpenCloudAgentChat(ui.workspace.id, agent.id);
  const stop = useStopCloudAgent(ui.workspace.id, agent.id);
  const listRef = useRef<HTMLOListElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  // Follows the answer while it is written, unless one scrolled up to read. Inline (the field
  // stuck at the column's foot): once as one writes, then only while the column stands (nearly)
  // at its end – opened, the column stays put.
  const pinned = useRef(!inline);
  const shown = useRef(false);
  const messages = chat?.messages ?? [];
  const last = messages.at(-1);
  const openNamed = useOpenNamed();
  // What it noticed where it watches stands in its first chat, where it then works on it.
  const watching = chat?.id === agent.id ? agent.watching : [];
  // Where it was called in a conversation it is written to only there (`@Agent`).
  const tagged = chat !== null && isTagChat(chat.id);
  const canWrite = agent.canWrite && !tagged;
  // A question of its own with answers to pick: under its last message, until answered.
  const choices =
    chat &&
    canWrite &&
    !chat.running &&
    last?.role === 'assistant' &&
    last.state === 'done' &&
    !last.call
      ? choicesIn(last.text)
      : [];
  const send = (text: string) => {
    pinned.current = true;
    if (chat && onSend) return onSend(text, chat.id);
    const sent = chat
      ? message.mutateAsync({ text, chatId: chat.id })
      : openChat.mutateAsync(text).then(({ chatId }) => onOpened(chatId));
    return sent.then(
      () => true,
      (error: Error) => {
        ui.notify(error.message, 'danger');
        return false;
      },
    );
  };
  useEffect(() => {
    const list = listRef.current;
    if (inline) {
      const field = composerRef.current;
      const column = field && scrollParent(field);
      const first = !shown.current;
      shown.current = true;
      if (!field || !column || first) return;
      // How far the column stands from its end: scrolled up to read, far.
      const below = column.scrollHeight - column.scrollTop - column.clientHeight;
      if (pinned.current || below < FOLLOW_PX) column.scrollTop = column.scrollHeight;
      pinned.current = false;
      return;
    }
    if (list && pinned.current) list.scrollTop = list.scrollHeight;
  }, [inline, last?.text, chat?.doing, messages.length, watching.length, choices.length]);
  return (
    <section
      aria-label="Chat"
      className={cn('flex min-w-0 flex-col gap-3', !inline && 'min-h-0 flex-1')}
    >
      <ol
        ref={listRef}
        onScroll={(event) => {
          const list = event.currentTarget;
          pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
        }}
        // No frame: the chat stands free on the page, as in Sender, and reaches up to the chats'
        // row – a message fades out right under it, with room above the first one.
        className={cn(
          'flex flex-col gap-4 select-text',
          !inline &&
            'roll-away-list -mt-5 min-h-0 flex-1 overflow-y-auto overscroll-contain pt-12 pb-3',
        )}
      >
        {!chat && (
          <li className="m-auto max-w-[420px] text-center text-body text-fg-muted">
            Ein weiterer Chat in diesem Agenten: an derselben Sache, mit demselben Schreibtisch.
            Alle hier sehen ihn sofort, und die Chats wissen voneinander.
          </li>
        )}
        {messages.map((each) => (
          <li key={each.id} className="flex flex-col">
            {each.call ? (
              // A call with it: one entry that opens the call's page.
              <CallEntry
                call={each.call}
                to={routes.cloudAgentCall(ui.workspace.id, agent.id, each.call.id)}
              />
            ) : each.role === 'user' ? (
              <ChatMessage
                text={each.text}
                above={
                  each.author && (
                    <>
                      {chat?.calledIn && (
                        // Where it was called, before who called it: the chat keeps their words alone.
                        <span className="flex min-w-0 items-center gap-1">
                          <Icon name="at" size={16} />
                          <span className="truncate">{chat.calledIn}</span>
                          {each.author.id !== ui.userId && <span aria-hidden>·</span>}
                        </span>
                      )}
                      {each.author.id !== ui.userId && each.author.name}
                      <Avatar author={each.author} size={20} nativeTitle={false} />
                    </>
                  )
                }
                onCopied={(ok) =>
                  ui.notify(ok ? 'Nachricht kopiert' : 'Nicht kopiert', ok ? 'neutral' : 'danger')
                }
              />
            ) : (
              <ChatAnswer
                // Who answers: the agent with its picture, as a person has theirs.
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
                  reading: each.state === 'answering' ? (chat?.doing ?? null) : null,
                  readingIn: each.state === 'answering' ? (chat?.doingIn ?? null) : null,
                  error: each.error,
                }}
                renderText={(run) => (
                  <WithNamed text={run} workspaceId={ui.workspace.id} onOpen={openNamed} />
                )}
                copyText={(text) => plainNamed(withoutChoices(text))}
                onCopied={(ok) =>
                  ui.notify(ok ? 'Antwort kopiert' : 'Nicht kopiert', ok ? 'neutral' : 'danger')
                }
              />
            )}
            {each === last && <AgentChoices choices={choices} onPick={(text) => void send(text)} />}
          </li>
        ))}
        {watching.length > 0 && <AgentWatching agent={agent} />}
      </ol>
      {chat && <Typing chat={chat} />}
      {canWrite ? (
        <div
          ref={composerRef}
          // Inline: the field stays at the column's foot, on the page's colour – the column goes
          // under it.
          className={cn('flex shrink-0 flex-col', inline && 'sticky bottom-0 z-10 bg-canvas pt-2')}
        >
          <AgentComposer
            placeholder={
              chat ? 'Schreib dem Agenten …' : 'Was soll in diesem Chat erledigt werden?'
            }
            autoFocus={autoFocus ?? !chat}
            inline={inline}
            // Its own page: typing goes in from anywhere on it; beside a mail, letters are the mail's.
            typeInto={!inline}
            keep={
              chat
                ? {
                    key: draftKeys.agent(agent.id, chat.id),
                    target: {
                      kind: 'agent',
                      workspaceId: ui.workspace.id,
                      agentId: agent.id,
                      chatId: chat.id,
                      name: agent.title,
                      chat: chat.id === agent.id ? null : chat.title,
                    },
                  }
                : undefined
            }
            busy={openChat.isPending}
            working={Boolean(chat?.running)}
            onTyping={chat ? () => tellTypingInCloudAgent(agent.id, chat.id) : undefined}
            onStop={
              chat
                ? () =>
                    stop.mutate(chat.id, { onError: (error) => ui.notify(error.message, 'danger') })
                : undefined
            }
            onSend={send}
          />
        </div>
      ) : (
        <p className="shrink-0 text-xs text-fg-subtle">
          {tagged
            ? 'Hier arbeitet der Agent für die Unterhaltung, in der er gerufen wurde – ruf ihn dort mit @Agent.'
            : 'Hier schreiben Mitglieder und Admins des Workspace. Du liest mit.'}
        </p>
      )}
    </section>
  );
}
