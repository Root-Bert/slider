import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate, useSearchParams } from 'react-router';
import type { SenderAgent, SenderArea, SenderPinKind } from '@slider/shared';
import { AgentAvatar, AreaDot } from '@/features/cloud';
import { canCreateDecks, WorkspaceMark } from '@/features/workspaces';
import { Avatar, Button, cn, ContextMenu, Icon } from '@/ui';
import { useMailThreads } from '@/lib/api';
import { routes } from '@/lib/routes';
import { BarStartLink } from '@/shell/BarStartLink';
import { useSender } from '../hooks/useSender';
import { chatsOf } from '../lib/direct';
import { isMailChat, mailGroupName, unreadMailOf, withMailChats } from '../lib/mail';
import { BarSearchField, ConversationHits } from './ConversationSearch';
import { useWorkspaceDrafts } from '../hooks/useWorkspaceDrafts';
import { isNewKind, newKinds } from '../lib/new';
import { usePinAction } from '../hooks/usePinAction';
import { ROW_MENU_CLASS, useRowMenu } from '../hooks/useRowMenu';
import { pinKindOf } from '../lib/pins';
import { PinnedMark } from './PinnedMark';

const rowClass = ({ isActive }: { isActive: boolean }, unread: boolean) =>
  cn(
    'flex h-8 shrink-0 items-center gap-2.5 rounded-chip px-2.5 text-sm transition-colors focus-visible:-outline-offset-2',
    isActive
      ? 'bg-selected font-medium text-fg'
      : unread
        ? 'font-semibold text-fg hover:bg-hover'
        : 'text-fg-muted hover:bg-hover hover:text-fg',
  );

/** Between the sorts of conversations, as Cloud's bar sets its places apart. */
export function SidebarDivider() {
  return <div role="separator" className="mx-2 my-2 shrink-0 border-t border-hairline-strong" />;
}

/** What is unread: a count, red when someone wrote one's name. */
export function Unread({ count, mentioned }: { count: number; mentioned?: boolean }) {
  if (count === 0 && !mentioned) return null;
  return (
    <span
      aria-label={mentioned ? `${count} ungelesen, du bist erwähnt` : `${count} ungelesen`}
      className={cn(
        'flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5 text-micro font-semibold tabular-nums',
        'bg-logo text-white',
      )}
    >
      {mentioned && count === 0 ? '@' : count}
    </span>
  );
}

function Row({
  to,
  mark,
  name,
  unread = 0,
  mentioned = false,
  indent = false,
  after,
  title,
  pin,
}: {
  to: string;
  mark: ReactNode;
  name: string;
  unread?: number;
  mentioned?: boolean;
  indent?: boolean;
  after?: ReactNode;
  title?: string;
  /** A chat: its menu (right click, long press) pins it to the top of the list or lets it go. */
  pin?: { kind: SenderPinKind; id: string; pinnedAt?: string | null };
}) {
  const ui = useSender();
  const menu = useRowMenu();
  const pinAction = usePinAction(ui.workspace.id, ui.notify);
  return (
    <>
      <NavLink
        to={to}
        title={title}
        {...(pin ? menu.props : {})}
        className={(state) =>
          cn(rowClass(state, unread > 0 || mentioned), indent && 'pl-[34px]', pin && ROW_MENU_CLASS)
        }
      >
        <span className="flex size-[18px] shrink-0 items-center justify-center">{mark}</span>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {pin?.pinnedAt && <PinnedMark />}
        {after}
        <Unread count={unread} mentioned={mentioned} />
      </NavLink>
      {pin && menu.at && (
        <ContextMenu
          label={`Aktionen für „${name}“`}
          actions={[pinAction(pin.kind, pin.id, pin.pinnedAt)]}
          at={menu.at}
          onClose={menu.close}
        />
      )}
    </>
  );
}

function AreaBlock({ area }: { area: SenderArea }) {
  const ui = useSender();
  const [own, ...more] = area.channels;
  if (!own) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="group/area relative flex flex-col">
        <Row
          to={ui.pathOf(own)}
          name={area.name}
          unread={own.unread}
          mentioned={own.mentioned}
          mark={
            area.root ? (
              <WorkspaceMark name={ui.workspace.name} logoUrl={ui.workspace.logoUrl} size={18} />
            ) : (
              <AreaDot color={area.color} />
            )
          }
        />
      </div>
      {more.map((channel) => (
        <Row
          key={channel.id}
          indent
          to={ui.pathOf(channel)}
          name={channel.name}
          unread={channel.unread}
          mentioned={channel.mentioned}
          mark={<Icon name="chatBubble" size={16} />}
        />
      ))}
    </div>
  );
}

function AgentRow({ agent }: { agent: SenderAgent }) {
  const ui = useSender();
  return (
    <Row
      to={ui.agentPath(agent.id)}
      name={agent.title}
      title={agent.title}
      unread={agent.unread}
      pin={{ kind: pinKindOf(agent), id: agent.id, pinnedAt: agent.pinnedAt }}
      mark={<AgentAvatar id={agent.id} size={18} className="rounded-mark" />}
      after={
        agent.running ? (
          <span
            role="img"
            aria-label="arbeitet"
            className="size-1.5 shrink-0 animate-pulse rounded-full bg-success"
          />
        ) : null
      }
    />
  );
}

