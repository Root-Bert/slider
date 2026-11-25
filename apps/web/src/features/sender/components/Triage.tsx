import { createContext, use, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { SenderTriage, TriageAgendaItem, TriageGroup, TriageItem } from '@slider/shared';
import {
  useMailThreads,
  useMembers,
  useOpenSenderDirect,
  useOrderCloudAgent,
  useReadTriage,
  useSenderTriage,
  useUnsubscribeMail,
} from '@/lib/api';
import { AsideAgent, CloudProvider } from '@/features/cloud';
import { setDraft } from '@/lib/drafts';
import { formatRelativeTime } from '@/lib/format';
import { useOverviewAgent } from '@/lib/overview-agents';
import { CLOUD_TODO_PARAM, routes } from '@/lib/routes';
import {
  Button,
  cn,
  Icon,
  IconButton,
  type IconName,
  ListRow,
  Menu,
  type MenuAction,
  RowList,
  Select,
  TextField,
  TextLink,
} from '@/ui';
import { allChannels, useSender } from '../hooks/useSender';
import {
  bySender,
  keyOfItem,
  orderText,
  refOf,
  shownTriage,
  talkText,
  TRIAGE_LOOK,
  type NewsletterSender,
} from '../lib/triage';
import { MailAvatar } from './mail/MailAvatar';
import { Failed, Mark, UnreadSkeleton } from './SenderStart';
import { Unread } from './SenderSidebar';
import { markupPlain } from '../lib/markup';

/*
 * Sender's start as a to-do list – „Aktuell“ for everything, „Übersicht“ in a mailbox for its mail
 * alone: what today and the coming days hold („Heute und diese Woche“ – events, to-dos due, what
 * earlier mails say is due), then what is unread in groups (mentions, direct, requests,
 * conversations, agents, mail, notices, newsletters, spam), each with what the AI makes of it and
 * what to do with all of it at once – read, unsubscribe, give to an agent, talk over with a
 * colleague. The AI's look is made on the server ahead of time, so the page never waits for it.
 */

/** What changes when something comes in or is read: then the list is asked anew. */
function useTriageStamp(mailbox: string | undefined) {
  const ui = useSender();
  const mail = useMailThreads(ui.workspace.id).data;
  if (!ui.home || !mail) return null;
  const chats = mailbox ? [] : [...allChannels(ui.home), ...ui.home.agents];
  return [...chats, ...mail.filter((each) => !mailbox || each.accountId === mailbox)]
    .filter((each) => each.unread > 0)
    .map((each) => `${each.id}:${each.unread}:${each.updatedAt}`)
    .sort()
    .join(',');
}

/** Where a mail opens, when not as everywhere (a mailbox's „Übersicht“ keeps its view). */
const MailHref = createContext<((threadId: string) => string) | undefined>(undefined);

/** What is being done with some items, in the page under their group's head. */
type Pending = { kind: 'agent' | 'talk'; group: string; items: TriageItem[]; label: string };

export function Triage({
  mailbox,
  mailHref,
}: {
  mailbox?: string;
  /** Where a mail opens – in a mailbox's „Übersicht“, beside it, the view kept. */
  mailHref?: (threadId: string) => string;
}) {
  const ui = useSender();
  const stamp = useTriageStamp(mailbox);
  const { plain, told } = useSenderTriage(ui.workspace.id, stamp, mailbox);
  const triage = shownTriage(
    plain.data,
    told.data,
    !!told.data && !told.isPlaceholderData && !plain.isPlaceholderData,
  );
  const read = useReadTriage(ui.workspace.id);
  const leave = useUnsubscribeMail(ui.workspace.id);
  const [pending, setPending] = useState<Pending | null>(null);
  // Newsletters only their page unsubscribes from: that page, beside the row, until read.
  const [pages, setPages] = useState<ReadonlyMap<string, string>>(new Map());

  const markRead = (items: readonly TriageItem[]) => {
    if (items.length === 0) return;
    read.mutate(items.map(refOf), {
      onError: () => ui.notify('Nicht als gelesen markiert. Versuch es noch einmal.', 'danger'),
    });
  };
  /** One mail per sender is enough to leave its list; the rest of theirs is read. */
  const unsubscribe = (senders: readonly NewsletterSender[]) => {
    const latest = senders.flatMap((sender) => sender.items.slice(0, 1));
    markRead(senders.flatMap((sender) => sender.items.slice(1)));
    leave.mutate(
      latest.map((each) => each.item.id),
      {
        onSuccess: (results) => {
          const links = results.filter((each) => each.result === 'link' && each.url);
          const done = results.filter((each) => each.result === 'done').length;
          if (links.length > 0)
            setPages((before) => {
              const next = new Map(before);
              for (const each of links) next.set(each.threadId, each.url!);
              return next;
            });
          const parts = [
            done > 0 ? `${done === 1 ? 'Ein Newsletter' : `${done} Newsletter`} abbestellt.` : '',
            links.length > 0
              ? `${links.length === 1 ? 'Einer geht' : `${links.length} gehen`} nur auf der Seite des Absenders – sie steht in der Liste.`
              : '',
          ].filter(Boolean);
          if (parts.length > 0) ui.notify(parts.join(' '));
        },
        onError: (error) => ui.notify(error.message || 'Abbestellen ging nicht.', 'danger'),
      },
    );
  };

  if (!triage) {
    return plain.isError ? (
      <Failed message={plain.error.message} onRetry={() => void plain.refetch()} />
    ) : (
      <UnreadSkeleton />
    );
  }
  const asking = told.isFetching;
  const count = triage.groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <MailHref value={mailHref}>
      {/* The whole width, as Cloud's overview: groups side by side where there is room. */}
      <div className="@container flex flex-col gap-8">
        <Headline
          triage={triage}
          asking={asking}
          count={count}
          mailbox={mailbox}
          onRetry={() => void told.refetch()}
        />
        {triage.agenda.length > 0 && <Agenda agenda={triage.agenda} />}
        <div
          className={cn(
            'grid grid-cols-1 items-start gap-x-12 gap-y-8',
            triage.groups.length > 1 && '@5xl:grid-cols-2',
          )}
        >
          {triage.groups.map((group) => (
            <Group
              key={group.key}
              group={group}
              pages={pages}
              pending={pending?.group === group.key ? pending : null}
              setPending={setPending}
              onRead={markRead}
              onUnsubscribe={unsubscribe}
            />
          ))}
        </div>
      </div>
    </MailHref>
  );
}

