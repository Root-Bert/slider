import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ALL_MAILBOXES, mailThreadKind, type MailThreadSummary } from '@slider/shared';
import {
  MAIL_LISTED,
  MAIL_LISTED_MAX,
  prefetchMailThread,
  useDeleteMailThread,
  useMailFolder,
  useMailSearch,
  useMailSearchOnServer,
  useMailSpam,
  useOlderMail,
  useReadMailThread,
  useUnreadMailThread,
} from '@/lib/api';
import { Empty } from '@/features/cloud';
import { formatRelativeTime } from '@/lib/format';
import {
  ButtonLink,
  cn,
  ConfirmDialog,
  ContextMenu,
  Icon,
  ListRow,
  Menu,
  RowList,
  useDebounced,
  type MenuAction,
} from '@/ui';
import { useMailListLook, type MailSpacing } from '../../hooks/useMailListLook';
import { useMailRuleActions } from '../../hooks/useMailRuleActions';
import { usePinAction } from '../../hooks/usePinAction';
import { ROW_MENU_CLASS, useRowMenu } from '../../hooks/useRowMenu';
import { useSender } from '../../hooks/useSender';
import { mailGroupName, mailName, OVERVIEW, spamActions, spamMarkOf } from '../../lib/mail';
import { pinnedFirst } from '../../lib/pins';
import { PinnedMark } from '../PinnedMark';
import { Unread } from '../SenderSidebar';
import { MailAvatar } from './MailAvatar';
import { SpamMark } from './SpamMark';
import type { MailViewState } from '../../hooks/useMailView';

/**
 * „Abstand“ (`/einstellungen` › Mail) – the row's padding top and bottom; Normal keeps the
 * `wide` row's 8px. `!` because `cn` merges nothing (design-system §1.4).
 */
const SPACING_CLASSES: Record<MailSpacing, string> = {
  compact: 'py-1!',
  normal: '',
  airy: 'py-3!',
};

/** A mail row's link (the whole row): its menu also at the pointer – right click, long press. */
function RowLink({
  menuLabel,
  actions,
  className,
  ...link
}: ComponentProps<typeof Link> & { menuLabel: string; actions: readonly MenuAction[] }) {
  const menu = useRowMenu();
  return (
    <>
      <Link {...link} {...menu.props} className={cn(className, ROW_MENU_CLASS)} />
      {menu.at && (
        <ContextMenu label={menuLabel} actions={actions} at={menu.at} onClose={menu.close} />
      )}
    </>
  );
}

/** How far ahead of the list's end its next part is fetched – before one gets there. */
const AHEAD_PX = 600;
/**
 * Searches asked of the server lately (mailbox and words) – back from a mail, the same search is
 * not swept through the server again.
 */
const searchedOnServer = new Map<string, number>();
const SEARCHED_MS = 10 * 60_000;

/**
 * The list's end: as it comes near, more of the newest kept here (`limit`), and once none are left
 * here, older ones from the server – again and again while it stays in view and there are older
 * ones, as the chats bring older messages („Ältere laden …“). Refused: said so, tried again on a
 * click.
 */