/** „Neu“: the page where what is new is picked – an agent first, where one may have them. */
function NewButton() {
  const ui = useSender();
  const navigate = useNavigate();
  const [first = 'gruppe'] = newKinds(canCreateDecks(ui.workspace.role));
  return (
    <Button
      variant="secondary"
      size="md"
      icon="add"
      // Half the row, the start the other half.
      className="min-w-0 flex-1"
      onClick={() => void navigate(ui.newPath(first))}
    >
      Neu
    </Button>
  );
}

/** Sender's start beside „Neu“, as Cloud's „Zuletzt“: what is unread and what happened. */
function StartButton() {
  const ui = useSender();
  // Under „Neu“'s page (`?neu=`) the page it was opened from is not where one is.
  const [params] = useSearchParams();
  return (
    <BarStartLink
      to={routes.messages(ui.workspace.id)}
      label="Aktuell"
      away={isNewKind(params.get('neu'))}
    />
  );
}

/**
 * Sender's side bar: its start beside „Neu“, every area with its channels (its own first), then
 * „Direkt“ – people, groups and agents as one list, the latest first, pinned ones above them
 * (their menu: right click, long press) – what is unread bold with its count.
 */
export function SenderSidebar({ className }: { className?: string }) {
  const ui = useSender();
  const home = ui.home;
  // One list: a person, a few people and an agent are all someone one writes with.
  // A mail a colleague is on stands among them, as a group would.
  const threads = useMailThreads(ui.workspace.id).data;
  const direct = withMailChats(chatsOf(home), threads);
  const unreadMail = unreadMailOf(threads);
  const drafts = useWorkspaceDrafts();
  const [query, setQuery] = useState('');
  return (
    <nav aria-label="Sender" className={cn('flex w-57 shrink-0 flex-col gap-0.5', className)}>
      {/* The start and „Neu“ side by side, as in Cloud. */}
      <div className="flex shrink-0 gap-2">
        <StartButton />
        <NewButton />
      </div>
      <div className="mt-2">
        <BarSearchField
          query={query}
          onQuery={setQuery}
          label="Chats und Personen suchen"
          shortcut
        />
      </div>
      <div className="mt-2 flex min-h-0 flex-1 flex-col pb-6">
        {!query.trim() && (
          <>
            {/* Above the conversations, as Cloud's lists across folders: what is not sent yet. */}
            <Row
              to={ui.draftsPath}
              name="Entwürfe"
              mark={<Icon name="edit" size={18} />}
              after={
                drafts.length > 0 ? (
                  <span className="text-xs text-fg-subtle tabular-nums">{drafts.length}</span>
                ) : null
              }
            />
            {/* Mail from outside: one's mailboxes' conversations without a colleague on them. */}
            <Row
              to={ui.mailPath}
              name="Post"
              unread={unreadMail}
              mark={<Icon name="mail" size={18} />}
            />
            <SidebarDivider />
          </>
        )}
        {query.trim() ? (
          <div className="scrollbar-none flex min-h-0 flex-col overflow-x-hidden overflow-y-auto">
            <ConversationHits query={query} onPicked={() => setQuery('')} />
          </div>
        ) : (
          <>
            {/* Areas and „Direkt“ scroll each on their own, as in Cloud. */}
            <div className="scrollbar-none flex min-h-0 shrink flex-col gap-0.5 overflow-x-hidden overflow-y-auto">
              {home?.areas.map((area) => (
                <AreaBlock key={area.id} area={area} />
              ))}
            </div>
            {home && <SidebarDivider />}
            <div className="scrollbar-none flex min-h-0 shrink flex-col gap-0.5 overflow-x-hidden overflow-y-auto">
              {direct.map((each) =>
                isMailChat(each) ? (
                  <Row
                    key={each.id}
                    to={ui.mailThreadPath(each.id)}
                    name={mailGroupName(each)}
                    unread={each.unread}
                    title="Mail mit Leuten von außerhalb"
                    mark={<Icon name="groups" size={18} />}
                    pin={{ kind: pinKindOf(each), id: each.id, pinnedAt: each.pinnedAt }}
                  />
                ) : 'title' in each ? (
                  <AgentRow key={each.id} agent={each} />
                ) : (
                  <Row
                    key={each.id}
                    to={ui.pathOf(each)}
                    name={each.name}
                    unread={each.unread}
                    mentioned={each.mentioned}
                    pin={{ kind: pinKindOf(each), id: each.id, pinnedAt: each.pinnedAt }}
                    mark={
                      each.person ? (
                        <Avatar author={each.person} size={18} />
                      ) : (
                        <Icon name="groups" size={18} />
                      )
                    }
                  />
                ),
              )}
              {home && direct.length === 0 && (
                <p className="px-2.5 py-1 text-xs leading-4.5 text-fg-subtle">
                  Schreib jemandem aus dem Workspace.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </nav>
  );
}
