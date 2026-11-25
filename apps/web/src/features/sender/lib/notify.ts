import {
  mentionsAll,
  mentionsIn,
  type AccountAuthor,
  type SenderChannel,
  type SenderHome,
  type SenderMessage,
} from '@slider/shared';
import { mayNotify } from '@/lib/notify-prefs';
import { markupPlain } from './markup';

/**
 * What Sender's app adds on a computer (`desktop/sender`): the count on its icon in the Dock or
 * task bar, and its window to the front when a notification is clicked. In the browser
 * `window.senderDesktop` does not exist; an installed web app has `navigator.setAppBadge`.
 */
interface SenderBridge {
  setBadge(count: number): void;
  show(): void;
}

declare global {
  interface Window {
    senderDesktop?: SenderBridge;
  }
}

/**
 * What counts on the app's icon: what was written to one in a group or directly, a channel
 * where one was named, an agent's answers – as Slack does, not every channel's chatter. A muted
 * conversation („Stummschalten“) counts only where one was named.
 */
export function badgeCount(home: SenderHome | undefined): number {
  if (!home) return 0;
  const channels = home.areas.flatMap((area) => area.channels);
  return (
    [...home.groups, ...home.direct].reduce(
      (sum, each) => sum + (each.muted ? Number(each.mentioned) : each.unread),
      0,
    ) +
    channels.filter((each) => each.mentioned).length +
    home.agents.reduce((sum, each) => sum + each.unread, 0)
  );
}

export function showBadge(count: number): void {
  window.senderDesktop?.setBadge(count);
  const nav = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (count > 0) void nav.setAppBadge?.(count).catch(() => {});
  else void nav.clearAppBadge?.().catch(() => {});
}

/**
 * Whether a message is worth a notification: to oneself, in a group, or naming one – in a muted
 * conversation only what names one.
 */
export function worthTelling(
  channel: SenderChannel,
  message: SenderMessage,
  me: AccountAuthor,
): boolean {
  if (message.deleted || (!message.agent && message.author?.id === me.id)) return false;
  if (!channel.muted && (channel.kind === 'direct' || channel.kind === 'group')) return true;
  return mentionsIn(message.text, [me]).length > 0 || mentionsAll(message.text);
}

/** The notification's title: who wrote, and where if not to oneself alone. */
function titleOf(channel: SenderChannel, message: SenderMessage): string {
  const who = message.agent?.title ?? message.author?.name ?? 'Jemand';
  if (channel.kind === 'direct') return who;
  const where = channel.kind === 'channel' ? `#${channel.name}` : channel.name;
  return `${who} in ${where}`;
}

/** One notification per conversation: a newer one takes the older one's place. */
export function tell(channel: SenderChannel, message: SenderMessage, onOpen: () => void): void {
  if (!mayNotify()) return;
  const files = message.attachments ?? [];
  // Files alone: their names stand for the words.
  const text = (
    markupPlain(message.text) ||
    (files.length
      ? `${files.length === 1 ? 'Datei' : 'Dateien'}: ${files.map((one) => one.name).join(', ')}`
      : '')
  )
    .replace(/\s+/g, ' ')
    .trim();
  const notification = new Notification(titleOf(channel, message), {
    body: text.length > 180 ? `${text.slice(0, 179)}…` : text,
    icon: '/sender-icon-192.png?v=2',
    tag: `sender:${channel.id}`,
  });
  notification.onclick = () => {
    window.senderDesktop?.show();
    window.focus();
    onOpen();
    notification.close();
  };
}
