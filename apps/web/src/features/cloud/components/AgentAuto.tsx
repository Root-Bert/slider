import type { ReactNode } from 'react';
import type { CloudAgentDetail } from '@slider/shared';
import { useAutoCloudAgent, useRepeatCloudAgent } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn, Icon, IconButton, type IconName } from '@/ui';
import { useCloud } from '../hooks/useCloud';
import { repeatWords, watchWords } from '../lib/kinds';
import { AgentRepeat } from './AgentRepeat';

/** One thing the agent does by itself: when, what then, and its owner's ways to change it. */
function Row({
  icon,
  when,
  text,
  note,
  off,
  children,
}: {
  icon: IconName;
  when: string;
  text: string;
  note?: string;
  /** Paused: it stays, greyed. */
  off: boolean;
  children?: ReactNode;
}) {
  return (
    <li className="group flex items-start gap-2.5">
      <Icon name={icon} size={16} className="mt-0.5 shrink-0 text-fg-muted" />
      <div className={cn('flex min-w-0 flex-1 flex-col', off && 'opacity-55')}>
        <span className="text-body font-medium text-fg">{when}</span>
        {/* The order in one line – all of it on hover. */}
        <span className="truncate text-caption text-fg-muted" title={text}>
          {text}
        </span>
        {note && <span className="text-caption text-fg-subtle">{note}</span>}
      </div>
      {children && <span className="-mt-1 -mr-1 flex shrink-0 items-center">{children}</span>}
    </li>
  );
}

/**
 * „Arbeitet von selbst“: what the agent does without being written to – the order it takes up
 * again at a time, and what it keeps an eye on. It set that up itself from what it was told;
 * here it is read at a glance and held in hand: paused as a whole (all of it stays), each one
 * taken away, the time changed. Anything else is said to it in the chat. Others read it; its
 * owner changes it. Nothing set: for its owner, how to say it; for others, nothing.
 */
export function AgentAuto({ agent }: { agent: CloudAgentDetail }) {
  const ui = useCloud();
  const auto = useAutoCloudAgent(ui.workspace.id, agent.id);
  const repeat = useRepeatCloudAgent(ui.workspace.id, agent.id);
  const refused = (error: Error) => ui.notify(error.message, 'danger');
  const any = Boolean(agent.repeat) || agent.watches.length > 0;
  if (!any && !agent.mine) return null;
  return (
    <section
      aria-label="Arbeitet von selbst"
      className="glass flex shrink-0 flex-col gap-2 rounded-panel p-4"
    >
      <div className="flex h-7 shrink-0 items-center gap-2">
        <Icon name="autoAwesome" size={18} className="text-fg-muted" />
        <h2 className="flex-1 text-base font-semibold text-fg">
          {agent.paused && any ? 'Pausiert' : 'Arbeitet von selbst'}
        </h2>
        {any && agent.mine && (
          <IconButton
            icon={agent.paused ? 'playArrow' : 'pause'}
            label={agent.paused ? 'Weiterarbeiten lassen' : 'Pausieren'}
            size="compact"
            onClick={() => auto.mutate({ paused: !agent.paused }, { onError: refused })}
          />
        )}
      </div>
      {any ? (
        <ul className="flex flex-col gap-2">
          {agent.repeat && (
            <Row
              icon="replay"
              when={repeatWords(agent.repeat)}
              text={agent.repeat.text}
              note={
                agent.paused ? undefined : `Nächstes Mal: ${formatDateTime(agent.repeat.nextRunAt)}`
              }
              off={agent.paused}
            >
              {agent.mine && (
                <>
                  <AgentRepeat agent={agent} edit />
                  <IconButton
                    icon="close"
                    label="Nicht mehr wiederholen"
                    size="compact"
                    iconSize={16}
                    onClick={() => repeat.mutate(null, { onError: refused })}
                  />
                </>
              )}
            </Row>
          )}
          {agent.watches.map((watch) => (
            <Row
              key={watch.id}
              icon={watch.on === 'people' ? 'groups' : 'visibility'}
              when={watchWords(watch)}
              text={watch.text}
              note={watch.until ? `Sammelt bis ${formatDateTime(watch.until)}` : undefined}
              off={agent.paused}
            >
              {agent.mine && (
                <IconButton
                  icon="close"
                  label="Nicht mehr im Blick behalten"
                  size="compact"
                  iconSize={16}
                  onClick={() => auto.mutate({ removeWatch: watch.id }, { onError: refused })}
                />
              )}
            </Row>
          ))}
        </ul>
      ) : (
        <p className="text-caption text-fg-muted">
          Sag ihm im Chat, wann er von selbst arbeiten soll, etwa „jeden Montag um 8“.
        </p>
      )}
    </section>
  );
}