function Headline({
  triage,
  asking,
  count,
  mailbox,
  onRetry,
}: {
  triage: SenderTriage;
  asking: boolean;
  count: number;
  mailbox: string | undefined;
  onRetry: () => void;
}) {
  // Answered, asked about or handed on right under it – not without the AI.
  const ask = triage.ai !== 'off' && <OverviewAsk mailbox={mailbox} />;
  if (count === 0 && !triage.headline && triage.agenda.length === 0)
    return (
      <div className="flex flex-col gap-3">
        <p className="py-2 text-body text-fg-muted">
          Alles gelesen. Was neu dazukommt, steht hier.
        </p>
        {ask}
      </div>
    );
  // No spinner: the AI's look is made ahead on the server – until there is one, the count.
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex items-start gap-2.5 text-base leading-6 font-medium text-fg">
        <span className="flex h-6 shrink-0 items-center text-fg-muted">
          <Icon name="autoAwesome" size={18} />
        </span>
        <span>
          {triage.headline ??
            (count === 0
              ? 'Alles gelesen.'
              : `${count === 1 ? 'Eine Sache ist' : `${count} Sachen sind`} ungelesen.`)}
        </span>
      </p>
      {!asking && triage.ai === 'failed' && (
        <p className="pl-7 text-body text-fg-muted">
          Die KI hat gerade nicht sortiert.{' '}
          <TextLink variant="underline" onClick={onRetry}>
            Erneut versuchen
          </TextLink>
        </p>
      )}
      {!asking && triage.ai === 'off' && triage.reason && (
        <p className="pl-7 text-body text-fg-muted">{triage.reason}</p>
      )}
      {ask && <div className="mt-1.5 pl-7">{ask}</div>}
    </div>
  );
}

