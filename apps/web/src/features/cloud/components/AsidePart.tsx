import { useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import type { Attachment, CloudAgentDetail } from '@slider/shared';
import { useCloudAgent, useMessageCloudAgent, type AgentInput } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { ButtonLink, cn, Icon, IconButton, type IconName } from '@/ui';
import { AgentChat } from './AgentChat';
import { AgentComposer } from './AgentComposer';
import { LoadFailed } from './Empty';

/*
 * The AI's column beside a thing – „KI zur Mail“ beside a mail, the calendar's beside its days:
 * parts free on the page, each under a small heading, and „Nachfragen“ last, a question to an
 * agent of one's own with its chat right there.
 */

/**
 * A part of the column, free on the page and parted from the next by room alone (a line would read
 * as a handle to drag): its icon and a small heading that says what kind of thing stands under it
 * (as „Wer es sieht“ beside a file). While the AI works on it, its spark breathes beside the heading.
 */
export function AsidePart({
  label,
  icon,
  danger = false,
  working = false,
  actions,
  last = false,
  children,
}: {
  label: string;
  icon: IconName;
  danger?: boolean;
  working?: boolean;
  /** Small buttons at the heading's end (the agent's „Als Agent öffnen“, „Neue Frage“). */
  actions?: ReactNode;
  /** The column's last part (Nachfragen): it fills the rest, its field at the foot. */
  last?: boolean;
  children: ReactNode;
}) {
  const heading = (
    <h3
      className={cn(
        'flex min-w-0 items-center gap-2 text-caption font-semibold tracking-wider uppercase',
        // Fills the row beside its buttons – not the column (the last part grows: it stood mid-way).
        actions && 'flex-1',
        danger ? 'text-danger' : 'text-fg-subtle',
      )}
    >
      <Icon name={icon} size={16} className="shrink-0" />
      {label}
      {working && (
        <Icon
          name="autoAwesome"
          size={14}
          aria-label="Die KI arbeitet"
          className="shrink-0 text-sage motion-safe:animate-pulse"
        />
      )}
    </h3>
  );
  return (
    <section
      aria-label={label}
      className={cn('flex flex-col gap-2.5', last ? 'grow justify-end' : 'shrink-0')}
    >
      {actions ? (
        <div className="-my-1 flex items-center gap-1">
          {heading}
          {actions}
        </div>
      ) : (
        heading
      )}
      {children}
    </section>
  );
}

/** The AI's bullets in a part. */
export function AsideBullets({ label, items }: { label: string; items: string[] }) {
  return (
    <ul aria-label={label} className="flex flex-col gap-1">
      {/* Two equal bullets may stand: keyed by place (the list is drawn anew as a whole). */}
      {items.map((item, index) => (
        <li key={index} className="flex items-start gap-2 text-body text-fg">
          <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-fg-subtle" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** A question refused to its agent: deleted, or shared elsewhere since. */
const refused = (error: Error) =>
  error instanceof ApiError && (error.status === 404 || error.status === 403);

/**
 * The agent can be asked beside the thing no more: deleted, or shared since („Als Agent öffnen“ –
 * a shared one reads no one's mails or private calendars). Then it is forgotten here.
 */
function foreignAgent(found: ReturnType<typeof useCloudAgent>) {
  const agent = found.data;
  if (agent) return agent.shared || !agent.mine;
  return found.error instanceof ApiError && found.error.status === 404;
}

interface AsideAgentProps {
  workspaceId: string;
  /** The agent asked here before (kept by the caller); `null`: none yet, or forgotten. */
  agentId: string | null;
  onAgent: (agentId: string | null) => void;
  /** Orders a new agent of one's own with the first question (as „Neuer Agent“). */
  order: { mutateAsync: (input: AgentInput) => Promise<CloudAgentDetail>; isPending: boolean };
  /** Each message written on is beside this mail, as the order was. */
  mailThreadId?: string;
  placeholder: string;
  /** Without the workspace's AI: why there is none. */
  off?: string | null;
  agentPath: (agentId: string) => string;
  notify: (text: string, tone?: 'danger') => void;
  /** Its chat in Cloud's context where the column stands outside it (Sender). */
  wrapChat?: (chat: ReactNode) => ReactNode;
  /** The agent is done with an answer (Mail asks its drafts again). */
  onDone?: () => void;
}

/**
 * „Nachfragen“, the column's last part: a question goes to an agent of one's own – the chat keeps
 * the person's words alone. Asked before, its chat stands here and goes on with that agent.
 */
export function AsideAgent(props: AsideAgentProps) {
  const { agentId, onAgent, order, notify } = props;
  const [fresh, setFresh] = useState(false);
  // A question its agent refused whose new agent could not be ordered either: back in the field.
  const [kept, setKept] = useState<{ text: string } | null>(null);
  const ask = (text: string, attachments: Attachment[] = []) =>
    order.mutateAsync({ text, attachments }).then(
      (agent) => {
        onAgent(agent.id);
        setFresh(true);
        setKept(null);
        return true;
      },
      (error: Error) => {
        notify(error.message, 'danger');
        return false;
      },
    );
  // The refused agent's field is gone with it (forgotten): the words go into the fresh one.
  const askAgain = (text: string, attachments: Attachment[]) =>
    ask(text, attachments).then((ok) => {
      if (!ok) {
        setKept({ text });
        onAgent(null);
      }
      return ok;
    });
  if (props.off) {
    return (
      <AsidePart label="Nachfragen" icon="chatBubble">
        <p className="text-caption text-fg-muted">{props.off}</p>
      </AsidePart>
    );
  }
  if (agentId) {
    return (
      <AsideAgentThread
        key={agentId}
        {...props}
        agentId={agentId}
        autoFocus={fresh}
        onAsk={askAgain}
        onNew={() => {
          onAgent(null);
          setFresh(true);
        }}
        onGone={() => {
          onAgent(null);
          setFresh(false);
        }}
      />
    );
  }
  return (
    <AsidePart label="Nachfragen" icon="chatBubble" last>
      <div className="sticky bottom-0 z-10 flex flex-col bg-canvas pt-2">
        <AgentComposer
          placeholder={props.placeholder}
          autoFocus={fresh}
          inline
          draft={kept}
          busy={order.isPending}
          workspaceId={props.workspaceId}
          onSend={ask}
        />
      </div>
    </AsidePart>
  );
}

/**
 * The agent asked here, its chat in the part: written to on; „Als Agent öffnen“ takes it to its
 * page. Gone, it is forgotten – and a question it was refused (shared elsewhere since) goes to a
 * new agent of one's own at once.
 */
function AsideAgentThread({
  workspaceId,
  agentId,
  mailThreadId,
  agentPath,
  notify,
  wrapChat = (chat) => chat,
  onDone,
  autoFocus,
  onAsk,
  onNew,
  onGone,
}: AsideAgentProps & {
  agentId: string;
  autoFocus: boolean;
  onAsk: (text: string, attachments: Attachment[]) => Promise<boolean>;
  onNew: () => void;
  onGone: () => void;
}) {
  const found = useCloudAgent(workspaceId, agentId);
  const message = useMessageCloudAgent(workspaceId, agentId);
  const agent = found.data;
  const gone = foreignAgent(found);
  const done = agent && !agent.running ? agent.updatedAt : null;
  const answered = useEffectEvent(() => onDone?.());
  useEffect(() => {
    if (done) answered();
  }, [done]);
  const forget = useEffectEvent(onGone);
  useEffect(() => {
    if (gone) forget();
  }, [gone]);
  const send = (text: string, chatId: string, attachments: Attachment[]) =>
    message.mutateAsync({ text, attachments, chatId, mailThreadId }).then(
      () => true,
      (error: Error) => {
        if (refused(error)) return onAsk(text, attachments);
        notify(error.message, 'danger');
        return false;
      },
    );
  return (
    <AsidePart
      label="Nachfragen"
      icon="chatBubble"
      working={!!agent?.running}
      last
      actions={
        <>
          <ButtonLink
            to={agentPath(agentId)}
            variant="ghost"
            size="xs"
            icon="openInNew"
            title="Als Agent öffnen"
            className="shrink-0"
          >
            <span className="sr-only">Als Agent öffnen</span>
          </ButtonLink>
          <IconButton icon="add" label="Neue Frage" size="xs" onClick={onNew} />
        </>
      }
    >
      {found.isPending ? (
        <div aria-hidden className="skeleton h-24 rounded-panel" />
      ) : !agent ? (
        <LoadFailed
          message={found.error?.message ?? 'Diesen Agenten gibt es nicht.'}
          onRetry={() => void found.refetch()}
        />
      ) : (
        wrapChat(
          <AgentChat
            agent={agent}
            chat={agent.chats[0] ?? null}
            inline
            autoFocus={autoFocus}
            onSend={send}
          />,
        )
      )}
    </AsidePart>
  );
}
