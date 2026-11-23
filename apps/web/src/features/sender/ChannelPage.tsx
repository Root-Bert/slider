import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  CONVERSATION_AGENT_TAG,
  MAX_SENDER_NAME,
  type SenderChannel,
  type SenderChannelAgent,
  type SenderMessage,
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
  usePostSenderMessage,
  useReadSenderChannel,
  useSenderMessages,
  useCloudAgents,
  useUpdateSenderChannel,
} from '@/lib/api';
import { routes } from '@/lib/routes';
import { CallBoxes, CallButtons, useChannelCall } from '@/features/calls';
import { AreaDot, useAgentAside } from '@/features/cloud';
import { useAgentAvatars, ViewSearch, WorkspaceMark } from '@/features/workspaces';
import {
  Avatar,
  AvatarStack,
  cn,
  ConfirmDialog,
  EmptyState,
  Icon,
  Menu,
  type MenuAction,
  useMediaQuery,
} from '@/ui';
import { AddPeople } from './components/AddPeople';
import { Composer } from './components/Composer';
import { MessageList } from './components/MessageList';
import { TypingLine } from './components/TypingLine';
import { MenuButton } from './components/MenuButton';
import { useSender } from './hooks/useSender';
import { PAGE_HEADER, PAGE_TITLE } from './lib/title';

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
    return <Avatar author={channel.person} size={32} />;
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
  // Who calls the agent with @ shows it what was said before – as said, no order.
  const agent = inArea(channel)
    ? ' Mit @Agent rufst du den Agenten des Bereichs – er liest dann mit, was zuvor hier stand.'
    : channel.agent
      ? ` ${channel.agent.title} ist dabei: wer ihn hinzugefügt hat, ruft ihn mit @ – er liest dann mit, was zuvor hier stand.`
      : '';
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
  const edit = useEditSenderMessage(workspaceId, channelId);
  const remove = useDeleteSenderMessage(workspaceId, channelId);
  const update = useUpdateSenderChannel(workspaceId, channelId);
  const deleteChannel = useDeleteSenderChannel(workspaceId);
  const leave = useLeaveSenderGroup(workspaceId);
  const read = useReadSenderChannel(workspaceId);
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<'name' | null>(null);
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [search, setSearch] = useState('');
  // In its call: the call beside the messages, as on an agent's page (the corner's dock stands
  // back); where there is no room for both, the dock as always.
  const inCall = useChannelCall(channelId);
  const asideRef = useRef<HTMLDivElement>(null);
  const aside = useAgentAside(useMediaQuery('(min-width: 1024px)') && !!inCall, 360, asideRef);

  const messages = useMemo(() => messagesOf(query.data), [query.data]);
  const page = query.data?.pages[0];
  // The side bar's copy is the live one (names, counts); the page's has the people.
  const channel = page
    ? { ...page.channel, ...ui.channel(channelId), members: page.channel.members }
    : undefined;
  // Where the „Neu“ line stands: what was read when it opened, not what is read now.
  const [readAt, setReadAt] = useState<{ id: string; seq: number } | null>(null);
  if (page && readAt?.id !== channelId) setReadAt({ id: channelId, seq: page.readSeq });
  // Another conversation: nothing of the last one stays open.
  const [shown, setShown] = useState(channelId);
  if (shown !== channelId) {
    setShown(channelId);
    setEditing(null);
    setRenaming(null);
    setAdding(false);
    setSearch('');
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
  const fail = (error: Error) => ui.notify(error.message, 'danger');
  const send = (text: string) =>
    post.mutate({ text, pendingId: newPendingId() }, { onError: fail });
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
            label: 'Personen hinzufügen',
            icon: 'personAdd',
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
    ...(channel.agent && !inArea(channel)
      ? [
          {
            label: 'Agent entfernen',
            icon: 'close',
            onSelect: () => update.mutate({ agentId: null, agent: null }, { onError: fail }),
          } satisfies MenuAction,
        ]
      : []),
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
            <h1 className={PAGE_TITLE}>{shownName}</h1>
          )}
        </div>
        <ViewSearch
          label="Chat durchsuchen"
          value={search}
          onChange={setSearch}
          // On a phone on a line of its own, under the name.
          className="w-64 max-sm:order-last max-sm:w-full"
        />
        <CallButtons channel={channel} />
        {!inArea(channel) && !channel.agent && channel.canWrite && (
          <AddAgent
            workspaceId={workspaceId}
            onPick={(agent) => update.mutate({ agentId: agent.id, agent }, { onError: fail })}
          />
        )}
        {channel.kind !== 'direct' && channel.members.length > 0 && (
          <AvatarStack authors={channel.members} max={4} size={24} interactive />
        )}
        {actions.length > 0 && (
          <Menu label={`Aktionen für ${shownName}`} actions={actions} triggerVariant="subtle" />
        )}
      </header>
      {adding && channel.kind === 'group' && (
        <AddPeople channel={channel} onDone={() => setAdding(false)} />
      )}
      <div className={cn('flex min-h-0 flex-1', !aside.handle && 'gap-5')}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
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
              callHref={
                callHref ?? ((callId) => routes.messagesChannelCall(workspaceId, channelId, callId))
              }
              search={{ query: search, clear: () => setSearch('') }}
            />
          </div>
          <TypingLine people={typing} />
          {channel.canWrite ? (
            <Composer
              conversationId={channelId}
              target={{ kind: 'conversation', workspaceId }}
              placeholder={`Nachricht an ${shownName}`}
              people={people}
              agent={agentToTag(channel, ui.me.id)}
              onSend={send}
              onTyping={() => tellTypingInSender(channelId)}
              onEditLast={lastOwn ? () => setEditing(lastOwn.id) : undefined}
            />
          ) : (
            <p className="shrink-0 text-xs text-fg-subtle">Du liest in diesem Bereich mit.</p>
          )}
        </div>
        {aside.handle}
        {aside.handle && inCall && (
          <div
            ref={asideRef}
            style={aside.style}
            className="flex min-h-0 shrink-0 flex-col overflow-y-auto overscroll-contain"
          >
            <CallBoxes call={inCall} className="flex flex-col gap-5" />
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
 * The agent one calls here with @: in an area's channels its own (made by the first `@Agent`),
 * in a group or a direct conversation the one added there – only by its owner.
 */
function agentToTag(
  channel: SenderChannel,
  me: string,
): { id: string | null; name: string } | null {
  if (inArea(channel))
    return { id: channel.agent?.id ?? null, name: channel.agent?.title ?? CONVERSATION_AGENT_TAG };
  return channel.agent && channel.agent.userId === me
    ? { id: channel.agent.id, name: channel.agent.title }
    : null;
}

/**
 * „Agent hinzufügen“ to a group or a direct conversation: one of one's own private agents – a
 * shared one would let everyone it is shared with read along. Only who added it calls it here.
 */
function AddAgent({
  workspaceId,
  onPick,
}: {
  workspaceId: string;
  onPick: (agent: SenderChannelAgent) => void;
}) {
  const agents = useCloudAgents(workspaceId);
  const avatarOf = useAgentAvatars(workspaceId);
  const mine = (agents.data ?? []).filter((agent) => agent.mine && !agent.shared).slice(0, 10);
  return (
    <Menu
      label="Agent hinzufügen"
      triggerIcon="autoAwesome"
      triggerVariant="subtle"
      actions={
        mine.length > 0
          ? mine.map((agent) => ({
              label: agent.title,
              key: agent.id,
              icon: (
                <img
                  src={avatarOf(agent.id)}
                  alt=""
                  className="size-5 rounded-control object-cover"
                />
              ),
              onSelect: () =>
                onPick({ id: agent.id, title: agent.title, userId: agent.owner.id, shared: false }),
            }))
          : [
              {
                label: agents.isPending
                  ? 'Agenten werden geladen …'
                  : 'Noch keine privaten Agenten',
                icon: 'autoAwesome',
                onSelect: () => {},
                disabled: true,
                title: 'Agenten legst du in Cloud an.',
              },
            ]
      }
    />
  );
}
