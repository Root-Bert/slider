import type { MailThreadSummary, SenderAgent, SenderChannel, SenderPinKind } from '@slider/shared';

/**
 * „Anpinnen“ (as Präsentationen and Cloud's folders): pinned ones first, the latest pinned on
 * top (Slack, WhatsApp, Apple Mail); the rest in the order they came.
 */
export function pinnedFirst<T extends { pinnedAt?: string | null }>(list: readonly T[]): T[] {
  const pinned = list
    .filter((each) => each.pinnedAt)
    .sort((a, b) => (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? ''));
  return pinned.length === 0 ? [...list] : [...pinned, ...list.filter((each) => !each.pinnedAt)];
}

/** What a chat is, to pin it: a conversation, an agent or a mail conversation (`isMailChat`). */
export const pinKindOf = (chat: SenderChannel | SenderAgent | MailThreadSummary): SenderPinKind =>
  'snippet' in chat ? 'mail' : 'title' in chat ? 'agent' : 'channel';
