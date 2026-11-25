import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import {
  CONVERSATION_AGENT_TAG,
  callableHere,
  MAX_SENDER_NAME,
  MAX_SENDER_TOPIC,
  type Attachment,
  type CloudAgentSummary,
  type SenderChannel,
  type SenderChannelAgent,
  type SenderMessage,
  type SenderScheduled,
} from '@slider/shared';
import {
  isPending,
  messagesOf,
  newPendingId,
  tellTypingInSender,
  useDeleteSenderChannel,
  useDeleteSenderMessage,
  useEditSenderMessage,
  useLeaveSenderGroup,
  useDiscardFailedSend,
  useFailedSends,
  usePostSenderMessage,
  useReactSenderMessage,
  useReadSenderChannel,
  useSenderMessages,
  useCloudAgents,
  useAddSenderAgent,
  useRemoveSenderAgent,
  useUpdateSenderChannel,
  useDeleteSenderScheduled,
  useScheduleSenderMessage,
  useSendSenderScheduledNow,
  useSenderScheduled,
} from '@/lib/api';
import { draftOf, setDraft } from '@/lib/drafts';
import { routes } from '@/lib/routes';
import { CallBoxes, CallButtons, useChannelCall } from '@/features/calls';
import { AgentAvatar, AreaDot, AsideToggle, useAgentAside } from '@/features/cloud';
import { useAgentAvatars, ViewSearch, WorkspaceMark } from '@/features/workspaces';
import {
  AvatarStack,
  cn,
  ConfirmDialog,
  EmptyState,
  Icon,
  IconButton,
  Menu,
  type MenuAction,
  useMediaQuery,
} from '@/ui';
import { AddPeople } from './components/AddPeople';
import { Composer, type TagAgent } from './components/Composer';
import { useAttachments } from '@/features/attachments';
import { MessageList } from './components/MessageList';
import { ReplyQuote } from './components/ReplyQuote';
import { ScheduledLines } from './components/ScheduledLine';
import { PersonFace } from './components/PersonFace';
import { quoteOf } from './lib/quote';
import { ChatFiles } from './components/ChatFiles';
import { ChatTitle, useChatView } from './components/ChatTitle';
import { ChatAgents, useChatAside } from './components/ChatAside';
import { TypingLine } from './components/TypingLine';
import { MenuButton } from './components/MenuButton';
import { useMuteAction } from './hooks/useMuteAction';
import { useUnreadAction } from './hooks/useUnreadAction';
import { useSender } from './hooks/useSender';
import { PAGE_HEADER } from './lib/title';

/** A field in the header in place of the name: Enter keeps it, Esc leaves it. */
function InlineField({
  label,
  value,
  max,
  onDone,
  className,
}: {
  label: string;
  value: string;
  max: number;
  onDone: (value: string | null) => void;
  className: string;
}) {
  const [text, setText] = useState(value);
  return (
    <input
      aria-label={label}
      autoFocus
      value={text}
      maxLength={max}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => onDone(text.trim() === value ? null : text)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          onDone(text.trim() === value ? null : text);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onDone(null);
        }
      }}
      className={`-mx-1.5 w-full rounded-chip bg-hover px-1.5 outline-none focus-visible:ring-1 focus-visible:ring-focus ${className}`}
    />
  );
}

function Mark({ channel }: { channel: SenderChannel }) {
  const ui = useSender();
  const area = ui.home?.areas.find((each) => each.id === channel.areaId);
  if (channel.kind === 'direct' && channel.person)
    return <PersonFace person={channel.person} size={32} workspaceId={ui.workspace.id} />;
  if (channel.kind === 'area' && area) {
    return area.root ? (
      <WorkspaceMark name={ui.workspace.name} logoUrl={ui.workspace.logoUrl} size={32} />
    ) : (
      <span className="flex size-8 items-center justify-center rounded-chip bg-surface-2">
        <AreaDot color={area.color} size="md" />
      </span>
    );
  }
  return (
    <span className="flex size-8 items-center justify-center rounded-chip bg-surface-2 text-fg-muted">
      <Icon name={channel.kind === 'group' ? 'groups' : 'chatBubble'} size={18} />
    </span>
  );
}

