import { useSyncExternalStore } from 'react';
import type { CloudAgentOverview } from '@slider/shared';
import { createStoredStore } from './storage';

/*
 * The agent asked under an overview – Sender's „Aktuell“, a mailbox's „Übersicht“, Cloud's „Für
 * dich“ – per workspace and overview, as the calendar keeps its own: back on the page, its chat is
 * there again, until „Neue Frage“.
 */

const store = createStoredStore<Record<string, string>>({
  key: 'slider.overview.agents',
  parse: (value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : {},
  fallback: {},
  crossTab: true,
});

const keyOf = (workspaceId: string, overview: CloudAgentOverview) =>
  `${workspaceId}:${overview.of}:${overview.mailbox ?? ''}`;

export function useOverviewAgent(workspaceId: string, overview: CloudAgentOverview) {
  const all = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const key = keyOf(workspaceId, overview);
  const set = (agentId: string | null) => {
    const { [key]: _gone, ...rest } = store.getSnapshot();
    store.set(agentId ? { ...rest, [key]: agentId } : rest);
  };
  return [all[key] ?? null, set] as const;
}
