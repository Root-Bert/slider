import type { SenderAgent, SenderChannel } from '@slider/shared';
import { hasWords, useDrafts, type Draft } from '@/lib/drafts';
import { allChannels, useSenderOrNull } from './useSender';

/** Where a draft of the list goes – what its row shows and opens. */
export type DraftPlace =
  | { kind: 'conversation'; channel: SenderChannel }
  | { kind: 'agent'; agentId: string; chatId: string; agent: SenderAgent | undefined }
  | { kind: 'mail'; threadId: string }
  | { kind: 'agent-new'; areaId: string | null }
  | { kind: 'mail-new' };

export interface DraftEntry {
  key: string;
  draft: Draft;
  place: DraftPlace;
  /**
   * The row's name: the conversation, the agent (and its chat), the mail, „Neuer Agent“ (and its
   * area), „Neue Mail“ (and its subject).
   */
  name: string;
}

/**
 * Every draft of the workspace – conversations, agents' chats, mail answers, a new agent's order
 * (the workspace's, an area's), a new mail –, the latest first. A conversation or agent one no
 * longer sees is left out.
 */
export function useWorkspaceDrafts(): DraftEntry[] {
  const ui = useSenderOrNull();
  const drafts = useDrafts();
  const home = ui?.home;
  if (!ui || !home) return [];
  const channels = new Map(allChannels(home).map((channel) => [channel.id, channel]));
  const agents = new Map(home.agents.map((agent) => [agent.id, agent]));
  const entries: DraftEntry[] = [];
  for (const [key, draft] of Object.entries(drafts)) {
    if (!hasWords(draft)) continue;
    const target = draft.target;
    if (target && target.workspaceId !== ui.workspace.id) continue;
    if (!target || target.kind === 'conversation') {
      const channel = channels.get(key);
      if (channel)
        entries.push({ key, draft, place: { kind: 'conversation', channel }, name: channel.name });
      continue;
    }
    if (target.kind === 'mail') {
      entries.push({
        key,
        draft,
        place: { kind: 'mail', threadId: target.threadId },
        name: target.name,
      });
    } else if (target.kind === 'agent') {
      const agent = agents.get(target.agentId);
      if (!agent) continue;
      entries.push({
        key,
        draft,
        place: { kind: 'agent', agentId: target.agentId, chatId: target.chatId, agent },
        name: target.chat ? `${agent.title} · ${target.chat}` : agent.title,
      });
    } else if (target.kind === 'agent-new') {
      const areaId = target.areaId ?? null;
      entries.push({
        key,
        draft,
        place: { kind: 'agent-new', areaId },
        name: areaId && target.area ? `Neuer Agent · ${target.area}` : 'Neuer Agent',
      });
    } else if (target.kind === 'mail-new') {
      const subject = target.subject.trim();
      entries.push({
        key,
        draft,
        place: { kind: 'mail-new' },
        name: subject ? `Neue Mail · ${subject}` : 'Neue Mail',
      });
    }
  }
  return entries.sort((a, b) => b.draft.at.localeCompare(a.draft.at));
}