function Intro({ channel }: { channel: SenderChannel }) {
  const text =
    channel.kind === 'direct'
      ? `Der Anfang eurer Unterhaltung. Was ihr hier schreibt, lest nur ihr beide.`
      : channel.kind === 'group'
        ? 'Der Anfang der Gruppe. Was hier steht, lesen nur ihre Personen.'
        : channel.kind === 'area'
          ? `Der Anfang des Kanals. Alle, die den Bereich ${channel.name} sehen, lesen mit.`
          : `Der Anfang von #${channel.name}. Alle, die den Bereich sehen, lesen mit.`;
  // Who calls an agent with @ shows it what was said before – as said, no order.
  const agent =
    channel.kind === 'area' || channel.kind === 'channel'
      ? ' Mit @Agent rufst du den Agenten des Bereichs, mit @ und seinem Namen jeden Agenten des Bereichs oder einen eigenen – er liest dann mit, was zuvor hier stand.'
      : ' Mit @ und seinem Namen rufst du einen eigenen Agenten oder einen aus deinen Bereichen – er liest dann mit, was zuvor hier stand.';
  return (
    <div className="flex flex-col items-start gap-3 px-3 pt-6 pb-4">
      <Mark channel={channel} />
      <p className="text-base font-semibold text-fg">{channel.name}</p>
      <p className="max-w-[520px] text-body text-fg-muted">
        {text}
        {agent}
      </p>
    </div>
  );
}

type Asking = { kind: 'message'; message: SenderMessage } | { kind: 'channel' } | { kind: 'leave' };

/** Sender's route: the conversation named in the address. */
export function Component() {
  const { channelId = '' } = useParams();
  return <Conversation channelId={channelId} />;
}

/**
 * One conversation: its name above, the messages, who is writing, the field. What one
 * writes stands at once; changes and deletions too. `compact`: under a title of its own (an
 * area's „Chat“ in Cloud) – the head keeps only the calls, the people and the menu. `callHref`:
 * where a call over opens – in Cloud beside the chat (`CallPanel`), so one stays where one is.
 */
