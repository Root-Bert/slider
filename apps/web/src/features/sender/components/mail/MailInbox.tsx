import { useState, type ComponentProps } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { mailThreadKind, type MailThreadSummary } from '@slider/shared';
import {
  prefetchMailThread,
  useDeleteMailThread,
  useMailFolder,
  useMailSearch,
  useMailSpam,
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
import { mailGroupName, mailName, spamActions, spamMarkOf } from '../../lib/mail';
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
  const threads = useMailFolder(ui.workspace.id, account?.id ?? '', folder);
  // Searched (the toolbar's field): what the words find in this mailbox, whatever its folder –
  // in what the mails say too.
  const query = useDebounced(view.query.trim(), 150);
  const found = useMailSearch(ui.workspace.id, query, {
    accountId: account?.id ?? '',
    inText: true,
    enabled: !!account,
  });
  const listed = query ? found.data : threads.data;
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
  const filterKey = `${account?.id ?? ''}|${folder}|${view.unread}|${query}`;
  const unreadNow = view.unread
    ? (listed ?? []).filter((each) => each.unread > 0).map((each) => each.id)
    : [];
  const [kept, setKept] = useState({ key: filterKey, ids: new Set(unreadNow) });
  if (kept.key !== filterKey) setKept({ key: filterKey, ids: new Set(unreadNow) });
  else if (unreadNow.some((id) => !kept.ids.has(id)))
    setKept({ key: filterKey, ids: new Set([...kept.ids, ...unreadNow]) });
  if (!view.accounts) return null;
  if (!account) {
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
              ? `Keine${view.unread ? ' ungelesene' : ''} Mail in „${view.labels.get(account.id) ?? account.address}“ sagt „${query}“ – weder im Betreff noch im Text, bei keinem Namen und keiner Adresse.`
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
                  <Unread count={thread.unread} />
                  <Menu label={`Aktionen für „${name}“`} actions={actions} />
                </span>
              }
            />
          );
        })}
      </RowList>
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
