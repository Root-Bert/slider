import type { CallState } from '@slider/shared';
import { routes } from '@/lib/routes';

/** A call's name as one sees it: the other person, the group, the area or „#channel“. */
export function callTitle(call: CallState, me: string | null): string {
  // One's own call with an agent (no conversation); one brought in leaves the conversation's name.
  if (call.agent && !call.channelId) return call.agent.title;
  if (call.kind === 'direct') {
    const other = call.people.find((person) => person.id !== me);
    return other?.name ?? call.startedBy.name;
  }
  if (call.kind === 'group' && !call.title) {
    const names = call.people
      .filter((person) => person.id !== me)
      .map((person) => person.name.split(' ')[0]);
    return names.join(', ') || 'Gruppe';
  }
  return call.title;
}

/** Where an agent opens: in Cloud while one is in Cloud, else its chat in Sender. */
export function agentPath(workspaceId: string, agentId: string, pathname: string): string {
  return pathname.startsWith(`/w/${workspaceId}/dateien`)
    ? routes.cloudAgent(workspaceId, agentId)
    : routes.messagesAgent(workspaceId, agentId);
}

/** Where its conversation (or the agent's chat) opens: in Cloud while one is in Cloud, else in Sender. */
export function callPath(call: CallState, pathname: string): string {
  const inCloud = pathname.startsWith(`/w/${call.workspaceId}/dateien`);
  if (call.agent && !call.channelId) return agentPath(call.workspaceId, call.agent.id, pathname);
  if (!inCloud) return routes.messagesChannel(call.workspaceId, call.channelId);
  return call.areaId
    ? routes.cloudAreaChat(call.workspaceId, call.areaId, call.channelId)
    : routes.cloudChat(call.workspaceId, call.channelId);
}

/** `4:07`, `1:02:33` – how long one is in the call. */
export function duration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}