export function Conversation({
  channelId,
  compact = false,
  callHref,
}: {
  channelId: string;
  compact?: boolean;
  callHref?: (callId: string) => string;
}) {
  const ui = useSender();
  const navigate = useNavigate();
  const workspaceId = ui.workspace.id;
  const query = useSenderMessages(workspaceId, channelId);
  const post = usePostSenderMessage(workspaceId, channelId, ui.me);
  const failedOf = useFailedSends();
  const discard = useDiscardFailedSend(workspaceId, channelId);
  // „Später senden“: one's planned messages here, above the field.
  const planned = useSenderScheduled(workspaceId, channelId);
  const schedule = useScheduleSenderMessage(workspaceId, channelId);
  const unplan = useDeleteSenderScheduled(workspaceId, channelId);
  const sendNow = useSendSenderScheduledNow(workspaceId, channelId);
  // „Bearbeiten“ on a planned one: its words back into the field (after what stands there).
  const [refill, setRefill] = useState<{ text: string } | null>(null);
  // Files put on the message being written – kept per conversation, as its words.
  const attach = useAttachments({
    workspaceId,
    keep: `sender:${channelId}`,
    onError: (text) => ui.notify(text, 'danger'),
  });
  const edit = useEditSenderMessage(workspaceId, channelId);
  const remove = useDeleteSenderMessage(workspaceId, channelId);
  const react = useReactSenderMessage(workspaceId, channelId, ui.me);
  const update = useUpdateSenderChannel(workspaceId, channelId);
  const addAgent = useAddSenderAgent(workspaceId, channelId);
  const removeAgent = useRemoveSenderAgent(workspaceId, channelId);
  const cloudAgents = useCloudAgents(workspaceId);
  const deleteChannel = useDeleteSenderChannel(workspaceId);
  const leave = useLeaveSenderGroup(workspaceId);
  const read = useReadSenderChannel(workspaceId);
  const [editing, setEditing] = useState<string | null>(null);
  // „Antworten“: the message answered, quoted above the field – of this conversation only.
  const [replyingTo, setReplyingTo] = useState<SenderMessage | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState<'name' | 'topic' | null>(null);
  const [adding, setAdding] = useState(false);
  const muteAction = useMuteAction(workspaceId, ui.notify);
  const unreadAction = useUnreadAction(workspaceId, ui.notify);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [search, setSearch] = useState('');
  // In its call: the call beside the messages, as on an agent's page (the corner's dock stands
  // back); where there is no room for both, the dock as always.
  const inCall = useChannelCall(channelId);
  const asideRef = useRef<HTMLDivElement>(null);
  const wide = useMediaQuery('(min-width: 1024px)');
  // „KI zum Chat“: its agents beside the messages, as the AI beside a mail – where there is room.
  const [aiOpen, setAiOpen] = useChatAside();
  const ai = wide && aiOpen;
  const aside = useAgentAside(wide && (!!inCall || ai), 360, asideRef);

  const messages = useMemo(() => messagesOf(query.data), [query.data]);
  const replying =
    replyingTo && messages.some((each) => each.id === replyingTo.id && !each.deleted)
      ? replyingTo
      : null;
  const page = query.data?.pages[0];
  // The side bar's copy is the live one (names, counts); the page's has the people.
  const channel = page
    ? { ...page.channel, ...ui.channel(channelId), members: page.channel.members }
    : undefined;
  const isRootArea = !!ui.home?.areas.some((area) => area.root && area.id === channel?.areaId);
  // Where the „Neu“ line stands: what was read when it opened, not what is read now.
  const [readAt, setReadAt] = useState<{ id: string; seq: number } | null>(null);
  if (page && readAt?.id !== channelId) setReadAt({ id: channelId, seq: page.readSeq });
  // The chat or its „Dateien“, beside its name (in the address). Under an area's title none: its
  // files lie in the area's „Chat-Dateien“ in Cloud.
  const { view: tab, href: viewHref } = useChatView(!compact);
  // Another conversation: nothing of the last one stays open.
  const [shown, setShown] = useState(channelId);
  if (shown !== channelId) {
    setShown(channelId);
    setEditing(null);
    setRenaming(null);
    setAdding(false);
    setSearch('');
  }
  // Opened from the side bar's search: its words searched here, once per visit.
  const location = useLocation();
  const find = (location.state as { find?: string } | null)?.find;
  const [found, setFound] = useState<string | null>(null);
  if (find && found !== location.key) {
    setFound(location.key);
    setSearch(find);
  }

  // Searched, its older messages come in too: the search looks through the whole conversation.
  const searching = search.trim() !== '';
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    if (searching && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [searching, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const { setOpenChannel } = ui;
  useEffect(() => {
    setOpenChannel(channelId);
    return () => setOpenChannel(null);
  }, [channelId, setOpenChannel]);

  // What stands on screen is read – now, and whenever the tab comes back.
  const lastSeq = [...messages].reverse().find((each) => !isPending(each))?.seq ?? 0;
  useEffect(() => {
    const mark = () => {
      if (document.visibilityState === 'visible' && lastSeq > 0) read(channelId, lastSeq);
    };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [channelId, lastSeq, read]);

  if (query.isError && !query.data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <MenuButton />
        <div className="m-auto">
          <EmptyState
            title="Unterhaltung nicht gefunden"
            message="Es gibt sie nicht mehr, oder du siehst sie nicht."
          />
        </div>
      </div>
    );
  }
  if (!channel) return null;

  const people = (ui.home?.people ?? []).filter((person) => person.id !== ui.me.id);
  const root = Boolean(ui.home?.areas.find((area) => area.id === channel.areaId)?.root);
  // The agents one may call here – or add: the area's and one's own, elsewhere those one sees.
  const callable = (cloudAgents.data ?? []).filter((agent) =>
    callableHere(
      { userId: agent.owner.id, shared: agent.shared, areaId: agent.areaId },
      { kind: channel.kind, areaId: channel.areaId, root },
      ui.me.id,
    ),
  );
  const fail = (error: Error) => ui.notify(error.message, 'danger');
  // Gone from the head and the AI's column: no toast.
  const dropAgent = (agent: SenderChannelAgent) => removeAgent.mutate(agent.id, { onError: fail });
  // An agent into the conversation (`undefined`: a new one) – its name, once there; `null`: refused.
  const bringAgent = (agent?: SenderChannelAgent) =>
    addAgent.mutateAsync({ agent }).then(
      (added) => {
        const title =
          agent?.title ??
          added.agents.find((each) => !channel.agents.some((was) => was.id === each.id))?.title ??
          'Agent';
        return title;
      },
      (error: Error) => {
        fail(error);
        return null;
      },
    );
  const addAgentMenu = (icon?: 'add') =>
    channel.canWrite && (
      <AddAgent
        workspaceId={workspaceId}
        callable={callable}
        here={channel.agents}
        icon={icon}
        onPick={(agent) => void bringAgent(agent)}
      />
    );
  // Not sent: it stays in the list with why, „Erneut senden“ or „Löschen“ – no toast.
  const send = (text: string, attachments: Attachment[]) => {
    post.mutate({
      text,
      attachments,
      pendingId: newPendingId(),
      replyTo: replying ? quoteOf(replying) : undefined,
    });
    setReplyingTo(null);
  };
  // Refused: said, the words and files back into the field.
  const sendLater = (text: string, attachments: Attachment[], at: Date) =>
    schedule
      .mutateAsync({
        text,
        attachments,
        replyTo: replying?.id,
        sendAt: at,
        pendingId: newPendingId(),
      })
      .then(
        () => {
          setReplyingTo(null);
          return true;
        },
        (error: Error) => {
          ui.notify(error.message, 'danger');
          return false;
        },
      );
  const editPlanned = (one: SenderScheduled) =>
    unplan.mutate(one, {
      onSuccess: (was) => {
        const standing = draftOf(channelId).trim();
        const text = standing ? `${standing}\n${was.text}` : was.text;
        // Kept as the draft too: gone from the server, it must not go with a reload.
        setDraft(channelId, text, { kind: 'conversation', workspaceId });
        setRefill({ text });
        attach.restore(was.attachments);
        const answered = was.replyTo && messages.find((each) => each.id === was.replyTo);
        if (answered) setReplyingTo(answered);
      },
      onError: (error) => ui.notify(error.message, 'danger'),
    });
  const reply = (message: SenderMessage) => {
    setReplyingTo(message);
    composerRef.current?.querySelector<HTMLElement>('textarea, [contenteditable="true"]')?.focus();
  };
  const lastOwn = [...messages]
    .reverse()
    .find(
      (each) =>
        !each.deleted &&
        !isPending(each) &&
        each.author?.id === ui.me.id &&
        !each.agent &&
        !each.call,
    );

  const actions: MenuAction[] = [
    ...(channel.kind === 'group'
      ? [
          {
            label: 'Personen …',
            icon: 'groups',
            onSelect: () => setAdding(true),
          } satisfies MenuAction,
        ]
      : []),
    ...(channel.canManage && (channel.kind === 'channel' || channel.kind === 'group')
      ? [
          {
            label: 'Umbenennen',
            icon: 'driveFileRename',
            onSelect: () => setRenaming('name'),
          } satisfies MenuAction,
        ]
      : []),
    // What it is about: a line under its name, typed into where it stands.
    ...(channel.canManage && channel.kind !== 'direct'
      ? [
          {
            label: channel.topic ? 'Thema ändern' : 'Thema festlegen',
            icon: 'notes',
            onSelect: () => setRenaming('topic'),
          } satisfies MenuAction,
        ]
      : []),
    ...(channel.canWrite
      ? channel.agents
          .filter((agent) => !agent.own)
          .map(
            (agent) =>
              ({
                label: `${agent.title} entfernen`,
                key: `remove:${agent.id}`,
                icon: 'close',
                onSelect: () => dropAgent(agent),
              }) satisfies MenuAction,
          )
      : []),
    unreadAction(channel, ui.homePath),
    muteAction(channel),
    ...(channel.kind === 'group'
      ? [
          {
            label: 'Gruppe verlassen',
            icon: 'logout',
            onSelect: () => setAsking({ kind: 'leave' }),
          } satisfies MenuAction,
        ]
      : []),
    ...(channel.canManage && channel.kind === 'channel'
      ? [
          {
            label: 'Löschen',
            icon: 'delete',
            tone: 'danger',
            onSelect: () => setAsking({ kind: 'channel' }),
          } satisfies MenuAction,
        ]
      : []),
  ];
  const shownName = channel.kind === 'channel' ? `#${channel.name}` : channel.name;
  const typing = ui.typingIn(channelId);

  return (
    <section aria-label={shownName} className="flex min-h-0 flex-1 flex-col gap-3">
      <header className={cn(PAGE_HEADER, 'max-sm:flex-wrap', compact && 'min-h-8')}>
        <MenuButton />
        {!compact && <Mark channel={channel} />}
        <div className="flex min-w-0 flex-1 flex-col">
          {compact && renaming !== 'name' ? null : renaming === 'name' ? (
            <InlineField
              label="Name"
              value={channel.name}
              max={MAX_SENDER_NAME}
              className="h-9 text-display font-semibold tracking-tight text-fg"
              onDone={(value) => {
                setRenaming(null);
                if (value !== null) update.mutate({ name: value }, { onError: fail });
              }}
            />
          ) : (
            <ChatTitle
              name={shownName}
              view={tab}
              href={viewHref}
              // The workspace's own chat: „Bereiche“ beside it, its people.
              areas={channel.kind === 'area' && isRootArea ? ui.areasPath : undefined}
            />
          )}
          {!compact &&
            (renaming === 'topic' ? (
              <InlineField
                label="Thema"
                value={channel.topic}
                max={MAX_SENDER_TOPIC}
                className="h-5 text-xs text-fg-muted"
                onDone={(value) => {
                  setRenaming(null);
                  if (value !== null) update.mutate({ topic: value }, { onError: fail });
                }}
              />
            ) : (
              channel.topic && (
                <p className="truncate text-xs text-fg-subtle" title={channel.topic}>
                  {channel.topic}
                </p>
              )
            ))}
        </div>
        <ViewSearch
          label={tab === 'files' ? 'Dateien durchsuchen' : 'Chat durchsuchen'}
          value={search}
          onChange={setSearch}
          // On a phone on a line of its own, under the name.
          className="w-64 max-sm:order-last max-sm:w-full"
        />
        <CallButtons channel={channel} />
        {/* The AI's column open, its agents stand there and are added there. */}
        {!ai && <AgentsHere channel={channel} />}
        {!ai && addAgentMenu()}
        {channel.kind !== 'direct' && channel.members.length > 0 && (
          <AvatarStack authors={channel.members} max={4} size={24} interactive />
        )}
        {actions.length > 0 && (
          <Menu label={`Aktionen für ${shownName}`} actions={actions} triggerVariant="subtle" />
        )}
        {wide && (
          <AsideToggle
            bare
            shown={ai}
            onToggle={() => setAiOpen(!ai)}
            label="KI zum Chat"
            title="KI zum Chat – die Agenten dieser Unterhaltung"
          />
        )}
      </header>
      {adding && channel.kind === 'group' && (
        <AddPeople channel={channel} onDone={() => setAdding(false)} />
      )}
      <div className={cn('flex min-h-0 flex-1', !aside.handle && 'gap-5')}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {tab === 'files' ? (
            <ChatFiles
              channelId={channelId}
              workspaceId={workspaceId}
              search={search}
              notify={ui.notify}
            />
          ) : (
            <>
              <div className="flex min-h-0 flex-1 flex-col">
                <MessageList
                  conversationId={channelId}
                  messages={messages}
                  readSeq={readAt?.id === channelId ? readAt.seq : (page?.readSeq ?? 0)}
                  me={ui.me}
                  people={ui.home?.people ?? []}
                  editing={editing}
                  older={{
                    more: query.hasNextPage,
                    loading: query.isFetchingNextPage,
                    load: () => void query.fetchNextPage(),
                  }}
                  intro={<Intro channel={channel} />}
                  onEditing={setEditing}
                  onSave={(message, text) =>
                    edit.mutate({ id: message.id, text, before: message }, { onError: fail })
                  }
                  onDelete={(message) => setAsking({ kind: 'message', message })}
                  moderate={channel.canManage}
                  onReact={
                    channel.canWrite
                      ? (message, kind) =>
                          react.mutate({ before: message, kind }, { onError: fail })
                      : undefined
                  }
                  failed={(message) => failedOf(message.id)?.reason}
                  onRetry={(message) => {
                    const again = failedOf(message.id);
                    if (again) post.mutate({ ...again, pendingId: message.id });
                  }}
                  onDiscard={(message) => discard(message.id)}
                  onReply={channel.canWrite ? reply : undefined}
                  callHref={
                    callHref ??
                    ((callId) => routes.messagesChannelCall(workspaceId, channelId, callId))
                  }
                  search={{ query: search, clear: () => setSearch('') }}
                />
              </div>
              <TypingLine people={typing} />
              {channel.canWrite ? (
                <div ref={composerRef} className="flex shrink-0 flex-col gap-1.5">
                  <ScheduledLines
                    planned={planned.data ?? []}
                    // Per call, not mutate()'s callbacks: those answer only the latest of two quick ones.
                    onSendNow={(one) =>
                      void sendNow
                        .mutateAsync(one)
                        .catch((error: Error) => ui.notify(error.message, 'danger'))
                    }
                    onEdit={editPlanned}
                    onDelete={(one) =>
                      void unplan.mutateAsync(one).then(
                        () => ui.notify('Geplante Nachricht gelöscht'),
                        (error: Error) => ui.notify(error.message, 'danger'),
                      )
                    }
                  />
                  {replying && (
                    <div className="flex items-center gap-2 px-1">
                      <Icon name="reply" size={16} className="shrink-0 text-fg-subtle" />
                      <ReplyQuote quote={quoteOf(replying)} className="flex-1" />
                      <IconButton
                        icon="close"
                        label="Nicht antworten"
                        size="xs"
                        variant="subtle"
                        onClick={() => setReplyingTo(null)}
                      />
                    </div>
                  )}
                  <Composer
                    conversationId={channelId}
                    target={{ kind: 'conversation', workspaceId }}
                    placeholder={`Nachricht an ${shownName}`}
                    people={people}
                    agents={agentsToTag(channel, callable)}
                    onNewAgent={() => bringAgent()}
                    onSend={send}
                    onSchedule={sendLater}
                    prefill={refill}
                    everyone
                    attach={attach}
                    onTyping={() => tellTypingInSender(channelId)}
                    onEditLast={lastOwn ? () => setEditing(lastOwn.id) : undefined}
                  />
                </div>
              ) : (
                <p className="shrink-0 text-xs text-fg-subtle">Du liest in diesem Bereich mit.</p>
              )}
            </>
          )}
        </div>
        {aside.handle}
        {aside.handle && (
          <div
            ref={asideRef}
            style={aside.style}
            className="flex min-h-0 shrink-0 flex-col gap-8 overflow-y-auto overscroll-contain px-1 pt-1"
          >
            {inCall && <CallBoxes call={inCall} className="flex flex-col gap-5" />}
            {ai && <ChatAgents channel={channel} add={addAgentMenu('add')} onRemove={dropAgent} />}
          </div>
        )}
      </div>
      {asking?.kind === 'message' && (
        <ConfirmDialog
          title="Nachricht löschen?"
          description="Sie verschwindet für alle in dieser Unterhaltung."
          confirmLabel="Löschen"
          onClose={() => setAsking(null)}
          onConfirm={() => {
            const { message } = asking;
            setAsking(null);
            remove.mutate(message, {
              onSuccess: () => ui.notify('Nachricht gelöscht'),
              onError: fail,
            });
          }}
        />
      )}
      {asking?.kind === 'channel' && (
        <ConfirmDialog
          title={`${shownName} löschen?`}
          description="Der Kanal und alles, was darin geschrieben wurde, verschwinden für alle."
          confirmLabel="Löschen"
          pending={deleteChannel.isPending}
          onClose={() => setAsking(null)}
          onConfirm={() =>
            deleteChannel.mutate(channelId, {
              onSuccess: () => {
                setAsking(null);
                ui.notify(`${shownName} gelöscht`);
                void navigate(ui.homePath, { replace: true });
              },
              onError: fail,
            })
          }
        />
      )}
      {asking?.kind === 'leave' && (
        <ConfirmDialog
          title="Gruppe verlassen?"
          description="Du liest dann nicht mehr mit. Jemand aus der Gruppe kann dich wieder hinzufügen."
          confirmLabel="Verlassen"
          confirmIcon="logout"
          pending={leave.isPending}
          onClose={() => setAsking(null)}
          onConfirm={() =>
            leave.mutate(channelId, {
              onSuccess: () => {
                setAsking(null);
                void navigate(ui.homePath, { replace: true });
              },
              onError: fail,
            })
          }
        />
      )}
    </section>
  );
}

const inArea = (channel: SenderChannel) => channel.kind === 'area' || channel.kind === 'channel';

/**
 * Whom one calls here with @: the conversation's agents first (an area's own – `@Agent`, made
 * when first tagged – and those added), then the others one may call here; in an area's channels
 * „Agent“ is the area's own, no one else's of that name.
 */
function agentsToTag(channel: SenderChannel, callable: readonly CloudAgentSummary[]): TagAgent[] {
  const may = new Set(callable.map((agent) => agent.id));
  const own = channel.agents.find((agent) => agent.own);
  const here: TagAgent[] = [
    ...(inArea(channel) && !own ? [{ id: null, name: CONVERSATION_AGENT_TAG, here: true }] : []),
    ...channel.agents
      .filter((agent) => agent.own || may.has(agent.id))
      .map((agent) => ({ id: agent.id, name: agent.title, here: true })),
  ];
  const named = new Set(here.map((agent) => agent.id));
  return [
    ...here,
    ...callable
      .filter(
        (agent) =>
          !named.has(agent.id) &&
          !(
            inArea(channel) &&
            agent.title.trim().toLowerCase() === CONVERSATION_AGENT_TAG.toLowerCase()
          ),
      )
      .map((agent) => ({ id: agent.id, name: agent.title })),
  ];
}

/** The agents in the conversation, beside its call: their faces, each opening its page. */
function AgentsHere({ channel }: { channel: SenderChannel }) {
  const ui = useSender();
  if (channel.agents.length === 0) return null;
  return (
    <div className="flex items-center -space-x-1.5">
      {channel.agents.slice(0, 4).map((agent) => (
        <Link
          key={agent.id}
          to={ui.agentPath(agent.id)}
          title={agent.title}
          aria-label={agent.title}
          className="rounded-mark ring-2 ring-bg focus-visible:outline-none focus-visible:ring-focus"
        >
          <AgentAvatar id={agent.id} size={24} className="rounded-mark" />
        </Link>
      ))}
    </div>
  );
}

/**
 * „Agent hinzufügen“: a new one („Neuer Agent“ – shared with the area in its channels, one's own
 * elsewhere), or one of those one may call here and that is not here yet.
 */
function AddAgent({
  workspaceId,
  callable,
  here,
  icon = 'autoAwesome',
  onPick,
}: {
  workspaceId: string;
  callable: readonly CloudAgentSummary[];
  here: readonly SenderChannelAgent[];
  /** In the AI's column beside its heading: a plus. */
  icon?: 'autoAwesome' | 'add';
  /** `undefined`: a new one. */
  onPick: (agent?: SenderChannelAgent) => void;
}) {
  const avatarOf = useAgentAvatars(workspaceId);
  const there = new Set(here.map((agent) => agent.id));
  const more = callable.filter((agent) => !there.has(agent.id)).slice(0, 12);
  return (
    <Menu
      label="Agent hinzufügen"
      triggerIcon={icon}
      triggerVariant="subtle"
      actions={[
        { label: 'Neuer Agent', key: 'new', icon: 'add', onSelect: () => onPick() },
        ...more.map((agent, index) => ({
          label: agent.title,
          key: agent.id,
          divider: index === 0,
          icon: (
            <img src={avatarOf(agent.id)} alt="" className="size-5 rounded-control object-cover" />
          ),
          onSelect: () =>
            onPick({
              id: agent.id,
              title: agent.title,
              userId: agent.owner.id,
              shared: agent.shared,
              areaId: agent.areaId,
            }),
        })),
      ]}
    />
  );
}
