import {
  createContext,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AccountAuthor, SenderChannel, SenderHome, Workspace } from '@slider/shared';
import { useNavigate } from 'react-router';
import { useMe, useSenderHome, useSenderLive } from '@/lib/api';
import { useDraftSync } from '@/lib/drafts';
import { routes } from '@/lib/routes';
import { badgeCount, showBadge, tell, worthTelling } from '../lib/notify';
import { newPath, type NewKind } from '../lib/new';
import { useToast, type ShowToast, type ToastMessage } from '@/ui';

/** How long „X schreibt …“ stays after the last sign. */
const TYPING_SHOWN_MS = 4500;

interface SenderUi {
  workspace: Workspace;
  me: AccountAuthor;
  home: SenderHome | undefined;
  homeFailed: boolean;
  notify: ShowToast;
  toast: ToastMessage | null;
  /** Who writes in a conversation right now, the caller left out. */
  typingIn: (channelId: string) => AccountAuthor[];
  /** The conversation on screen tells the live stream so (new messages there are read). */
  setOpenChannel: (channelId: string | null) => void;
  /** A conversation of the side bar by its id. */
  channel: (channelId: string) => SenderChannel | undefined;
  /** Where a conversation opens – in Sender, or in Cloud where Sender lives inside it. */
  pathOf: (channel: ChannelPlace) => string;
  /** Where an agent's conversation opens – Sender's own page, or the agent's page in Cloud. */
  agentPath: (agentId: string) => string;
  /** Where one lands once the open conversation is gone (deleted, left). */
  homePath: string;
  /** „Entwürfe“ – Sender's page, or Cloud's. */
  draftsPath: string;
  /** „Post“, a mail conversation, „Postfächer“ – Sender's pages, or Cloud's. */
  mailPath: string;
  mailThreadPath: (threadId: string) => string;
  mailAccountsPath: string;
  /** „Neues Postfach“: the add form as a page of its own. */
  newMailboxPath: string;
  /** Where „Neu“ opens its form: a channel (in an area) or a conversation with people. */
  newPath: (kind: NewKind, areaId?: string) => string;
}

/** What says where a conversation opens. */
export type ChannelPlace = Pick<SenderChannel, 'id' | 'areaId' | 'kind'>;

const Context = createContext<SenderUi | null>(null);

/** The provider's state, `null` until one's own account is known. */
export const useSenderOrNull = (): SenderUi | null => use(Context);

export function useSender(): SenderUi {
  const ui = use(Context);
  if (!ui) throw new Error('useSender outside SenderProvider');
  return ui;
}

/** Every conversation of the side bar in one list. */
export const allChannels = (home: SenderHome | undefined): SenderChannel[] =>
  home ? [...home.areas.flatMap((area) => area.channels), ...home.groups, ...home.direct] : [];

export function SenderProvider({
  workspace,
  pathOf = (channel) => routes.messagesChannel(workspace.id, channel.id),
  agentPath = (agentId) => routes.messagesAgent(workspace.id, agentId),
  homePath = routes.messages(workspace.id),
  draftsPath = routes.messagesDrafts(workspace.id),
  mailPath = routes.messagesMail(workspace.id),
  mailThreadPath = (threadId) => routes.messagesMailThread(workspace.id, threadId),
  mailAccountsPath = routes.messagesMailAccounts(workspace.id),
  newMailboxPath = routes.messagesNewMailbox(workspace.id),
  newBase = routes.messages(workspace.id),
  children,
}: {
  workspace: Workspace;
  pathOf?: (channel: ChannelPlace) => string;
  agentPath?: (agentId: string) => string;
  homePath?: string;
  draftsPath?: string;
  mailPath?: string;
  mailThreadPath?: (threadId: string) => string;
  mailAccountsPath?: string;
  newMailboxPath?: string;
  /** The page „Neu“'s form opens over (`?neu=`). */
  newBase?: string;
  children: ReactNode;
}) {
  const me = useMe().data?.viewer.author ?? null;
  const home = useSenderHome(workspace.id);
  const [toast, notify] = useToast();
  const open = useRef<string | null>(null);
  const navigate = useNavigate();
  // Read when an event comes: the newest, not the first render's.
  const latest = useRef({ me, home: home.data, navigate, pathOf });
  useEffect(() => {
    latest.current = { me, home: home.data, navigate, pathOf };
  });
  const [typing, setTyping] = useState<
    Map<string, Map<string, { author: AccountAuthor; until: number }>>
  >(() => new Map());
  useSenderLive(workspace.id, {
    openChannel: () => open.current,
    me: () => latest.current.me,
    onMessage: (channelId, message, shown) => {
      const { me: self, home: data } = latest.current;
      const channel = allChannels(data).find((each) => each.id === channelId);
      // Looked at right now: nothing to tell.
      if (!self || !channel || (shown && document.hasFocus())) return;
      if (!worthTelling(channel, message, self)) return;
      tell(channel, message, () => void latest.current.navigate(latest.current.pathOf(channel)));
    },
    onTyping: (channelId, author) =>
      setTyping((now) => {
        const next = new Map(now);
        const inChannel = new Map(next.get(channelId));
        inChannel.set(author.id, { author, until: Date.now() + TYPING_SHOWN_MS });
        next.set(channelId, inChannel);
        return next;
      }),
  });
  // What is old goes once a second while anyone writes.
  useEffect(() => {
    if (typing.size === 0) return;
    const timer = window.setInterval(() => {
      const at = Date.now();
      setTyping((now) => {
        const next = new Map<string, Map<string, { author: AccountAuthor; until: number }>>();
        for (const [channelId, people] of now) {
          const left = new Map([...people].filter(([, each]) => each.until > at));
          if (left.size > 0) next.set(channelId, left);
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [typing.size]);

  // Drafts, the same on every device: the server's list laid over this browser's, and back.
  useDraftSync(workspace.id, home.data ? allChannels(home.data).map((each) => each.id) : undefined);

  // The count on the app's icon and in the tab's title.
  const count = badgeCount(home.data);
  useEffect(() => {
    showBadge(count);
  }, [count]);
  useEffect(() => () => showBadge(0), []);

  const typingIn = useCallback(
    (channelId: string) =>
      [...(typing.get(channelId)?.values() ?? [])]
        .map((each) => each.author)
        .filter((author) => author.id !== me?.id),
    [typing, me?.id],
  );
  const setOpenChannel = useCallback((channelId: string | null) => {
    open.current = channelId;
  }, []);
  const data = home.data;
  const channel = useCallback(
    (channelId: string) => allChannels(data).find((each) => each.id === channelId),
    [data],
  );
  const ui: SenderUi | null = me
    ? {
        workspace,
        me,
        home: data,
        homeFailed: home.isError && !data,
        notify,
        toast,
        typingIn,
        setOpenChannel,
        channel,
        pathOf,
        agentPath,
        homePath,
        draftsPath,
        mailPath,
        mailThreadPath,
        mailAccountsPath,
        newMailboxPath,
        newPath: (kind, areaId) => newPath(newBase, kind, areaId),
      }
    : null;
  return <Context value={ui}>{children}</Context>;
}
