import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import {
  MAX_TODO_TITLE,
  type MailContextDocument,
  type MailParty,
  type MailThread,
} from '@slider/shared';
import {
  useAskMailContext,
  useFileMailAttachment,
  useMailInsights,
  useOrderCloudAgent,
  mailSummaryKey,
  useSummarizeMail,
  useCreateTodo,
  useTodos,
} from '@/lib/api';
import { draftsQueryKey } from '@/lib/drafts';
import { routes } from '@/lib/routes';
import { createStoredStore } from '@/lib/storage';
import {
  AsideAgent,
  AsideBullets,
  AsidePart,
  CloudProvider,
  NamedIcon,
  namedHref,
  type Named,
} from '@/features/cloud';
import { Badge, Button, ButtonLink, cn, GlassPanel, Icon, IconButton } from '@/ui';
import { useMailAside } from '../../hooks/useMailView';
import { useSender } from '../../hooks/useSender';
import { hostOf } from '../../lib/mail';
import { MailAvatar } from './MailAvatar';

/** What lies beside opens in a tab of its own: the mail stays where it is (as an agent's desk). */
const BESIDE = { target: '_blank', rel: 'noopener noreferrer' } as const;

/** The agent asked beside each mail (thread id → agent id), the latest last – a few hundred kept. */
const MAX_REMEMBERED = 200;
const agentsStore = createStoredStore<Record<string, string>>({
  key: 'slider.mail.agents',
  parse: (value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).filter((entry): entry is [string, string] => {
            return typeof entry[1] === 'string';
          }),
        )
      : {},
  fallback: {},
  crossTab: true,
});

/** The agent asked beside this mail – opened again, the chat with it is back. `null`: forgotten. */
function useMailAgent(threadId: string) {
  const all = useSyncExternalStore(agentsStore.subscribe, agentsStore.getSnapshot);
  const set = (agentId: string | null) => {
    const { [threadId]: _gone, ...rest } = agentsStore.getSnapshot();
    const entries = Object.entries(rest);
    if (agentId) entries.push([threadId, agentId]);
    agentsStore.set(Object.fromEntries(entries.slice(-MAX_REMEMBERED)));
  };
  return [all[threadId] ?? null, set] as const;
}

const named = (document: MailContextDocument): Named => ({
  kind: document.kind === 'deck' ? 'presentation' : 'file',
  id: document.id,
  name: document.name,
});

/**
 * The switch for the AI beside the open mail, as the board's „KI“: in the folders' row (in its
 * glass), or bare in the mail's head where the mail is the page. Without a mail open: off.
 */
