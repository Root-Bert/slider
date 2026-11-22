import { useMailThreads, useSenderUnread } from '@/lib/api';
import { allChannels, useSender } from './useSender';

/**
 * What is unread where one reads – conversations, agents, mail (spam aside) – the latest first,
 * from the server's `/sender/unread`. `stamp` is what the side bar's counts and the mails say;
 * when something comes in or is read it changes and the list is asked anew (Sender's „Aktuell“,
 * Cloud's „Zuletzt“).
 */
export function useUnreadNow() {
  const ui = useSender();
  const mail = useMailThreads(ui.workspace.id);
  const stamp = ui.home
    ? [
        ...allChannels(ui.home),
        ...ui.home.agents,
        ...(mail.data ?? []).filter((each) => !each.spam),
      ]
        .filter((each) => each.unread > 0)
        .map((each) => `${each.id}:${each.unread}:${each.updatedAt}`)
        .sort()
        .join(',')
    : null;
  return { stamp, unread: useSenderUnread(ui.workspace.id, stamp) };
}
