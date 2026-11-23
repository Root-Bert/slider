import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { CallBrief, CallRecord, CallRecordLink } from '@slider/shared';
import { formatDateTime } from '@/lib/format';
import { Avatar, AvatarStack, cn, Icon, IconTile, type IconName } from '@/ui';
import { callMinutes, callTime, callWhen } from '../lib/calls';
import { namedHref } from '../lib/named';
import { AgentAvatar } from './AgentAvatar';
import { useAgentAside } from './AgentAside';
import { NamedIcon } from './Named';

/*
 * A call that is over, as one's chat with an agent shows it: one entry („Anruf“, when, how long,
 * who) that opens its page – what was said turn by turn like a chat, and beside it the notes the
 * AI wrote after it: summary, decisions, to-dos, open questions, and what it was about, linked.
 */

/** The call in a chat: one entry, as wide as the chat, that opens it (in Cloud beside the chat). */
export function CallEntry({ call, to }: { call: CallBrief; to: string }) {
  return (
    <Link
      to={to}
      className="glass group flex w-full flex-col gap-2 rounded-panel p-3 transition-colors hover:bg-glass-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
    >
      <span className="flex items-center gap-3">
        <IconTile size={36}>
          <Icon name="call" size={20} />
        </IconTile>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-body font-medium text-fg">Anruf</span>
          <span className="text-caption text-fg-muted" title={formatDateTime(call.startedAt)}>
            {callWhen(call.startedAt)} · {callMinutes(call)}
          </span>
        </span>
        <AvatarStack authors={call.people} size={24} max={3} />
        <Icon
          name="chevronRight"
          size={20}
          className="shrink-0 text-fg-subtle group-hover:text-fg-muted"
        />
      </span>
      {call.summary && <span className="line-clamp-2 text-body text-fg-muted">{call.summary}</span>}
    </Link>
  );
}

