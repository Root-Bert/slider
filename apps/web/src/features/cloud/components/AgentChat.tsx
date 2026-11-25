import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type {
  AccountAuthor,
  Attachment,
  CloudAgentChat,
  CloudAgentDetail,
  CloudAgentMessage,
  SenderMessage,
} from '@slider/shared';
import {
  tellTypingInCloudAgent,
  useDeleteSenderMessage,
  useEditSenderMessage,
  useMe,
  useMessageCloudAgent,
  usePlaceAgentMessage,
  useReactSenderMessage,
  useStopCloudAgent,
} from '@/lib/api';
import { draftKeys } from '@/lib/drafts';
import { routes } from '@/lib/routes';
import { AnswerBody } from '@/features/viewer';
import { MessageList, quoteOf, ReplyQuote, TypingLine, useSenderOrNull } from '@/features/sender';
import { cn, ConfirmDialog, Icon, IconButton } from '@/ui';
import { useCloudOrNull, type CloudUi } from '../hooks/useCloud';
import { choicesIn, withoutChoices } from '../lib/choices';
import { plainNamed, type Named } from '../lib/named';
import { AgentComposer } from './AgentComposer';
import { AgentAsks } from './AgentAsks';
import { AgentChoices, AgentWatching } from './AgentWatching';
import { useShownCall } from './CallPanel';
import { WithNamed } from './Named';

/** Opens what an answer named in Cloud: a file shows its details beside, the rest is gone to. */
function useOpenNamed(cloud: CloudUi | null) {
  const navigate = useNavigate();
  if (!cloud) return undefined;
  return (named: Named) => {
    if (named.kind === 'file') cloud.openFile(named.id);
    else if (named.kind === 'folder')
      void navigate(routes.cloudFolder(cloud.workspace.id, named.id));
    else if (named.kind === 'area') void navigate(routes.cloudArea(cloud.workspace.id, named.id));
    else void navigate(routes.deck(named.id));
  };
}

/**
 * What the chat needs of the app it stands in – one chat in both: in Cloud a named file opens
 * beside and a call over the page; in Sender (an agent as a conversation) what it names opens in
 * its app (`WithNamed`'s own way) and a call on Sender's page of it.
 */
