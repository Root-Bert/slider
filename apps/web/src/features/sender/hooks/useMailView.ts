import { useState, useSyncExternalStore } from 'react';
import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router';
import {
  ALL_MAILBOXES,
  allMailboxFolders,
  mailboxLabels,
  type MailAccount,
  type MailFolder,
} from '@slider/shared';
import { useMailAccounts } from '@/lib/api';
import { createStoredStore } from '@/lib/storage';
import { useMediaQuery } from '@/ui';
import { mailViewOf, mailViewSearch, NEW_MAIL, OVERVIEW } from '../lib/mail';
import { useSender } from './useSender';

/** From this width an opened mail stands beside the list; below, it takes the page (with back). */
const SPLIT_QUERY = '(min-width: 1280px)';

/** Where `#hinzufuegen` points on the Postfächer page: its „Postfach hinzufügen“ form. */
export const ADD_MAILBOX_HASH = '#hinzufuegen';

export interface MailViewState {
  /** `undefined` while loading. */
  accounts: MailAccount[] | undefined;
  /** The open mailbox – `null` in „Alle“ and without any. */
  account: MailAccount | null;
  /** „Alle“: every mailbox at once (from two on, the default) – their special folders. */
  all: boolean;
  labels: Map<string, string>;
  folders: MailFolder[];
  folder: string;
  /** Only the unread ones – one switch for every mailbox and folder, remembered in this browser. */
  unread: boolean;
  /**
   * The page's search, as typed: while it holds words the list is what they find in the open
   * mailbox, every folder. Kept while a mail opens and closes; gone with the page.
   */
  query: string;
  setQuery: (query: string) => void;
  threadId: string | undefined;
  /** Wide enough for the list and an opened mail side by side. */
  wide: boolean;
  /** The list's address for a mailbox or „Alle“ (`ALL_MAILBOXES`), and folder; the open mail closes. */
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
 * mail open beside it (`…/mail/:threadId`). Without a mailbox named: „Alle“ from two mailboxes on
 * (as the left-most of a page's views), else the one – so a mail opened in „Alle“ stays there.
 */
export function useMailView(): MailViewState {
  const ui = useSender();
  const navigate = useNavigate();
  const { threadId } = useParams();
  const [params] = useSearchParams();
  const wide = useMediaQuery(SPLIT_QUERY);
  const accounts = useMailAccounts(ui.workspace.id).data;
  const asked = mailViewOf(params);
  const withAll = (accounts?.length ?? 0) > 1;
  const fallback = withAll ? ALL_MAILBOXES : (accounts?.[0]?.id ?? '');
  const named =
    (asked.accountId === ALL_MAILBOXES && withAll) ||
    accounts?.some((each) => each.id === asked.accountId);
  const current = named && asked.accountId ? asked.accountId : fallback;
  const all = current === ALL_MAILBOXES;
  const account = all ? null : (accounts?.find((each) => each.id === current) ?? null);
  const folders = all ? allMailboxFolders(accounts ?? []) : (account?.folders ?? []);
  const folder =
    asked.folder === OVERVIEW || folders.some((each) => each.key === asked.folder)
      ? asked.folder
      : OVERVIEW;
  const unread = useSyncExternalStore(unreadStore.subscribe, unreadStore.getSnapshot);
  const [query, setQuery] = useState('');
  const searchOf = (accountId: string, key: string) =>
    mailViewSearch({ accountId, folder: key }, accountId === fallback);
  const search = current ? searchOf(current, folder) : '';
  const listHref = (accountId: string, key = OVERVIEW) =>
    `${ui.mailPath}${searchOf(accountId, key)}`;
  return {
    accounts,
    account,
    all,
    labels: mailboxLabels(accounts ?? []),
    folders,
    folder,
    unread,
    query,
    setQuery,
    threadId,
    wide,
    listHref,
    threadHref: (id) => `${ui.mailThreadPath(id)}${search}`,
    closeHref: `${ui.mailPath}${search}`,
    setFolder: (key) => {
      if (current) void navigate(listHref(current, key), { replace: true });
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