function ListEnd({
  accountId,
  folder,
  count,
  limit,
  waiting,
  grows,
  onLonger,
}: {
  accountId: string;
  folder: string;
  /** The conversations the list has (before its filters). */
  count: number;
  limit: number;
  /** The list is being fetched (longer, or anew): asked again once it is here. */
  waiting: boolean;
  /** Off: the list stays as it is („Ungelesen“ – short, its end is always in view). */
  grows: boolean;
  onLonger: () => void;
}) {
  const ui = useSender();
  const older = useOlderMail(ui.workspace.id);
  const endRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const end = endRef.current;
    if (!end || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => setNear(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: `0px 0px ${AHEAD_PX}px 0px` },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, []);
  const asking = older.isPending;
  useEffect(() => {
    if (!near || waiting || asking || done || failed || !grows) return;
    // As many as asked for came: more may be kept here – up to the longest a list gets.
    if (count >= limit) return limit < MAIL_LISTED_MAX ? onLonger() : undefined;
    older.mutate(
      { accountId, folder },
      {
        onSuccess: (result) => {
          setFailed(result.failed);
          setDone(!result.more && !result.failed);
        },
        onError: () => setFailed(true),
      },
    );
    // `older` changes each render; what it does is the same.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, waiting, asking, done, failed, count, limit, grows, accountId, folder]);
  return (
    <div ref={endRef}>
      {asking && <p className="py-3 text-center text-xs text-fg-subtle">Ältere laden …</p>}
      {failed && (
        <p className="py-3 text-center text-xs text-fg-subtle">
          Ältere Mails ließen sich nicht laden.{' '}
          <button
            type="button"
            className="font-medium text-fg-muted underline-offset-2 hover:underline"
            onClick={() => setFailed(false)}
          >
            Erneut versuchen
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * One folder of one mailbox, the latest first – pinned ones above them, the latest pinned first –
 * who, what about, its latest words; unread ones as Sender's side bar shows them (name semibold
 * in full ink, the count), the subject in ink too, read ones quiet (name muted, subject and words
 * subtle). A click opens it; its menu („…“, right click, long press) pins it, marks it spam (or
 * not) and deletes it. Beside an open mail it is the same list, only narrower (each line cut
 * short where it ends) – the open one picked. Without a mailbox: the way to add one. How roomy
 * the rows are and how many lines stand under the sender is the person's (`useMailListLook`):
 * none – the subject alone; one – subject and words on one line; two or three – the subject on
 * its own line, the words below.
 */
export function MailInbox({ view }: { view: MailViewState }) {
  const ui = useSender();
  const [look] = useMailListLook();
  const queryClient = useQueryClient();
  const { account, folder } = view;
  // One mailbox's, or every one's („Alle“) – what the list, its search and its end ask for.
  const scope = view.all ? ALL_MAILBOXES : (account?.id ?? '');
  // Scrolled down to its end: more of the newest – from the start again in another folder.
  const listKey = `${scope}|${folder}`;
  const [longer, setLonger] = useState({ key: listKey, limit: MAIL_LISTED });
  const limit = longer.key === listKey ? longer.limit : MAIL_LISTED;
  // „Übersicht“ is no folder on the server: there the list only stands for a search.
  const threads = useMailFolder(ui.workspace.id, folder === OVERVIEW ? '' : scope, folder, limit);
  // Searched (the toolbar's field): what the words find in this mailbox (in „Alle“ in every one),
  // whatever its folder – in what the mails say too.
  const query = useDebounced(view.query.trim(), 150);
  const found = useMailSearch(ui.workspace.id, query, {
    accountId: scope,
    inText: true,
    enabled: scope !== '',
  });
  const listed = query ? found.data : threads.data;
  // Settled a while: older mails on the server it finds come in too (once per search, words of
  // two letters or more) – a quiet line says so meanwhile, as the chats' search of older ones.
  const settled = useDebounced(query, 700);
  const onServer = useMailSearchOnServer(ui.workspace.id);
  const askServer = onServer.mutate;
  const accountId = scope;
  useEffect(() => {
    if (settled.length < 2 || !accountId) return;
    const key = `${accountId}\n${settled.toLowerCase()}`;
    if (Date.now() - (searchedOnServer.get(key) ?? 0) < SEARCHED_MS) return;
    searchedOnServer.set(key, Date.now());
    // Not asked (refused, offline): asked again the next time those words settle.
    askServer(
      { query: settled, accountId, inText: true },
      { onError: () => searchedOnServer.delete(key) },
    );
  }, [settled, accountId, askServer]);
  const searchingServer =
    !!query &&
    onServer.isPending &&
    onServer.variables?.query === query &&
    onServer.variables.accountId === accountId;
  const searchingLine = searchingServer && (
    <p className="py-3 text-center text-xs text-fg-subtle">Ältere Mails werden durchsucht …</p>
  );
  const spam = useMailSpam(ui.workspace.id);
  const read = useReadMailThread(ui.workspace.id);
  const unreadAgain = useUnreadMailThread(ui.workspace.id);
  const remove = useDeleteMailThread(ui.workspace.id);
  const pinAction = usePinAction(ui.workspace.id, ui.notify);
  const ruleActions = useMailRuleActions(ui.workspace.id, ui.notify);
  const [deleting, setDeleting] = useState<MailThreadSummary | null>(null);
  const fail = (error: Error) => ui.notify(error.message, 'danger');
  // „Ungelesen“: a mail read while the filter is on (opened, stepped past) stays in the list
  // until the filter, folder or mailbox changes – rows don't jump away under the pointer.
  const filterKey = `${scope}|${folder}|${view.unread}|${query}`;
  const unreadNow = view.unread
    ? (listed ?? []).filter((each) => each.unread > 0).map((each) => each.id)
    : [];
  const [kept, setKept] = useState({ key: filterKey, ids: new Set(unreadNow) });
  if (kept.key !== filterKey) setKept({ key: filterKey, ids: new Set(unreadNow) });
  else if (unreadNow.some((id) => !kept.ids.has(id)))
    setKept({ key: filterKey, ids: new Set([...kept.ids, ...unreadNow]) });
  if (!view.accounts) return null;
  if (!scope) {
    return (
      // In the middle in Sender; on a Cloud page at the height of every empty list there.
      <div className="m-auto in-data-empty-frame:my-0">
        <Empty
          icon="mail"
          title="Noch kein Postfach"
          message="Trag dein Postfach ein – Gmail, Outlook, iCloud oder jeden anderen Mail-Server. Mails von Kollegen landen dann im Chat mit ihnen, alle anderen hier."
          action={
            <ButtonLink to={ui.newMailboxPath} icon="add">
              Postfach hinzufügen
            </ButtonLink>
          }
        />
      </div>
    );
  }
  if (!listed) return null;
  const isSpam = folder === 'spam';
  const folderName = view.folders.find((each) => each.key === folder)?.name ?? 'Posteingang';
  // Marked spam or not, it moves at once (the server's list follows). In the Posteingang, one with
  // colleagues only on it stands among the chats, as a group.
  const shown = pinnedFirst(
    listed.filter(
      (each) =>
        // Found: wherever it lies, spam too.
        (query
          ? true
          : isSpam
            ? each.spam
            : !each.spam && (folder !== 'inbox' || mailThreadKind(each.people) === 'mail')) &&
        (!view.unread || each.unread > 0 || kept.ids.has(each.id)),
    ),
  );
  if (shown.length === 0) {
    if (searchingServer) return searchingLine;
    return (
      <div className="m-auto in-data-empty-frame:my-0">
        <Empty
          icon={query ? 'search' : 'mail'}
          title={
            query
              ? 'Nichts gefunden'
              : view.unread
                ? 'Alles gelesen'
                : isSpam
                  ? 'Kein Spam'
                  : 'Keine Mails'
          }
          message={
            query
              ? `Keine${view.unread ? ' ungelesene' : ''} Mail ${account ? `in „${view.labels.get(account.id) ?? account.address}“` : 'in deinen Postfächern'} sagt „${query}“ – weder im Betreff noch im Text, bei keinem Namen und keiner Adresse.`
              : view.unread
                ? `In „${folderName}“ ist keine Mail ungelesen.`
                : isSpam
                  ? 'Was nach Spam oder Phishing aussieht, legt die KI hierher.'
                  : folder === 'inbox'
                    ? 'Neue Mails kommen jede Minute.'
                    : `In „${folderName}“ liegt keine Mail.`
          }
        />
      </div>
    );
  }
  const linkProps = (thread: MailThreadSummary) => ({
    to: view.threadHref(thread.id),
    // Stepping from one open mail to the next: back still leads to the list.
    replace: !!view.threadId,
    'data-mail-thread': thread.id,
    onMouseEnter: () => prefetchMailThread(queryClient, ui.workspace.id, thread.id),
    onFocus: () => prefetchMailThread(queryClient, ui.workspace.id, thread.id),
  });
  return (
    <>
      {/* `data-mail-list`: its rows flip on a switch of mailbox (`styles/index.css`). */}
      <RowList variant="hover" aria-label={query ? 'Treffer' : folderName} data-mail-list>
        {shown.map((thread) => {
          const group = mailThreadKind(thread.people) === 'group';
          const unread = thread.unread > 0;
          const name = group ? mailGroupName(thread) : mailName(thread.person);
          const open = thread.id === view.threadId;
          // Who it is with, as the conversation knows them: a colleague's id, signed or not.
          const on = thread.people.find((each) => each.address === thread.person.address);
          const subjectClass = cn(unread && 'font-medium text-fg');
          const snippetClass = cn(unread && 'text-fg-muted');
          // A group's subject is its title: under it only the words.
          const wordLines = group ? look.preview : look.preview - 1;
          // The same in its „…“ menu and at the pointer: pin it first, as a presentation's.
          const actions: MenuAction[] = [
            pinAction('mail', thread.id, thread.pinnedAt),
            // As a mail program: read or new again, its row bold at once.
            unread
              ? {
                  label: 'Als gelesen markieren',
                  icon: 'mail',
                  onSelect: () => read.mutate(thread.id, { onError: fail }),
                }
              : {
                  label: 'Als ungelesen markieren',
                  icon: 'markEmailUnread',
                  onSelect: () => unreadAgain.mutate(thread.id, { onError: fail }),
                },
            ...spamActions(thread, (isSpam, toast) =>
              spam.mutate(
                { threadId: thread.id, spam: isSpam },
                { onSuccess: () => ui.notify(toast), onError: fail },
              ),
            ),
            // A rule for its sender – a group's only from the open mail, where its sender shows.
            ...(group ? [] : ruleActions(thread.id, thread.ruleSender, thread.spam)),
            {
              label: 'Löschen',
              icon: 'delete',
              tone: 'danger',
              onSelect: () => setDeleting(thread),
            },
          ];
          return (
            <ListRow
              key={thread.id}
              variant="hover"
              padding="wide"
              // The open one: a list's picked row (`surface-2`).
              className={cn(
                'relative',
                SPACING_CLASSES[look.spacing],
                // Several lines: avatar, time and menu stand at the top, by the name.
                look.preview > 1 && 'items-start!',
                open && 'bg-surface-2 hover:bg-surface-2',
              )}
              titleWeight={unread ? 'medium' : 'normal'}
              titleTone={unread ? 'fg' : 'muted'}
              leading={
                group ? (
                  <span className="flex size-8 items-center justify-center rounded-chip bg-surface-2 text-fg-muted">
                    <Icon name="groups" size={18} />
                  </span>
                ) : (
                  <MailAvatar
                    person={{ ...thread.person, userId: on?.userId }}
                    vouched={!!on?.vouched}
                    size={32}
                  />
                )
              }
              title={
                // The whole row opens it; the menu stands above that.
                <RowLink
                  {...linkProps(thread)}
                  menuLabel={`Aktionen für „${name}“`}
                  actions={actions}
                  aria-current={open ? 'page' : undefined}
                  className={cn(
                    'outline-none after:absolute after:inset-0 after:rounded-control focus-visible:after:ring-2 focus-visible:after:ring-focus',
                    unread && 'font-semibold',
                  )}
                >
                  {name}
                </RowLink>
              }
              badge={
                thread.pinnedAt || spamMarkOf(thread) ? (
                  <>
                    {thread.pinnedAt && <PinnedMark />}
                    <SpamMark thread={thread} />
                  </>
                ) : undefined
              }
              subtitle={
                look.preview === 0 ? (
                  group ? undefined : (
                    <span className={subjectClass}>{thread.subject}</span>
                  )
                ) : look.preview === 1 ? (
                  <>
                    <span className={subjectClass}>{group ? '' : `${thread.subject} – `}</span>
                    <span className={snippetClass}>{thread.snippet}</span>
                  </>
                ) : (
                  <>
                    {!group && (
                      <span className={cn('block truncate', subjectClass)}>{thread.subject}</span>
                    )}
                    <span
                      className={cn(
                        wordLines === 1
                          ? 'block truncate'
                          : wordLines === 2
                            ? 'whitespace-normal line-clamp-2'
                            : 'whitespace-normal line-clamp-3',
                        snippetClass,
                      )}
                    >
                      {thread.snippet}
                    </span>
                  </>
                )
              }
              subtitleTitle={`${thread.subject}\n${thread.snippet}`}
              trailing={
                <span className="relative flex items-center gap-2">
                  <span
                    className={cn(
                      'text-xs whitespace-nowrap',
                      unread ? 'font-medium text-fg-muted' : 'text-fg-subtle',
                    )}
                  >
                    {formatRelativeTime(thread.updatedAt)}
                  </span>
                  {/* On a phone the name's weight says it: the count's room goes to the name. */}
                  <span className="max-sm:sr-only">
                    <Unread count={thread.unread} />
                  </span>
                  <Menu label={`Aktionen für „${name}“`} actions={actions} />
                </span>
              }
            />
          );
        })}
      </RowList>
      {searchingLine}
      {!query && (
        <ListEnd
          key={listKey}
          accountId={scope}
          folder={folder}
          count={threads.data?.length ?? 0}
          limit={limit}
          waiting={threads.isFetching || threads.isPlaceholderData}
          // „Ungelesen“: the unread among the newest – never the whole mailbox to find some.
          grows={!view.unread}
          onLonger={() => setLonger({ key: listKey, limit: limit + MAIL_LISTED })}
        />
      )}
      {deleting && (
        <ConfirmDialog
          onClose={() => setDeleting(null)}
          title="Mail löschen?"
          description="Sie verschwindet hier. Im Postfach auf dem Mail-Server bleibt sie."
          confirmLabel="Löschen"
          confirmIcon="delete"
          onConfirm={() => {
            const { id } = deleting;
            setDeleting(null);
            remove.mutate(id, { onSuccess: () => ui.notify('Mail gelöscht'), onError: fail });
          }}
        />
      )}
    </>
  );
}