function useChatPlace(agentId: string) {
  const cloud = useCloudOrNull();
  const sender = useSenderOrNull();
  const shownCall = useShownCall();
  const openNamed = useOpenNamed(cloud);
  const me = useMe().data?.viewer.author ?? null;
  if (cloud) {
    return {
      workspaceId: cloud.workspace.id,
      me,
      people: [] as AccountAuthor[],
      notify: (text: string, tone?: 'neutral' | 'danger') => cloud.notify(text, tone),
      callHref: shownCall.href,
      openNamed,
    };
  }
  if (!sender) throw new Error('AgentChat must be used in Cloud or Sender');
  const workspaceId = sender.workspace.id;
  return {
    workspaceId,
    me: sender.me,
    people: sender.home?.people ?? [],
    notify: (text: string, tone?: 'neutral' | 'danger') => sender.notify(text, tone),
    callHref: (callId: string) => routes.messagesAgentCall(workspaceId, agentId, callId),
    openNamed,
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

const NO_OLDER = { more: false, loading: false, load: () => {} };

/**
 * The agent's chat – `chat` null: none yet, it starts with the first message. Everyone who may
 * write writes here, and sees the others doing it. A conversation like any (`MessageList`, the
 * field every conversation has): reacted to, answered, changed – the agent's answers with how
 * they stand, what it asks to confirm, the choices it offers. Cloud's page, Sender's
 * (`AgentChatPage`), beside a mail.
 */
export function AgentChat({
  agent,
  chat,
  inline = false,
  autoFocus,
  onSend,
  search,
}: {
  agent: CloudAgentDetail;
  chat: CloudAgentChat | null;
  /** A part of a column that scrolls as one (`MailAside`): its messages no scroll of their own. */
  inline?: boolean;
  /** The field focused as it shows – by default only in an empty chat. */
  autoFocus?: boolean;
  /** Writes to the open chat in place of the plain message (beside a mail: which one). */
  onSend?: (
    text: string,
    chatId: string,
    attachments: Attachment[],
    replyTo?: string,
  ) => Promise<boolean>;
  /** The chat's search: only the messages it finds, marked (`lib/chat-search.ts`). */
  search?: { query: string; clear: () => void };
}) {
  const ui = useChatPlace(agent.id);
  const chatId = chat?.id ?? agent.id;
  const message = useMessageCloudAgent(ui.workspaceId, agent.id);
  const stop = useStopCloudAgent(ui.workspaceId, agent.id);
  const place = usePlaceAgentMessage(ui.workspaceId, agent.id);
  const edit = useEditSenderMessage(ui.workspaceId, chatId, place);
  const remove = useDeleteSenderMessage(ui.workspaceId, chatId, place);
  const react = useReactSenderMessage(
    ui.workspaceId,
    chatId,
    ui.me ?? { id: '', name: '', type: 'owner', color: 'blue' },
    place,
  );
  const composerRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [replying, setReplying] = useState<SenderMessage | null>(null);
  const [deleting, setDeleting] = useState<SenderMessage | null>(null);
  // The „Neu“ line stands before what was unread when the chat opened – an answer of the agent's
  // or another's words, done; not one's own, not the answer being written (that one is watched),
  // nor what comes in while one looks (its page reads it as it asks).
  const [readSeq] = useState(() => {
    const news = chat?.messages.findLast(
      (each) => each.state !== 'answering' && each.author?.id !== ui.me?.id,
    );
    return chat && news && chat.readSeq < news.seq ? chat.readSeq : Number.MAX_SAFE_INTEGER;
  });
  // Inline (the field stuck at the column's foot): once as one writes, then only while the
  // column stands (nearly) at its end – opened, the column stays put.
  const pinned = useRef(false);
  const shown = useRef(false);
  const counted = useRef(0);
  const messages = chat?.messages ?? [];
  const byId = new Map(messages.map((each) => [each.id, each]));
  const last = messages.at(-1);
  const searching = (search?.query.trim() ?? '') !== '';
  // What it noticed where it watches stands in its first chat, where it then works on it.
  const watching = chat?.id === agent.id ? agent.watching : [];
  const canWrite = agent.canWrite;
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
  const fail = (error: Error) => ui.notify(error.message, 'danger');
  const send = (text: string, attachments: Attachment[] = []) => {
    pinned.current = true;
    const replyTo = replying?.id;
    setReplying(null);
    const sent =
      chat && onSend
        ? onSend(text, chat.id, attachments, replyTo)
        : message.mutateAsync({ text, attachments, chatId, replyTo }).then(
            () => true,
            (error: Error) => {
              fail(error);
              return false;
            },
          );
    // Not sent: the words stay in the field (the composer keeps them), the quote above them.
    return sent.then((ok) => {
      if (!ok && replyTo) setReplying(byId.get(replyTo) ?? null);
      return ok;
    });
  };
  const reply = (each: SenderMessage) => {
    setReplying(each);
    composerRef.current?.querySelector<HTMLElement>('textarea, [contenteditable="true"]')?.focus();
  };
  const agentsOwn = (each: SenderMessage) => {
    const full = byId.get(each.id);
    return full?.role === 'assistant' && !full.call ? full : null;
  };
  useEffect(() => {
    if (!inline) return;
    const arrived = messages.length !== counted.current;
    counted.current = messages.length;
    const field = composerRef.current;
    const column = field && scrollParent(field);
    const first = !shown.current;
    shown.current = true;
    if (!field || !column || first) return;
    // How far the column stands from its end: scrolled up to read, far.
    const below = column.scrollHeight - column.scrollTop - column.clientHeight;
    if (pinned.current || below < FOLLOW_PX) column.scrollTop = column.scrollHeight;
    // Written: followed until it stands there (not used up by the quote going as it is sent).
    if (arrived) pinned.current = false;
  }, [
    inline,
    last?.text,
    chat?.doing,
    messages.length,
    watching.length,
    choices.length,
    // The quote above the field takes room: the column follows as it does for a message.
    replying?.id,
  ]);
  const lastOwn = ui.me
    ? [...messages]
        .reverse()
        .find((each) => !each.deleted && each.role === 'user' && each.author?.id === ui.me?.id)
    : undefined;
  return (
    <section
      aria-label="Chat"
      className={cn('flex min-w-0 flex-col gap-3', !inline && 'min-h-0 flex-1')}
    >
      {ui.me && (
        <MessageList
          conversationId={chatId}
          messages={messages}
          readSeq={readSeq}
          me={ui.me}
          people={ui.people}
          editing={editing}
          older={NO_OLDER}
          intro={null}
          inline={inline}
          onEditing={setEditing}
          onSave={(each, text) =>
            edit.mutate({ id: each.id, text, before: each }, { onError: fail })
          }
          onDelete={setDeleting}
          readOnly={!canWrite}
          onReact={
            canWrite
              ? (each, kind) => react.mutate({ before: each, kind }, { onError: fail })
              : undefined
          }
          onReply={canWrite ? reply : undefined}
          callHref={ui.callHref}
          search={search}
          writing={(each) => byId.get(each.id)?.state === 'answering'}
          copyOf={(each) => (agentsOwn(each) ? plainNamed(withoutChoices(each.text)) : each.text)}
          body={(each) => {
            const answer = agentsOwn(each);
            if (!answer) return undefined;
            const writing = answer.state === 'answering';
            return (
              <AnswerBody
                entry={{
                  text: withoutChoices(answer.text),
                  state: answer.state ?? 'done',
                  reading: writing ? (chat?.doing ?? null) : null,
                  readingIn: writing ? (chat?.doingIn ?? null) : null,
                  error: answer.error,
                }}
                renderText={(run) => (
                  <WithNamed text={run} workspaceId={ui.workspaceId} onOpen={ui.openNamed} />
                )}
                rollAway={false}
              />
            );
          }}
          below={(each) => (
            <AgentExtras
              message={byId.get(each.id)}
              last={each.id === last?.id}
              searching={searching}
              workspaceId={ui.workspaceId}
              agentId={agent.id}
              choices={choices}
              onPick={(text) => void send(text)}
              onError={(text) => ui.notify(text, 'danger')}
            />
          )}
          after={watching.length > 0 && <AgentWatching agent={agent} />}
        />
      )}
      {chat && <TypingLine people={chat.typing} />}
      {canWrite ? (
        <div
          ref={composerRef}
          // Inline: the field stays at the column's foot, on the page's colour – the column goes
          // under it.
          className={cn(
            'flex shrink-0 flex-col gap-1.5',
            inline && 'sticky bottom-0 z-10 bg-canvas pt-2',
          )}
        >
          {replying && (
            <div className="flex items-center gap-2 px-1">
              <Icon name="reply" size={16} className="shrink-0 text-fg-subtle" />
              <ReplyQuote quote={quoteOf(replying)} className="flex-1" />
              <IconButton
                icon="close"
                label="Nicht antworten"
                size="xs"
                variant="subtle"
                onClick={() => setReplying(null)}
              />
            </div>
          )}
          <AgentComposer
            placeholder={`Nachricht an ${agent.title}`}
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
                      workspaceId: ui.workspaceId,
                      agentId: agent.id,
                      chatId: chat.id,
                      name: agent.title,
                      chat: chat.id === agent.id ? null : chat.title,
                    },
                  }
                : undefined
            }
            workspaceId={ui.workspaceId}
            working={Boolean(chat?.running)}
            onTyping={chat ? () => tellTypingInCloudAgent(agent.id, chat.id) : undefined}
            onStop={chat ? () => stop.mutate(chat.id, { onError: fail }) : undefined}
            onEditLast={lastOwn ? () => setEditing(lastOwn.id) : undefined}
            onSend={send}
          />
        </div>
      ) : (
        <p className="shrink-0 text-xs text-fg-subtle">
          Hier schreiben Mitglieder und Admins des Workspace. Du liest mit.
        </p>
      )}
      {deleting && (
        <ConfirmDialog
          title="Nachricht löschen?"
          description="Sie verschwindet für alle in diesem Chat."
          confirmLabel="Löschen"
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            const each = deleting;
            setDeleting(null);
            remove.mutate(each, {
              onSuccess: () => ui.notify('Nachricht gelöscht'),
              onError: fail,
            });
          }}
        />
      )}
    </section>
  );
}

/** Under an agent's answer: what it asks to confirm; under the last, the choices it offers. */
function AgentExtras({
  message,
  last,
  searching,
  workspaceId,
  agentId,
  choices,
  onPick,
  onError,
}: {
  message: CloudAgentMessage | undefined;
  last: boolean;
  searching: boolean;
  workspaceId: string;
  agentId: string;
  choices: string[];
  onPick: (text: string) => void;
  onError: (text: string) => void;
}) {
  if (!message || searching) return null;
  return (
    <>
      {message.asks && message.asks.length > 0 && (
        <AgentAsks
          workspaceId={workspaceId}
          agentId={agentId}
          asks={message.asks}
          onError={onError}
        />
      )}
      {last && <AgentChoices choices={choices} onPick={onPick} />}
    </>
  );
}
