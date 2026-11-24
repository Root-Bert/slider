import {
  TRIAGE_GROUPS,
  type SenderTriage,
  type SenderTriageRead,
  type TriageGroup,
  type TriageGroupKey,
  type TriageItem,
} from '@slider/shared';
import type { IconName } from '@/ui';

/* Sender's start as a to-do list (`components/Triage.tsx`): its groups, and what goes out of it. */

export const TRIAGE_LOOK: Record<
  TriageGroupKey,
  { label: string; icon: IconName; /** Rows shown before „Alle N zeigen“. */ shown: number }
> = {
  mentions: { label: 'Erwähnungen', icon: 'at', shown: 5 },
  direct: { label: 'Direktnachrichten', icon: 'person', shown: 5 },
  requests: { label: 'Anfragen', icon: 'flag', shown: 5 },
  conversations: { label: 'Gruppen und Bereiche', icon: 'groups', shown: 3 },
  agents: { label: 'Agents', icon: 'autoAwesome', shown: 3 },
  mail: { label: 'Mails', icon: 'mail', shown: 3 },
  notices: { label: 'Hinweise', icon: 'notifications', shown: 3 },
  newsletters: { label: 'Newsletter', icon: 'article', shown: 4 },
  spam: { label: 'Spam', icon: 'report', shown: 0 },
};

export type TriageRef = SenderTriageRead['items'][number];
export const refOf = ({ item }: TriageItem): TriageRef => ({ kind: item.kind, id: item.id });
export const keyOfItem = ({ item }: Pick<TriageItem, 'item'>) => `${item.kind}:${item.id}`;

/**
 * What to show: the AI's answer once it is there for what is unread now (`fresh`); while it is
 * asked anew, its last answer for what is still unread – what came in since stands in the
 * server's own group, as it is (new, at the top).
 */
export function shownTriage(
  plain: SenderTriage | undefined,
  told: SenderTriage | undefined,
  fresh: boolean,
): SenderTriage | undefined {
  if (!told) return plain;
  if (!plain || fresh) return told;
  const now = new Map(
    plain.groups.flatMap((group) => group.items.map((each) => [keyOfItem(each), each])),
  );
  const placed = new Set<string>();
  const groups = new Map<TriageGroupKey, TriageGroup>();
  for (const group of told.groups) {
    const items = group.items.flatMap((each) => {
      const current = now.get(keyOfItem(each));
      if (!current) return [];
      placed.add(keyOfItem(each));
      return [{ ...each, item: current.item }];
    });
    if (items.length > 0) groups.set(group.key, { ...group, items });
  }
  for (const group of plain.groups)
    for (const each of group.items) {
      if (placed.has(keyOfItem(each))) continue;
      const into = groups.get(group.key) ?? { key: group.key, summary: null, items: [] };
      groups.set(group.key, { ...into, items: [each, ...into.items] });
    }
  return { ...told, groups: TRIAGE_GROUPS.flatMap((key) => groups.get(key) ?? []) };
}

export interface NewsletterSender {
  key: string;
  name: string;
  address: string | null;
  /** The latest first. */
  items: TriageItem[];
}

/** Newsletters by who sends them – the one with the most unread first. */
export function bySender(items: readonly TriageItem[]): NewsletterSender[] {
  const senders = new Map<string, NewsletterSender>();
  for (const each of items) {
    const address = each.from?.address.toLowerCase() ?? null;
    const key = address ?? each.item.name;
    const known = senders.get(key);
    if (known) known.items.push(each);
    else
      senders.set(key, {
        key,
        name: each.from?.name || each.from?.address || each.item.name,
        address,
        items: [each],
      });
  }
  return [...senders.values()].sort((a, b) => b.items.length - a.items.length);
}

/** One item as a line for an agent or a colleague: what it is, where, what it says. */
function lineOf(each: TriageItem, withIds: boolean): string {
  const { item } = each;
  const from = each.from ? ` von ${each.from.name || each.from.address}` : '';
  const id = withIds
    ? item.kind === 'mail'
      ? ` (Mail-Konversation ${item.id})`
      : item.kind === 'agent'
        ? ` (Agent ${item.id})`
        : ` (Unterhaltung ${item.id})`
    : '';
  const what =
    each.line ??
    (item.last ? (item.last.who ? `${item.last.who}: ${item.last.text}` : item.last.text) : '');
  const kind = item.kind === 'mail' ? 'Mail' : item.kind === 'agent' ? 'Agent' : 'Unterhaltung';
  return `- ${kind} „${item.name}“${from}${id}${what ? `: ${what}` : ''}`;
}

/** The order an agent gets: what to do, then the items by id so it can read them itself. */
export const orderText = (instruction: string, items: readonly TriageItem[]) =>
  `${instruction}\n\nEs geht um:\n${items.map((each) => lineOf(each, true)).join('\n')}`;

/** What stands in the field of the conversation with a colleague: the items, to talk about. */
export const talkText = (items: readonly TriageItem[]) =>
  `Kannst du dir das mit mir ansehen?\n${items.map((each) => lineOf(each, false)).join('\n')}`;
