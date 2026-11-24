import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import {
  DELETED_ACCOUNT_NAME,
  type AccountAuthor,
  type SenderAgent,
  type SenderChannel,
  type SenderMessageHit,
} from '@slider/shared';
import { useOpenSenderDirect, useSenderMessageSearch } from '@/lib/api';
import { isModKey } from '@/lib/keyboard';
import { isApplePlatform } from '@/lib/platform';
import { AgentAvatar, AreaDot } from '@/features/cloud';
import { WorkspaceMark } from '@/features/workspaces';
import { Avatar, cn, Icon, Kbd, TextField, useDebounced } from '@/ui';
import { useSender } from '../hooks/useSender';
import { searchConversations } from '../lib/search';
import { MailHitRows, useMailHits } from './mail/MailHits';

/** A hit in a side bar's search – ↑↓ step through them all, files and chats alike. */
export const HIT = 'data-bar-hit';
const FIELD = 'data-bar-search';

export const hitClass =
  'flex h-8 w-full shrink-0 items-center gap-2.5 rounded-chip px-2.5 text-left text-sm text-fg-muted transition-colors hover:bg-hover hover:text-fg focus-visible:-outline-offset-2';

/** The hits in the bar something stands in. */
const hitsIn = (element: Element) => [
  ...(element.closest('nav')?.querySelectorAll<HTMLElement>(`[${HIT}]`) ?? []),
];

/** On the hits' list: ↑↓ step through them; ↑ on the first goes back to the field. */
export function stepHits(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const all = hitsIn(event.currentTarget);
  const at = all.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  event.preventDefault();
  const next = all[at + (event.key === 'ArrowDown' ? 1 : -1)];
  if (next) next.focus();
  else if (event.key === 'ArrowUp')
    event.currentTarget
      .closest('nav')
      ?.querySelector<HTMLInputElement>(`[${FIELD}] input`)
      ?.focus();
}

/**
 * A side bar's search field: found while one types, in the bar where its list stood (nothing
 * opens over the page). Enter takes the first hit, ↓ steps into them, Esc empties the field.
 * `shortcut`: ⌘F types here, always – a page's own field is ⌘K's (`ViewSearch`) (Sender; Cloud's
 * ⌘F is `SearchPalette`'s, which finds the field by `marked`).
 */
export function BarSearchField({
  query,
  onQuery,
  label,
  shortcut = false,
  marked,
}: {
  query: string;
  onQuery: (query: string) => void;
  label: string;
  shortcut?: boolean;
  marked?: Record<`data-${string}`, string>;
}) {
  const field = useRef<HTMLInputElement>(null);
  const onKey = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.key.toLowerCase() !== 'f' || !isModKey(event) || event.altKey || event.shiftKey)
      return;
    if (document.querySelector('dialog[open]')) return;
    event.preventDefault();
    field.current?.focus();
    field.current?.select();
  });
  useEffect(() => {
    if (!shortcut) return;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcut]);
  return (
    <search {...{ [FIELD]: '' }} {...marked} className="block shrink-0">
      <TextField
        ref={field}
        type="search"
        icon="search"
        aria-label={label}
        placeholder="Suchen"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        trailing={query === '' ? <Kbd>{isApplePlatform() ? '⌘F' : 'Strg F'}</Kbd> : undefined}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && query !== '') {
            event.preventDefault();
            event.stopPropagation();
            onQuery('');
          } else if (event.key === 'Enter') {
            event.preventDefault();
            hitsIn(event.currentTarget)[0]?.click();
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            hitsIn(event.currentTarget)[0]?.focus();
          }
        }}
      />
    </search>
  );
}

/**
 * The conversations and people a query finds, as rows of a bar's hits. A click on one is the
 * conversation; on a person one has not written with yet, it starts an empty one.
 */
export function ConversationHitRows({
  query,
  onPicked,
  hideAreaChats,
}: {
  query: string;
  onPicked: () => void;
  /** Areas found as such (Cloud): their own chat is not listed again. */
  hideAreaChats?: ReadonlySet<string>;
}) {
  const ui = useSender();
  const navigate = useNavigate();
  const open = useOpenSenderDirect(ui.workspace.id);
  const [starting, setStarting] = useState<string | null>(null);
  const hits = searchConversations(ui.home, ui.me.id, query).filter(
    (hit) => !('kind' in hit && hit.kind === 'area' && hideAreaChats?.has(hit.areaId ?? '')),
  );
  const go = (to: string) => {
    onPicked();
    void navigate(to);
  };
  const start = (person: AccountAuthor) => {
    if (starting) return;
    setStarting(person.id);
    open.mutate(person.id, {
      onSuccess: (channel) => go(ui.pathOf(channel)),
      onError: (error) => ui.notify(error.message, 'danger'),
      onSettled: () => setStarting(null),
    });
  };
  return hits.map((hit) =>
    'type' in hit ? (
      <button
        key={hit.id}
        type="button"
        role="listitem"
        {...{ [HIT]: '' }}
        aria-busy={starting === hit.id}
        className={cn(hitClass, starting === hit.id && 'bg-hover text-fg')}
        onClick={() => start(hit)}
      >
        <Avatar author={hit} size={18} />
        <span className="min-w-0 flex-1 truncate">{hit.name}</span>
      </button>
    ) : (
      <button
        key={hit.id}
        type="button"
        role="listitem"
        {...{ [HIT]: '' }}
        className={hitClass}
        onClick={() => go('title' in hit ? ui.agentPath(hit.id) : ui.pathOf(hit))}
      >
        <span className="flex size-[18px] shrink-0 items-center justify-center">
          <ConversationMark conversation={hit} />
        </span>
        <span className="min-w-0 flex-1 truncate">{'title' in hit ? hit.title : hit.name}</span>
        {!('title' in hit) && hit.kind === 'channel' && (
          <span className="max-w-[45%] shrink-0 truncate text-xs text-fg-subtle">
            {ui.home?.areas.find((area) => area.id === hit.areaId)?.name}
          </span>
        )}
      </button>
    ),
  );
}

