import { useSyncExternalStore, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { SenderChannel, SenderChannelAgent } from '@slider/shared';
import { createStoredStore } from '@/lib/storage';
import { AgentAvatar, AsidePart } from '@/features/cloud';
import { IconButton } from '@/ui';
import { useSender } from '../hooks/useSender';

/** The AI beside a conversation, opened or closed: remembered in this browser, for every chat. */
const asideStore = createStoredStore<boolean>({
  key: 'slider.sender.chatAside',
  parse: (value) => value === true,
  fallback: false,
});

/** Whether the AI stands beside the conversation, and its switch (at the head's end). */
export function useChatAside() {
  const open = useSyncExternalStore(asideStore.subscribe, asideStore.getSnapshot);
  return [open, asideStore.set] as const;
}

/**
 * „Agenten“ in the AI's column beside a conversation: the agents in it, each opening its page and
 * taken out again (not the area's own), „Agent hinzufügen“ at the heading's end. Open, the column
 * holds them – the head shows them no more.
 */
export function ChatAgents({
  channel,
  add,
  onRemove,
}: {
  channel: SenderChannel;
  /** „Agent hinzufügen“ – where one may write here. */
  add: ReactNode;
  onRemove: (agent: SenderChannelAgent) => void;
}) {
  const ui = useSender();
  return (
    <AsidePart label="Agenten" icon="autoAwesome" actions={add}>
      {channel.agents.length === 0 ? (
        <p className="text-caption text-fg-muted">
          Noch kein Agent in dieser Unterhaltung. Füg einen hinzu, oder ruf einen mit @ und seinem
          Namen – er liest dann mit, was zuvor hier stand.
        </p>
      ) : (
        <ul className="flex flex-col">
          {channel.agents.map((agent) => (
            <li
              key={agent.id}
              className="group relative flex items-center gap-3 rounded-control px-1 py-1.5 transition-colors hover:bg-surface-1 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-focus"
            >
              <AgentAvatar id={agent.id} size={28} className="shrink-0 rounded-mark" />
              <Link
                to={ui.agentPath(agent.id)}
                className="min-w-0 flex-1 truncate text-body text-fg after:absolute after:inset-0 focus-visible:outline-none"
              >
                {agent.title}
              </Link>
              {channel.canWrite && !agent.own && (
                <IconButton
                  icon="close"
                  label={`${agent.title} entfernen`}
                  variant="subtle"
                  size="sm"
                  className="relative opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => onRemove(agent)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </AsidePart>
  );
}
