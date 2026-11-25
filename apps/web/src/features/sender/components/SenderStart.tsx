import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type {
  CloudSummary,
  CloudSummaryPart,
  SenderSummaryPart,
  SenderUnreadItem,
} from '@slider/shared';
import { useMailThreads } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { cn, Icon, ListRow, Spinner } from '@/ui';
import { useSender } from '../hooks/useSender';
import { mailGroupsOf } from '../lib/mail';
import { dayOf, timeOf } from '../lib/time';
import { ConversationMark } from './ConversationSearch';
import { Unread } from './SenderSidebar';

/* The parts of Sender's start („Aktuell“, `SenderHomePage`): its rows and the AI's summary. */

/** Where a conversation of the start page opens (Cloud's „Für dich“ too). */
export function usePlace() {
  const ui = useSender();
  return (item: Pick<SenderUnreadItem, 'kind' | 'id' | 'areaId' | 'channelKind'>) =>
    item.kind === 'agent'
      ? ui.agentPath(item.id)
      : item.kind === 'mail'
        ? ui.mailThreadPath(item.id)
        : ui.pathOf({ id: item.id, areaId: item.areaId, kind: item.channelKind ?? 'group' });
}

/**
 * A conversation's mark as in the side bar: the area, the person, the group, the agent – a mail
 * with colleagues only on it as a group, as it stands among the chats there.
 */
export function Mark({ item }: { item: Pick<SenderUnreadItem, 'kind' | 'id'> }) {
  const ui = useSender();
  const threads = useMailThreads(ui.workspace.id).data;
  const mailGroup =
    item.kind === 'mail' && mailGroupsOf(threads).some((each) => each.id === item.id);
  const conversation =
    item.kind === 'agent'
      ? ui.home?.agents.find((each) => each.id === item.id)
      : item.kind === 'channel'
        ? ui.channel(item.id)
        : undefined;
  return (
    <span className="flex size-[18px] shrink-0 items-center justify-center text-fg-muted">
      {conversation ? (
        <ConversationMark conversation={conversation} />
      ) : (
        <Icon
          name={mailGroup ? 'groups' : item.kind === 'mail' ? 'mail' : 'chatBubble'}
          size={mailGroup ? 18 : 16}
        />
      )}
    </span>
  );
}

export function UnreadRow({ item }: { item: SenderUnreadItem }) {
  const place = usePlace();
  // Who wrote it, unless the conversation is theirs (a direct one, an agent's).
  const who = item.last?.who && !item.last.who.startsWith(item.name) ? item.last.who : null;
  const line = item.last ? (who ? `${who}: ${item.last.text}` : item.last.text) : '';
  return (
    <ListRow
      variant="hover"
      padding="wide"
      className="relative"
      leading={<Mark item={item} />}
      title={
        // The whole row opens the conversation.
        <Link
          to={place(item)}
          className="outline-none after:absolute after:inset-0 after:rounded-control focus-visible:after:ring-2 focus-visible:after:ring-focus"
        >
          {item.name}
        </Link>
      }
      subtitle={line}
      subtitleTitle={line}
      trailing={
        <span className="flex shrink-0 items-center gap-2">
          {item.last && (
            <span className="text-xs text-fg-subtle">{formatRelativeTime(item.last.at)}</span>
          )}
          <Unread count={item.unread} mentioned={item.mentioned} />
        </span>
      }
    />
  );
}