/**
 * Under the headline: a reply, a question or an order to an agent of one's own, its chat right
 * there („Nachfragen“ as beside a mail) – the agent is told what the page shows, by id.
 */
function OverviewAsk({ mailbox }: { mailbox: string | undefined }) {
  const ui = useSender();
  const overview = { of: 'sender' as const, ...(mailbox && { mailbox }) };
  const [agentId, setAgentId] = useOverviewAgent(ui.workspace.id, overview);
  const order = useOrderCloudAgent(ui.workspace.id);
  return (
    <AsideAgent
      bare
      workspaceId={ui.workspace.id}
      agentId={agentId}
      onAgent={setAgentId}
      order={order}
      overview={overview}
      placeholder="Frag dazu oder gib einen Auftrag …"
      agentPath={ui.agentPath}
      notify={ui.notify}
      wrapChat={(chat) => <CloudProvider workspace={ui.workspace}>{chat}</CloudProvider>}
    />
  );
}

const AGENDA_ICON: Record<TriageAgendaItem['kind'], IconName> = {
  event: 'calendar',
  todo: 'checklist',
  mail: 'mail',
};

/** „Heute und diese Woche“: each row opens its event's day, its to-do or its mail. */
function Agenda({ agenda }: { agenda: TriageAgendaItem[] }) {
  const ui = useSender();
  const mailHref = use(MailHref) ?? ui.mailThreadPath;
  const workspaceId = ui.workspace.id;
  const hrefOf = (each: TriageAgendaItem) =>
    each.kind === 'event'
      ? routes.cloudCalendar(workspaceId, each.day ?? undefined)
      : each.kind === 'todo'
        ? `${routes.cloudTodos(workspaceId)}?${CLOUD_TODO_PARAM}=${encodeURIComponent(each.id)}`
        : mailHref(each.id);
  return (
    <section aria-label="Heute und diese Woche" className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-x-2">
        <Icon name="event" size={18} className="shrink-0 text-fg-muted" />
        <h2 className="text-base font-semibold text-fg">Heute und diese Woche</h2>
      </div>
      <RowList variant="hover" aria-label="Heute und diese Woche" className="mt-1">
        {agenda.map((each) => (
          <ListRow
            key={`${each.kind}:${each.id}`}
            variant="hover"
            padding="wide"
            className="relative"
            leading={<Icon name={AGENDA_ICON[each.kind]} size={20} className="text-fg-muted" />}
            title={
              <Link
                to={hrefOf(each)}
                className="outline-none after:absolute after:inset-0 after:rounded-control focus-visible:after:ring-2 focus-visible:after:ring-focus"
              >
                {each.text}
              </Link>
            }
            trailing={
              each.when ? (
                <span className="shrink-0 text-xs text-fg-subtle">{each.when}</span>
              ) : undefined
            }
          />
        ))}
      </RowList>
    </section>
  );
}