/**
 * Messages with the words, in any conversation one sees (the server reads them): a click opens
 * the conversation with them searched there.
 */
function MessageHitRows({
  hits,
  query,
  onPicked,
}: {
  hits: SenderMessageHit[];
  query: string;
  onPicked: () => void;
}) {
  const ui = useSender();
  const navigate = useNavigate();
  const all = [
    ...(ui.home?.areas.flatMap((area) => area.channels) ?? []),
    ...(ui.home?.groups ?? []),
    ...(ui.home?.direct ?? []),
  ];
  return hits.flatMap((hit) => {
    const channel = all.find((each) => each.id === hit.channelId);
    if (!channel) return [];
    const who = hit.name ?? DELETED_ACCOUNT_NAME;
    return [
      <button
        key={hit.messageId}
        type="button"
        role="listitem"
        {...{ [HIT]: '' }}
        title={`${channel.name} | ${who}: ${hit.text}`}
        className={hitClass}
        onClick={() => {
          onPicked();
          void navigate(ui.pathOf(channel), { state: { find: query } });
        }}
      >
        <span className="flex size-[18px] shrink-0 items-center justify-center">
          <ConversationMark conversation={channel} />
        </span>
        <span className="min-w-0 flex-1 truncate">{hit.text}</span>
        <span className="max-w-[40%] shrink-0 truncate text-xs text-fg-subtle">{channel.name}</span>
      </button>,
    ];
  });
}

/**
 * Sender's hits: the conversations and people, then the messages with the words, then the mails,
 * in place of the bar's list.
 */
export function ConversationHits({ query, onPicked }: { query: string; onPicked: () => void }) {
  const ui = useSender();
  const settled = useDebounced(query.trim(), 150);
  const mails = useMailHits(ui.workspace.id, settled);
  const found = useSenderMessageSearch(ui.workspace.id, settled);
  const messages = settled.length >= 2 ? (found.data ?? []) : [];
  const chats = searchConversations(ui.home, ui.me.id, query).length > 0;
  const none =
    !chats &&
    messages.length === 0 &&
    mails.threads.length === 0 &&
    settled === query.trim() &&
    !mails.settling &&
    !found.isFetching;
  const line = <div role="separator" className="mx-2 my-2 shrink-0 border-t border-hairline" />;
  return (
    <div role="list" aria-label="Treffer" className="flex flex-col gap-0.5" onKeyDown={stepHits}>
      <ConversationHitRows query={query} onPicked={onPicked} />
      {chats && messages.length > 0 && line}
      <MessageHitRows hits={messages} query={settled} onPicked={onPicked} />
      {(chats || messages.length > 0) && mails.threads.length > 0 && line}
      <MailHitRows threads={mails.threads} onPicked={onPicked} />
      {none && (
        <p className="px-2.5 py-1 text-xs leading-4.5 text-fg-subtle">
          Kein Chat, keine Nachricht, keine Mail und niemand heißt so.
        </p>
      )}
    </div>
  );
}

/** A conversation's mark: an agent's face, a person, a group, an area. */
export function ConversationMark({ conversation }: { conversation: SenderChannel | SenderAgent }) {
  const ui = useSender();
  if ('title' in conversation)
    return <AgentAvatar id={conversation.id} size={18} className="rounded-mark" />;
  if (conversation.person) return <Avatar author={conversation.person} size={18} />;
  if (conversation.kind === 'group') return <Icon name="groups" size={18} />;
  if (conversation.kind === 'channel') return <Icon name="chatBubble" size={16} />;
  const area = ui.home?.areas.find((each) => each.id === conversation.areaId);
  return area?.root ? (
    <WorkspaceMark name={ui.workspace.name} logoUrl={ui.workspace.logoUrl} size={18} />
  ) : (
    <AreaDot color={area?.color ?? 'blue'} />
  );
}