export function MailAsideButton({
  disabled = false,
  bare = false,
  className,
}: {
  disabled?: boolean;
  bare?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useMailAside();
  const shown = open && !disabled;
  const button = (
    <IconButton
      icon={shown ? 'aiPanelOpen' : 'aiPanel'}
      label="KI zur Mail"
      title={
        disabled
          ? 'KI zur Mail – öffne dafür eine Mail'
          : 'KI zur Mail – Zusammenfassung, Beteiligte, passende Dateien'
      }
      size="sm"
      active={shown}
      aria-expanded={shown}
      disabled={disabled}
      onClick={() => setOpen(!open)}
    />
  );
  if (bare) return button;
  return <GlassPanel className={cn('flex shrink-0 p-1', className)}>{button}</GlassPanel>;
}

/**
 * A file that fits: its name opens it beside, under it where it lies; the chevron unfolds why it was
 * picked – the AI's reason, or the mail's words the search found in it.
 */
function DocumentRow({
  document,
  workspaceId,
}: {
  document: MailContextDocument;
  workspaceId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-col">
      <div className="relative flex items-center gap-3 rounded-control px-1 py-1.5 transition-colors hover:bg-surface-1 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-focus">
        <span className="flex size-8 shrink-0 items-center justify-center">
          <NamedIcon named={named(document)} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <Link
            to={namedHref(workspaceId, named(document))}
            {...BESIDE}
            className="truncate text-body font-medium text-fg outline-none after:absolute after:inset-0"
          >
            {document.name}
          </Link>
          <span className="truncate text-xs text-fg-muted">{document.place}</span>
        </span>
        {document.why && (
          <IconButton
            icon={open ? 'expandLess' : 'expandMore'}
            label={open ? 'Begründung ausblenden' : 'Warum passt das?'}
            size="sm"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="relative z-10 shrink-0 aria-expanded:bg-transparent aria-expanded:hover:bg-hover"
          />
        )}
      </div>
      {open && <p className="mb-1 ml-12 text-caption text-fg-muted select-text">{document.why}</p>}
    </li>
  );
}

const LINK_CLASS =
  'rounded-chip transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none';

/**
 * One from outside: the firm (its logo where it vouched, its site a click away) or the person, who
 * wrote, what their signature links – or a firm the mails only write about („In der Mail erwähnt“).
 */
function Party({ party }: { party: MailParty }) {
  const people = party.people
    .map((person) => person.name || person.address)
    .filter((name) => name !== party.name);
  const head = (
    <>
      <span className="min-w-0 flex-1 truncate text-body font-medium text-fg">{party.name}</span>
      {party.domain && party.domain !== party.name && (
        <span className="shrink-0 text-xs text-fg-subtle">{party.domain}</span>
      )}
    </>
  );
  return (
    <li className="flex items-start gap-2 py-1">
      <MailAvatar
        person={{
          name: party.name,
          // A firm's glyph by its domain, a person's by their address – as beside their mails.
          address: party.domain ?? party.people[0]?.address ?? party.name,
          userId: null,
        }}
        vouched={party.logo}
        size={24}
        nativeTitle={false}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {party.url ? (
          <a
            href={party.url}
            {...BESIDE}
            title={`Website von ${party.name} öffnen`}
            className="-mx-1 flex min-h-6 min-w-0 items-center gap-2 rounded-chip px-1 transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
          >
            {head}
          </a>
        ) : (
          <div className="flex min-h-6 min-w-0 items-center gap-2">{head}</div>
        )}
        {people.length > 0 ? (
          <p className="truncate text-xs text-fg-muted" title={people.join(', ')}>
            {people.join(', ')}
          </p>
        ) : (
          party.people.length === 0 && (
            <p className="truncate text-xs text-fg-muted">In der Mail erwähnt</p>
          )
        )}
        {party.links.length > 0 && (
          <p className="flex flex-wrap gap-x-3 text-xs text-fg-subtle">
            {party.links.map((link) => (
              <a key={link.url} href={link.url} {...BESIDE} className={LINK_CLASS}>
                {link.label}
              </a>
            ))}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * „KI zur Mail“ beside a conversation: a few bullets on it („Zusammenfassung“ –
 * the only part a model writes, when the panel opens, kept for the next time), who is on it from
 * outside with their sites, the workspace's files that fit, and where its attachments would go in
 * Cloud, there with one click. What the AI made of the mail on its own (a warning, what to do,
 * links it looked up, files it picked) stands in its place among them.
 */
export function MailAside({
  thread,
  workspaceId,
  notify,
}: {
  thread: MailThread;
  workspaceId: string;
  notify: (text: string, tone?: 'danger') => void;
}) {
  const insights = useMailInsights(workspaceId, thread.id, true);
  const summarize = useSummarizeMail(workspaceId, thread.id);
  // Made again from the mail's menu („Neu einschätzen“) as well: the spark breathes all the same.
  const summarizing = useIsMutating({ mutationKey: mailSummaryKey(thread.id) }) > 0;
  const assess = useAskMailContext(workspaceId, thread.id);
  const file = useFileMailAttachment(workspaceId, thread.id);
  const data = insights.data;
  const context = thread.context;
  const working = thread.contextState === 'working';
  // Not read by itself (turned off for the mailbox, or past its hour's share): asked for here.
  const unassessed = !context && !working && !assess.isPending;

  // Bullets for a mailbox the AI reads anyway: made as the panel opens, once per state of the mail.
  const summary = data?.summary;
  const auto = summary?.state === 'ask' && summary.auto ? data?.version : undefined;
  const { mutate: summarizeNow } = summarize;
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!auto || asked.current === auto) return;
    asked.current = auto;
    summarizeNow();
  }, [auto, summarizeNow]);

  const attachments = new Map(
    thread.messages.flatMap((message) => message.attachments).map((one) => [one.id, one]),
  );
  const filing = (data?.filing ?? []).filter((one) => attachments.has(one.attachmentId));
  const bullets = summary?.state === 'ready' ? summary.bullets : (context?.facts ?? []);
  const asking = summary?.state === 'ask' && !summarize.isPending && !summarize.isError;
  const showSummary =
    unassessed ||
    !!context?.warning ||
    !!context?.todo ||
    bullets.length > 0 ||
    summary?.state === 'ask' ||
    summarize.isPending;
  const parties = data?.parties ?? [];
  const links = context?.verdict === 'ok' ? context.links : [];
  const documents = data?.documents ?? [];
  const empty =
    !!data &&
    !showSummary &&
    parties.length + links.length + documents.length + filing.length === 0;

  // One ask for all the AI makes of a mail it did not read by itself: its bullets and what it is
  // (spam, what to do, files that fit).
  const summarizable = asking && summary?.state === 'ask' && !summary.auto;
  const fail = (error: Error) => notify(error.message, 'danger');
  // „Zu tun“ kept as one's own to-do – once: then it is a link to it.
  const makeTodo = useCreateTodo(workspaceId);
  const todos = useTodos(workspaceId, null, Boolean(context?.todo)).data;
  const kept = todos?.find(
    (todo) => todo.source?.kind === 'mail' && todo.source.threadId === thread.id,
  );
  const summaryAfter =
    summarizable || unassessed ? (
      <Button
        variant="soft"
        size="xs"
        className="self-start"
        onClick={() => {
          if (summarizable) summarize.mutate(undefined, { onError: fail });
          if (unassessed) assess.mutate(undefined, { onError: fail });
        }}
      >
        {unassessed ? 'Von der KI einschätzen lassen' : 'Zusammenfassen'}
      </Button>
    ) : null;
  // The spark breathes where the AI is at work: the summary (and the links it finds with the firms).
  const busy = working || summarizing || assess.isPending;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="sr-only">KI zur Mail</h2>
      {/* Free on the page, level with the mail beside it; scrolls as one. */}
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto overscroll-contain px-1 pt-1">
        {context?.warning && (
          <AsidePart label="Vorsicht" icon="report" danger>
            <p className="text-body text-danger">{context.warning}</p>
          </AsidePart>
        )}
        {context?.todo && (
          <AsidePart label="Zu tun" icon="checklist">
            <p className="text-body font-medium text-fg">{context.todo}</p>
            {/* Where it is done: a link from the mail itself, its host plain to see. */}
            {context.todoLink && (
              <a
                href={context.todoLink.url}
                {...BESIDE}
                className="-mx-1 flex items-center gap-2 rounded-chip px-1 py-1 transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              >
                <Icon name="openInNew" size={16} className="shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1 truncate text-body text-fg">
                  {context.todoLink.label}
                </span>
                <span className="shrink-0 text-xs text-fg-subtle">
                  {hostOf(context.todoLink.url)}
                </span>
              </a>
            )}
            {kept ? (
              <ButtonLink
                to={routes.cloudTodos(workspaceId)}
                variant="ghost"
                size="xs"
                icon="checklist"
                className="self-start"
              >
                {`Aufgabe #${kept.number}`}
              </ButtonLink>
            ) : (
              <Button
                variant="soft"
                size="xs"
                icon="add"
                className="self-start"
                disabled={!todos || makeTodo.isPending}
                onClick={() =>
                  makeTodo.mutate(
                    {
                      title: context.todo!.slice(0, MAX_TODO_TITLE),
                      source: {
                        kind: 'mail',
                        threadId: thread.id,
                        ...(context.todoLink
                          ? {
                              url: context.todoLink.url,
                              label: context.todoLink.label.slice(0, 200),
                            }
                          : {}),
                      },
                    },
                    {
                      onSuccess: (todo) => notify(`Aufgabe #${todo.number} angelegt`),
                      onError: fail,
                    },
                  )
                }
              >
                Als Aufgabe anlegen
              </Button>
            )}
          </AsidePart>
        )}
        {(unassessed || bullets.length > 0 || summary?.state === 'ask' || summarize.isPending) && (
          <AsidePart label="Zusammenfassung" icon="notes" working={busy}>
            {bullets.length > 0 && <AsideBullets label="Stichpunkte" items={bullets} />}
            {summaryAfter}
            {bullets.length === 0 && summarize.isPending && (
              <p className="text-caption text-fg-muted">Die KI fasst die Mails zusammen …</p>
            )}
            {bullets.length === 0 && summarize.isError && (
              <p className="flex items-center gap-2 text-caption text-fg-muted">
                <span className="min-w-0 flex-1">{summarize.error.message}</span>
                <Button variant="ghost" size="xs" onClick={() => summarize.mutate()}>
                  Erneut versuchen
                </Button>
              </p>
            )}
          </AsidePart>
        )}
        {(parties.length > 0 || links.length > 0) && (
          <AsidePart label="Beteiligte" icon="groups" working={working}>
            {parties.length > 0 && (
              <ul aria-label="Von außen" className="-my-1 flex flex-col">
                {parties.map((party, index) => (
                  <Party key={index} party={party} />
                ))}
              </ul>
            )}
            {links.length > 0 && (
              <ul aria-label="Links" className="-mx-1 flex flex-col">
                {links.map((link) => (
                  <li key={link.url}>
                    <a
                      href={link.url}
                      {...BESIDE}
                      className="flex items-center gap-2 rounded-chip px-1 py-1 transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                    >
                      <Icon name="link" size={16} className="shrink-0 text-fg-muted" />
                      <span className="min-w-0 flex-1 truncate text-body text-fg">
                        {link.label}
                      </span>
                      <span className="shrink-0 text-xs text-fg-subtle">{hostOf(link.url)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </AsidePart>
        )}
        {documents.length > 0 && (
          <AsidePart label="Passende Dokumente" icon="description">
            <ul className="-mx-1 -my-1.5 flex flex-col">
              {documents.map((document) => (
                <DocumentRow key={document.id} document={document} workspaceId={workspaceId} />
              ))}
            </ul>
          </AsidePart>
        )}
        {filing.length > 0 && (
          <AsidePart label="Anhänge ablegen" icon="driveFileMove">
            <ul className="-mx-1 -my-1.5 flex flex-col">
              {filing.map((one) => {
                const name = attachments.get(one.attachmentId)?.name ?? 'Anhang';
                return (
                  <li
                    key={one.attachmentId}
                    className="flex items-center gap-3 rounded-control px-1 py-1.5"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center">
                      <Icon name="attachFile" size={20} className="text-fg-muted" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-body font-medium text-fg">{name}</span>
                      <span
                        className="truncate text-xs text-fg-muted"
                        title={[`nach ${one.place}`, one.why].filter(Boolean).join(' | ')}
                      >
                        nach {one.place}
                      </span>
                    </span>
                    {one.nodeId ? (
                      <Link
                        to={routes.cloudFile(workspaceId, one.nodeId)}
                        {...BESIDE}
                        className="shrink-0 rounded-chip focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                      >
                        <Badge tone="success">Abgelegt</Badge>
                      </Link>
                    ) : one.nodeId === '' ? (
                      <Badge tone="success">Abgelegt</Badge>
                    ) : (
                      <Button
                        variant="soft"
                        size="xs"
                        onClick={() =>
                          file.mutate(
                            {
                              attachmentId: one.attachmentId,
                              areaId: one.areaId,
                              parentId: one.parentId,
                            },
                            {
                              onSuccess: () => notify(`${name} abgelegt`),
                              onError: (error) => notify(error.message, 'danger'),
                            },
                          )
                        }
                      >
                        Ablegen
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </AsidePart>
        )}
        {empty && <p className="px-1 text-caption text-fg-muted">Nichts weiter zu dieser Mail.</p>}
        {insights.isError && !data && (
          <p className="px-1 text-caption text-fg-muted">{insights.error.message}</p>
        )}
        <MailAgentPart
          threadId={thread.id}
          workspaceId={workspaceId}
          off={summary?.state === 'off'}
          notify={notify}
        />
      </div>
    </div>
  );
}

/**
 * „Nachfragen“, the column's last part: a question about the mail goes to an agent of one's own
 * (as „Neuer Agent“), told which mail by its id – the chat keeps the person's words alone. Its
 * chat is Cloud's (as beside „Neues Postfach“): there what it names opens.
 */
function MailAgentPart({
  threadId,
  workspaceId,
  off,
  notify,
}: {
  threadId: string;
  workspaceId: string;
  off: boolean;
  notify: (text: string, tone?: 'danger') => void;
}) {
  const ui = useSender();
  const [agentId, setAgentId] = useMailAgent(threadId);
  const order = useOrderCloudAgent(workspaceId, null, threadId);
  // An answer it drafted (`draft_mail_reply`) stands in the reply field beside at once – the
  // drafts' list is asked again as it is done, not half a minute later.
  const queryClient = useQueryClient();
  return (
    <AsideAgent
      workspaceId={workspaceId}
      agentId={agentId}
      onAgent={setAgentId}
      order={order}
      mailThreadId={threadId}
      placeholder="Frag zu dieser Mail …"
      off={
        off
          ? 'Fragen zur Mail beantwortet die KI – für diesen Workspace ist keine eingerichtet.'
          : null
      }
      agentPath={ui.agentPath}
      notify={notify}
      wrapChat={(chat) => <CloudProvider workspace={ui.workspace}>{chat}</CloudProvider>}
      onDone={() => void queryClient.invalidateQueries({ queryKey: draftsQueryKey(workspaceId) })}
    />
  );
}
