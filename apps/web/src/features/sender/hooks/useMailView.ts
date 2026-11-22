import { useSyncExternalStore } from 'react';
import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router';
import { mailboxLabels, type MailAccount, type MailFolder } from '@slider/shared';
import { useMailAccounts, useMailThreads } from '@/lib/api';
import { createStoredStore } from '@/lib/storage';
import { useMediaQuery } from '@/ui';
import { mailViewOf, mailViewSearch, NEW_MAIL } from '../lib/mail';
import { useSender } from './useSender';

/** From this width an opened mail stands beside the list; below, it takes the page (with back). */
const SPLIT_QUERY = '(min-width: 1280px)';

/** Where `#hinzufuegen` points on the Postfächer page: its „Postfach hinzufügen“ form. */
export const ADD_MAILBOX_HASH = '#hinzufuegen';

export interface MailViewState {
  /** `undefined` while loading. */
  accounts: MailAccount[] | undefined;
  account: MailAccount | null;
  labels: Map<string, string>;
  folders: MailFolder[];
  folder: string;
  /** Only the unread ones – one switch for every mailbox and folder, remembered in this browser. */
  unread: boolean;
  threadId: string | undefined;
  /** Wide enough for the list and an opened mail side by side. */
  wide: boolean;
  /** The list's address for a mailbox (and folder); the open mail closes. */
  listHref: (accountId: string, folder?: string) => string;
  /** An opened mail's address – the list beside it keeps its mailbox and folder. */
  threadHref: (threadId: string) => string;
  /** The list as it is, without the open mail. */
  closeHref: string;
  setFolder: (folder: string) => void;
  setUnread: (unread: boolean) => void;
}

/** „Ungelesen“ on or off: for every mailbox and folder, kept through a switch and the next visit. */
const unreadStore = createStoredStore<boolean>({
  key: 'slider.mail.unread',
  parse: (value) => value === true,
  fallback: false,
});

/**
 * Which mailbox and folder the mail page shows (`?postfach=&ordner=`, see `mailViewOf`) and the
 * mail open beside it (`…/mail/:threadId`). Without a mailbox named: the open mail's, else the first.
 */
export function useMailView(): MailViewState {
  const ui = useSender();
  const navigate = useNavigate();
  const { threadId } = useParams();
  const [params] = useSearchParams();
  const wide = useMediaQuery(SPLIT_QUERY);
  const accounts = useMailAccounts(ui.workspace.id).data;
  const all = useMailThreads(ui.workspace.id).data;
  const asked = mailViewOf(params);
  const ofOpen = threadId ? all?.find((each) => each.id === threadId)?.accountId : undefined;
  const account =
    accounts?.find((each) => each.id === asked.accountId) ??
    accounts?.find((each) => each.id === ofOpen) ??
    accounts?.[0] ??
    null;
  const folders = account?.folders ?? [];
  const folder = folders.some((each) => each.key === asked.folder) ? asked.folder : 'inbox';
  const unread = useSyncExternalStore(unreadStore.subscribe, unreadStore.getSnapshot);
  const searchOf = (accountId: string, key: string) =>
    mailViewSearch({ accountId, folder: key }, accounts?.[0]?.id === accountId);
  const search = account ? searchOf(account.id, folder) : '';
  const listHref = (accountId: string, key = 'inbox') =>
    `${ui.mailPath}${searchOf(accountId, key)}`;
  return {
    accounts,
    account,
    labels: mailboxLabels(accounts ?? []),
    folders,
    folder,
    unread,
    threadId,
    wide,
    listHref,
    threadHref: (id) => `${ui.mailThreadPath(id)}${search}`,
    closeHref: `${ui.mailPath}${search}`,
    setFolder: (key) => {
      if (account) void navigate(listHref(account.id, key), { replace: true });
    },
    // The open mail stays open: only the list beside it changes.
    setUnread: unreadStore.set,
  };
}

/** What the conversation route hears from the list around it: it stands in the pane beside. */
export interface MailOutlet {
  split: boolean;
  /** The open mail takes the whole width, the list hidden (remembered in this browser). */
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
}

/** Whether the opened mail stands beside the list (the pane gives its height) or as the page. */
export const useMailSplit = () => useOutletContext<MailOutlet | undefined>()?.split ?? false;

/** Beside the list: its pane's width („Vergrößern“ / „Verkleinern“); as the page: none. */
export const useMailPane = () => useOutletContext<MailOutlet | undefined>();

/** The AI beside an open mail, opened or closed: remembered in this browser, for the next mail too. */
const asideStore = createStoredStore<boolean>({
  key: 'slider.mail.aside',
  parse: (value) => value === true,
  fallback: false,
});

/** Whether the AI stands beside the open mail, and its switch (the folders' row, or the mail's head). */
export function useMailAside() {
  const open = useSyncExternalStore(asideStore.subscribe, asideStore.getSnapshot);
  return [open, asideStore.set] as const;
}

/** A conversation open – not the new mail's form. */
export const isMailThreadOpen = (threadId: string | undefined) =>
  !!threadId && threadId !== NEW_MAIL;