function Group({
  group,
  pages,
  pending,
  setPending,
  onRead,
  onUnsubscribe,
}: {
  group: TriageGroup;
  pages: ReadonlyMap<string, string>;
  pending: Pending | null;
  setPending: (pending: Pending | null) => void;
  onRead: (items: readonly TriageItem[]) => void;
  onUnsubscribe: (senders: readonly NewsletterSender[]) => void;
}) {
  const look = TRIAGE_LOOK[group.key];
  const [all, setAll] = useState(false);
  const news = group.key === 'newsletters';
  const spam = group.key === 'spam';
  const senders = news ? bySender(group.items) : [];
  const rows = news ? senders.length : group.items.length;
  const shown = all ? rows : look.shown;
  const ask = (kind: Pending['kind'], items: TriageItem[], label: string) =>
    setPending(
      pending?.kind === kind && pending.label === label
        ? null
        : { kind, group: group.key, items, label },
    );
  const everything = `${group.items.length} ${look.label}`;
  // The group's actions: buttons in its head, narrow one menu.
  const actions: (MenuAction & { icon: IconName; open?: boolean })[] = [
    { label: 'Alle gelesen', icon: 'check', onSelect: () => onRead(group.items) },
    ...(news
      ? [
          {
            label: 'Alle abbestellen',
            icon: 'unsubscribe' as const,
            onSelect: () => onUnsubscribe(senders),
          },
        ]
      : []),
    ...(spam
      ? []
      : [
          {
            label: 'An Agent geben',
            icon: 'autoAwesome' as const,
            open: pending?.kind === 'agent' && pending.label === everything,
            onSelect: () => ask('agent', group.items, everything),
          },
          {
            label: 'Besprechen',
            icon: 'chatBubble' as const,
            open: pending?.kind === 'talk' && pending.label === everything,
            onSelect: () => ask('talk', group.items, everything),
          },
        ]),
  ];

  return (
    <section aria-label={look.label} className="@container flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon name={look.icon} size={18} className="shrink-0 text-fg-muted" />
        <h2 className="text-base font-semibold text-fg">{look.label}</h2>
        <span className="text-body text-fg-subtle">{group.items.length}</span>
        {/* As wide as the list stands (a mail open beside it too): buttons, else one menu. */}
        <span className="ml-auto @2xl:hidden">
          <Menu label={`Aktionen für ${look.label}`} actions={actions} />
        </span>
        <div className="ml-auto hidden items-center gap-1 @2xl:flex">
          {actions.map((action) => (
            <Button
              key={action.label}
              variant="ghost"
              size="xs"
              icon={action.icon}
              expanded={action.open}
              onClick={action.onSelect}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </div>
      {/* One item: its own line says it. */}
      {group.summary && group.items.length > 1 && (
        <p className="pl-6.5 text-body text-fg-muted">{group.summary}</p>
      )}
      {pending &&
        (pending.kind === 'agent' ? (
          <AgentForm pending={pending} onDone={() => setPending(null)} onRead={onRead} />
        ) : (
          <TalkForm pending={pending} onDone={() => setPending(null)} />
        ))}
      {shown > 0 && (
        <RowList variant="hover" aria-label={look.label} className="mt-1">
          {news
            ? senders
                .slice(0, shown)
                .map((sender) => (
                  <SenderRow
                    key={sender.key}
                    sender={sender}
                    page={sender.items.map((each) => pages.get(each.item.id)).find(Boolean)}
                    onRead={onRead}
                    onUnsubscribe={onUnsubscribe}
                  />
                ))
            : group.items.slice(0, shown).map((each) => (
                <ItemRow
                  key={keyOfItem(each)}
                  each={each}
                  actions={
                    <>
                      <IconButton
                        icon="check"
                        label="Gelesen"
                        size="compact"
                        onClick={() => onRead([each])}
                      />
                      {!spam && (
                        <IconButton
                          icon="autoAwesome"
                          label="An Agent geben"
                          size="compact"
                          onClick={() => ask('agent', [each], each.item.name)}
                        />
                      )}
                      {!spam && (
                        <IconButton
                          icon="chatBubble"
                          label="Besprechen"
                          size="compact"
                          onClick={() => ask('talk', [each], each.item.name)}
                        />
                      )}
                    </>
                  }
                />
              ))}
        </RowList>
      )}
      {rows > shown && (
        <Button
          variant="ghost"
          size="xs"
          tone="subtle"
          className="self-start"
          onClick={() => setAll(true)}
        >
          {shown === 0 ? `${rows} zeigen` : `Alle ${rows} zeigen`}
        </Button>
      )}
    </section>
  );
}

/** Where an item opens. */
function usePlace() {
  const ui = useSender();
  const mailHref = use(MailHref) ?? ui.mailThreadPath;
  return ({ item }: TriageItem) =>
    item.kind === 'agent'
      ? ui.agentPath(item.id)
      : item.kind === 'mail'
        ? mailHref(item.id)
        : ui.pathOf({ id: item.id, areaId: item.areaId, kind: item.channelKind ?? 'group' });
}

/**
 * A row: the whole row opens it; its actions in place of the time where the pointer (or the
 * keyboard) is, always on a touch screen.
 */
function Row({
  to,
  leading,
  title,
  subtitle,
  meta,
  actions,
}: {
  to: string;
  leading: ReactNode;
  title: string;
  subtitle: string;
  meta: ReactNode;
  actions: ReactNode;
}) {
  return (
    <ListRow
      variant="hover"
      padding="wide"
      className="group/row relative"
      leading={leading}
      title={
        <Link
          to={to}
          className="outline-none after:absolute after:inset-0 after:rounded-control focus-visible:after:ring-2 focus-visible:after:ring-focus"
        >
          {title}
        </Link>
      }
      subtitle={subtitle}
      subtitleTitle={subtitle}
      trailing={
        <span className="flex shrink-0 items-center gap-2">
          <span className="flex items-center gap-2 group-focus-within/row:hidden group-hover/row:hidden pointer-coarse:hidden">
            {meta}
          </span>
          <span className="relative z-10 hidden items-center gap-0.5 group-focus-within/row:flex group-hover/row:flex pointer-coarse:flex">
            {actions}
          </span>
        </span>
      }
    />
  );
}

function ItemRow({ each, actions }: { each: TriageItem; actions: ReactNode }) {
  const place = usePlace();
  const { item } = each;
  // Who wrote it, unless the conversation is theirs (a direct one, an agent's).
  const who = item.last?.who && !item.last.who.startsWith(item.name) ? item.last.who : null;
  // A chat's words without their marks; a mail's as written (its * and _ are no marks).
  const words = item.last
    ? item.kind === 'mail'
      ? item.last.text
      : markupPlain(item.last.text)
    : '';
  const last = item.last ? (who ? `${who}: ${words}` : words) : '';
  return (
    <Row
      to={place(each)}
      leading={
        each.from ? (
          <MailAvatar person={{ ...each.from, userId: null }} vouched={false} size={20} />
        ) : (
          <Mark item={item} />
        )
      }
      title={
        each.from && item.kind === 'mail'
          ? `${item.name} | ${each.from.name || each.from.address}`
          : item.name
      }
      subtitle={each.line ?? last}
      meta={
        <>
          {item.last && (
            <span className="text-xs text-fg-subtle">{formatRelativeTime(item.last.at)}</span>
          )}
          <Unread count={item.unread} mentioned={item.mentioned} />
        </>
      }
      actions={actions}
    />
  );
}

/** A newsletter's sender: how many of theirs are unread, the latest, read or left at once. */
function SenderRow({
  sender,
  page,
  onRead,
  onUnsubscribe,
}: {
  sender: NewsletterSender;
  page: string | undefined;
  onRead: (items: readonly TriageItem[]) => void;
  onUnsubscribe: (senders: readonly NewsletterSender[]) => void;
}) {
  const place = usePlace();
  const latest = sender.items[0]!;
  const many = sender.items.length;
  const about = latest.line ?? latest.item.name;
  return (
    <Row
      to={place(latest)}
      leading={
        latest.from ? (
          <MailAvatar person={{ ...latest.from, userId: null }} vouched={false} size={20} />
        ) : (
          <Mark item={latest.item} />
        )
      }
      title={sender.name}
      subtitle={
        page
          ? 'Abbestellen geht nur auf der Seite des Absenders.'
          : many > 1
            ? `${many} ungelesen | ${about}`
            : about
      }
      meta={
        page ? (
          <TextLink href={page} target="_blank" rel="noopener noreferrer" className="relative z-10">
            Seite öffnen
          </TextLink>
        ) : (
          <span className="text-xs text-fg-subtle">
            {latest.item.last ? formatRelativeTime(latest.item.last.at) : ''}
          </span>
        )
      }
      actions={
        <>
          <IconButton
            icon="check"
            label={many > 1 ? 'Alle gelesen' : 'Gelesen'}
            size="compact"
            onClick={() => onRead(sender.items)}
          />
          {page ? (
            <TextLink href={page} target="_blank" rel="noopener noreferrer">
              Seite öffnen
            </TextLink>
          ) : (
            <IconButton
              icon="unsubscribe"
              label="Abbestellen"
              size="compact"
              onClick={() => onUnsubscribe([sender])}
            />
          )}
        </>
      }
    />
  );
}

const DEFAULT_ORDER = 'Kümmere dich darum und sag mir, was ich davon tun muss.';

/** „An Agent geben“: what it should do, typed where it stands – the items go along by id. */
function AgentForm({
  pending,
  onDone,
  onRead,
}: {
  pending: Pending;
  onDone: () => void;
  onRead: (items: readonly TriageItem[]) => void;
}) {
  const ui = useSender();
  const navigate = useNavigate();
  const one = pending.items.length === 1 ? pending.items[0] : undefined;
  const order = useOrderCloudAgent(
    ui.workspace.id,
    null,
    one?.item.kind === 'mail' ? one.item.id : undefined,
  );
  const [text, setText] = useState('');
  const send = () => {
    order.mutate(orderText(text.trim() || DEFAULT_ORDER, pending.items), {
      onSuccess: (agent) => {
        onRead(pending.items);
        onDone();
        ui.notify('Der Agent arbeitet daran.', 'neutral', {
          label: 'Öffnen',
          run: () => void navigate(ui.agentPath(agent.id)),
        });
      },
      onError: (error) => ui.notify(error.message || 'Der Agent wurde nicht beauftragt.', 'danger'),
    });
  };
  return (
    <form
      className="mt-1 flex items-end gap-2 pl-6.5"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <TextField
        autoFocus
        label={`Auftrag zu ${pending.label}`}
        placeholder={DEFAULT_ORDER}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone();
        }}
        className="flex-1"
      />
      <Button type="submit" variant="soft" size="field" loading={order.isPending}>
        Geben
      </Button>
    </form>
  );
}

/** „Besprechen“: a colleague picked, their conversation opens with the items in its field. */
function TalkForm({ pending, onDone }: { pending: Pending; onDone: () => void }) {
  const ui = useSender();
  const navigate = useNavigate();
  const members = (useMembers(ui.workspace.id).data ?? []).filter(
    (each) => each.userId !== ui.me.id,
  );
  const open = useOpenSenderDirect(ui.workspace.id);
  const go = (who: string) => {
    if (!who) return;
    open.mutate(who, {
      onSuccess: (channel) => {
        setDraft(channel.id, talkText(pending.items), {
          kind: 'conversation',
          workspaceId: ui.workspace.id,
        });
        onDone();
        void navigate(ui.pathOf(channel));
      },
      onError: (error) => ui.notify(error.message || 'Die Unterhaltung ging nicht auf.', 'danger'),
    });
  };
  if (members.length === 0)
    return (
      <p className="mt-1 pl-6.5 text-body text-fg-muted">
        Noch niemand sonst ist in diesem Workspace.
      </p>
    );
  return (
    // Picked, the conversation opens with the items in its field.
    <div className="mt-1 flex items-center gap-2 pl-6.5">
      <Select
        autoFocus
        aria-label={`Mit wem ${pending.label} besprechen`}
        value=""
        onChange={go}
        disabled={open.isPending}
        options={[
          { value: '', label: 'Mit wem besprechen?' },
          ...members.map((each) => ({ value: each.userId, label: each.name })),
        ]}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone();
        }}
        className="min-w-56"
      />
    </div>
  );
}