/** What was said, turn by turn – who, when, what; one speaker's turns in a row under one name. */
function Transcript({ record, agentId }: { record: CallRecord; agentId: string | null }) {
  const people = new Map(record.people.map((each) => [each.id, each]));
  return (
    <ol aria-label="Gesprächsverlauf" className="flex flex-col gap-1 select-text">
      {record.lines.map((line, index) => {
        const before = record.lines[index - 1];
        const same = before?.userId === line.userId && before.name === line.name;
        // Someone no longer in the list (an account deleted since): grey, by the name said.
        const person = line.userId
          ? (people.get(line.userId) ?? {
              id: line.userId,
              name: line.name,
              type: 'deleted' as const,
              color: 'deleted' as const,
            })
          : null;
        return (
          <li key={index} className={cn('flex gap-3', !same && index > 0 && 'mt-3')}>
            <span className="w-7 shrink-0">
              {!same &&
                (person ? (
                  <Avatar author={person} size={28} nativeTitle={false} />
                ) : (
                  <AgentAvatar id={agentId ?? line.name} size={28} className="rounded-mark" />
                ))}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {!same && (
                <p className="flex items-baseline gap-2">
                  <span className="truncate text-body font-medium text-fg">{line.name}</span>
                  <time dateTime={line.at} className="text-caption text-fg-subtle">
                    {callTime(line.at)}
                  </time>
                </p>
              )}
              <p className="text-body leading-5 break-words whitespace-pre-wrap text-fg">
                {line.text}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** One card of notes beside the talk. */
function Card({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <section className="glass flex shrink-0 flex-col gap-2.5 rounded-panel p-4">
      <h2 className="flex h-7 items-center gap-2 text-base font-semibold text-fg">
        <Icon name={icon} size={18} className="text-fg-muted" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function Points({ items, icon }: { items: readonly ReactNode[]; icon: IconName }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item, index) => (
        <li key={index} className="flex items-start gap-2 text-body text-fg">
          <Icon name={icon} size={16} className="mt-0.5 shrink-0 text-fg-subtle" />
          <span className="min-w-0 flex-1">{item}</span>
        </li>
      ))}
    </ul>
  );
}

const WHY: Record<CallRecordLink['why'], string> = {
  order: 'Im Anruf beauftragt',
  place: 'Hier wurde telefoniert',
  named: 'Im Gespräch genannt',
};

/** What the call was about, linked – only what the viewer may open (the server filters). */
function Links({
  links,
  workspaceId,
  agentHref,
}: {
  links: readonly CallRecordLink[];
  workspaceId: string;
  agentHref: (agentId: string) => string;
}) {
  return (
    <ul className="-mx-2 flex flex-col">
      {links.map((link) => (
        <li key={`${link.kind}:${link.id}`}>
          <Link
            to={
              link.kind === 'agent'
                ? agentHref(link.id)
                : namedHref(workspaceId, { kind: link.kind, id: link.id, name: link.name })
            }
            className="flex min-w-0 items-center gap-2.5 rounded-control px-2 py-1.5 hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
          >
            {link.kind === 'agent' ? (
              <AgentAvatar id={link.id} size={20} className="rounded-mark" />
            ) : (
              <NamedIcon named={{ kind: link.kind, id: link.id, name: link.name }} />
            )}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body text-fg">{link.name}</span>
              <span className="text-caption text-fg-subtle">{WHY[link.why]}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The notes the AI wrote after the call – or why there are none (yet). */
function Notes({
  record,
  workspaceId,
  agentHref,
}: {
  record: CallRecord;
  workspaceId: string;
  agentHref: (agentId: string) => string;
}) {
  const notes = record.notes;
  if (!notes)
    return (
      <Card icon="notes" title="Zusammenfassung">
        {record.notesState === 'pending' ? (
          <div aria-label="Die Notizen werden geschrieben" className="flex flex-col gap-2">
            <span aria-hidden className="skeleton h-3.5 w-full rounded-chip" />
            <span aria-hidden className="skeleton h-3.5 w-11/12 rounded-chip" />
            <span aria-hidden className="skeleton h-3.5 w-2/3 rounded-chip" />
            <p className="text-caption text-fg-subtle">Die KI schreibt die Notizen …</p>
          </div>
        ) : (
          <p className="text-body text-fg-muted">
            {record.notesState === 'failed'
              ? 'Die Notizen zu diesem Anruf konnten nicht geschrieben werden.'
              : 'Ohne KI im Workspace gibt es zu Anrufen keine Notizen.'}
          </p>
        )}
      </Card>
    );
  return (
    <>
      <Card icon="notes" title="Zusammenfassung">
        <p className="text-body leading-5 text-fg select-text">
          {notes.summary || 'Nichts Besonderes besprochen.'}
        </p>
      </Card>
      {notes.decisions.length > 0 && (
        <Card icon="checkCircle" title="Beschlüsse">
          <Points icon="check" items={notes.decisions} />
        </Card>
      )}
      {notes.todos.length > 0 && (
        <Card icon="checkCircleOutline" title="Aufgaben">
          <Points
            icon="radioButtonUnchecked"
            items={notes.todos.map((todo) => (
              <>
                {todo.text}
                {todo.who && <span className="text-fg-muted"> – {todo.who}</span>}
              </>
            ))}
          />
        </Card>
      )}
      {notes.open.length > 0 && (
        <Card icon="info" title="Offene Fragen">
          <Points icon="dot" items={notes.open} />
        </Card>
      )}
      {notes.links.length > 0 && (
        <Card icon="link" title="Verlinkt">
          <Links links={notes.links} workspaceId={workspaceId} agentHref={agentHref} />
        </Card>
      )}
    </>
  );
}

/** When the call was, how long, and who was in it – the page's line under its title. */
export function CallMeta({ record }: { record: CallRecord }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-sm text-fg-muted">
      <AvatarStack authors={record.people} size={20} max={4} />
      <span className="truncate">
        <time dateTime={record.startedAt} title={formatDateTime(record.startedAt)}>
          {callWhen(record.startedAt)}
        </time>{' '}
        · {callMinutes(record)} · {record.people.map((each) => each.name).join(', ')}
      </span>
    </span>
  );
}

/** In the side panel beside the page (`CallPanel`): the notes first, the talk under them. */
export function CallRecordStack({
  record,
  workspaceId,
  agentHref,
}: {
  record: CallRecord;
  workspaceId: string;
  agentHref: (agentId: string) => string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div role="complementary" aria-label="Notizen" className="flex flex-col gap-5">
        <Notes record={record} workspaceId={workspaceId} agentHref={agentHref} />
      </div>
      <section aria-label="Gesprächsverlauf">
        {record.lines.length > 0 ? (
          <Transcript record={record} agentId={record.agentId} />
        ) : (
          <p className="text-body text-fg-muted">In diesem Anruf wurde nichts gesagt.</p>
        )}
      </section>
    </div>
  );
}

/**
 * The call's page: the talk like a chat, the notes beside it (on a narrow window above it).
 * `fill`: the page has the window's height, each side scrolls on its own.
 */
export function CallRecordView({
  record,
  workspaceId,
  agentId,
  agentHref,
  fill,
}: {
  record: CallRecord;
  workspaceId: string;
  /** The agent called (one's own call with it); a conversation's agents show by their name. */
  agentId: string | null;
  agentHref: (agentId: string) => string;
  fill: boolean;
}) {
  // Between talk and notes the same handle as between an agent's chat and its cards.
  const asideRef = useRef<HTMLDivElement>(null);
  const aside = useAgentAside(fill, 360, asideRef);
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-col gap-5 lg:flex-row',
        aside.handle ? 'lg:gap-0' : 'lg:gap-8',
        fill && 'lg:min-h-0',
      )}
    >
      <section
        aria-label="Gesprächsverlauf"
        className={cn(
          'min-w-0 flex-1 max-lg:order-last',
          fill && 'lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-2',
        )}
      >
        {record.lines.length > 0 ? (
          <Transcript record={record} agentId={agentId} />
        ) : (
          <p className="text-body text-fg-muted">In diesem Anruf wurde nichts gesagt.</p>
        )}
      </section>
      {aside.handle}
      <div
        ref={asideRef}
        role="complementary"
        aria-label="Notizen"
        style={aside.style}
        className={cn(
          'flex flex-col gap-5 lg:w-[360px] lg:shrink-0',
          fill && 'lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain',
        )}
      >
        <Notes record={record} workspaceId={workspaceId} agentHref={agentHref} />
      </div>
    </div>
  );
}