export function UnreadSkeleton() {
  return (
    <div aria-hidden className="flex flex-col">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex h-13 items-center gap-3 px-0.5">
          <div className="skeleton size-[18px] rounded-chip" />
          <div className="flex flex-1 flex-col gap-1.5">
            <div
              className="skeleton h-3.5 rounded-mark"
              style={{ width: `${22 + ((index * 17) % 24)}%` }}
            />
            <div
              className="skeleton h-3 rounded-mark"
              style={{ width: `${40 + ((index * 23) % 35)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Failed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p className="text-body text-fg-muted">
      {message}{' '}
      <button type="button" className="text-fg underline" onClick={onRetry}>
        Erneut versuchen
      </button>
    </p>
  );
}

/** A part of a summary that is not a conversation's: what happened to a file (Cloud's start). */
export type FileSummaryPart = Extract<CloudSummaryPart, { kind: 'file' }>;

/**
 * „Seit deinem letzten Besuch“: the AI's summary in its glass panel – Sender's start and Cloud's
 * alike. Cloud's also has parts about files; it says how they open (`filePart`).
 */
export function SummaryAside({
  summary,
  pending,
  fetching,
  error,
  onRetry,
  filePart,
  sinceLabel = 'Ungelesen seit',
  className,
}: {
  summary: CloudSummary | undefined;
  pending: boolean;
  fetching: boolean;
  error: string | null;
  onRetry: () => void;
  filePart?: (part: FileSummaryPart) => ReactNode;
  sinceLabel?: string;
  className?: string;
}) {
  return (
    <aside
      aria-labelledby="summary-since"
      className={cn('glass flex min-h-0 flex-col gap-2 rounded-panel p-4', className)}
    >
      <div className="flex shrink-0 items-center gap-2 pb-1">
        <h2 id="summary-since" className="min-w-0 flex-1 text-base font-semibold text-fg">
          Seit deinem letzten Besuch
        </h2>
        {fetching && <Spinner size={16} label="Die KI fasst zusammen" />}
      </div>
      <SummaryBody
        summary={summary}
        pending={pending}
        error={error}
        onRetry={onRetry}
        filePart={filePart}
        sinceLabel={sinceLabel}
      />
    </aside>
  );
}

function SummaryBody({
  summary,
  pending,
  error,
  onRetry,
  filePart,
  sinceLabel,
}: {
  summary: CloudSummary | undefined;
  pending: boolean;
  error: string | null;
  onRetry: () => void;
  filePart?: (part: FileSummaryPart) => ReactNode;
  sinceLabel: string;
}) {
  if (error) return <Failed message={error} onRetry={onRetry} />;
  if (pending || !summary) {
    return <p className="text-body text-fg-subtle">Die KI liest, was du verpasst hast …</p>;
  }
  if (summary.state === 'nothing') {
    return (
      <p className="text-body text-fg-muted">
        Nichts Neues. Seit du zuletzt reingeschaut hast, ist nichts dazugekommen.
      </p>
    );
  }
  if (summary.state === 'off') {
    return (
      <p className="text-body text-fg-muted">
        {summary.reason ?? 'Für diesen Workspace ist keine KI eingerichtet.'} Was ungelesen ist,
        steht nebenan.
      </p>
    );
  }
  if (summary.state === 'failed') {
    return <Failed message={summary.reason ?? 'Das hat nicht geklappt.'} onRetry={onRetry} />;
  }
  return (
    <>
      {summary.since && (
        <p className="-mt-2 shrink-0 text-xs text-fg-subtle">
          {sinceLabel}{' '}
          {dayOf(summary.since).replace(/^(Heute|Gestern)$/, (day) => day.toLowerCase())},{' '}
          {timeOf(summary.since)}
        </p>
      )}
      {/* A panel given a height (Cloud's, as high as the cards beside it) scrolls in itself. */}
      <ul className="-mx-2 flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-2 pt-1">
        {summary.parts.map((part, index) =>
          part.kind === 'file' ? (
            <li key={`file:${part.id ?? index}`} className="flex gap-2.5">
              {filePart?.(part)}
            </li>
          ) : (
            <SummaryPart key={`${part.kind}:${part.id}`} part={part} />
          ),
        )}
      </ul>
    </>
  );
}

function SummaryPart({ part }: { part: SenderSummaryPart }) {
  const place = usePlace();
  return (
    <li className="flex gap-2.5">
      <span className="pt-px">
        <Mark item={part} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <Link
          to={place(part)}
          className="truncate text-body font-medium text-fg hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {part.name}
        </Link>
        <span className="text-body text-fg-muted">{part.text}</span>
      </span>
    </li>
  );
}
