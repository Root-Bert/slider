import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type RefObject,
} from 'react';
import { Link, Outlet, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { MailFolderRole } from '@slider/shared';
import { prefetchMailFolder, useSyncMailAccount } from '@/lib/api';
import { isTextTarget, tabStep } from '@/lib/dom';
import { readString, writeString } from '@/lib/storage';
import { useKeptWidth } from '@/features/cloud';
import { BarHandle } from '@/shell/BarHandle';
import {
  HeaderPopover,
  startViewSwitch,
  useViewSwitchTop,
  VIEW_LINK_CLASS,
  ViewSearch,
} from '@/features/workspaces';
import {
  Button,
  cn,
  ContextMenu,
  GlassPanel,
  Icon,
  MenuItem,
  SegmentedControl,
  useMediaQuery,
  type IconName,
} from '@/ui';
import { isMailThreadOpen, type MailOutlet, type MailViewState } from '../../hooks/useMailView';
import { useSender } from '../../hooks/useSender';
import { MailAsideButton } from './MailAside';
import { NewMailButton } from './MailCompose';
import { MailboxNameInput } from './MailboxNameInput';
import { OVERVIEW } from '../../lib/mail';
import { Triage } from '../Triage';
import { MailInbox } from './MailInbox';

/**
 * Before the switch's snapshot: the list at its top (Cloud's page, or Sender's list scrolling in
 * itself), so the rows that flip are the ones in sight – none scrolled out above the list.
 */
function toListTop() {
  window.scrollTo(0, 0);
  document.querySelector('[data-mail-scroll]')?.scrollTo(0, 0);
}

/**
 * The mailboxes as the page's title, side by side – the open one large, the others smaller links,
 * as a workspace's views (`ViewTitles`): switching morphs the names into each other and the mail
 * list flips like a departure board (`styles/index.css`). Its own name or its default
 * (`mailboxLabels`); without a mailbox, „Post“. A double click on the open one or „Umbenennen“ on
 * any (right click) makes the name a field where it stands. Too many for a phone: the row scrolls.
 */
export function MailboxTabs({ view }: { view: MailViewState }) {
  const ui = useSender();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const accounts = view.accounts ?? [];
  const current = view.account?.id ?? '';
  useViewSwitchTop(current);
  // The others' Posteingang ahead: switched to, the list flips straight to their mails.
  const others = accounts.map((account) => account.id).join(' ');
  useEffect(() => {
    for (const id of others.split(' '))
      if (id && id !== current) prefetchMailFolder(queryClient, ui.workspace.id, id);
  }, [others, current, queryClient, ui.workspace.id]);
  if (accounts.length === 0) return <>Post</>;
  const menuFor = (id: string) => (event: MouseEvent) => {
    if (event.shiftKey) return;
    event.preventDefault();
    setMenu({ id, at: { x: event.clientX, y: event.clientY } });
  };
  const named = accounts.find((account) => account.id === menu?.id);
  return (
    // On a phone the row fades out at its end: there is more to scroll to.
    <span className="-m-1 flex min-w-0 items-baseline gap-5 overflow-x-auto p-1 [scrollbar-width:none] max-sm:pr-8 max-sm:mask-r-from-80%">
      {accounts.map((account, at) => {
        const label = view.labels.get(account.id) ?? account.address;
        // Each its own name to morph under, by its place (the order stays).
        const name = {
          viewTransitionName: `mailbox-title-${at}`,
        } satisfies CSSProperties;
        if (renaming === account.id)
          return (
            <MailboxNameInput
              key={account.id}
              account={account}
              shown={label}
              onDone={() => setRenaming(null)}
              className={cn(
                'w-auto shrink-0 field-sizing-content',
                account.id !== current && VIEW_LINK_CLASS,
              )}
            />
          );
        return account.id === current ? (
          <span
            key={account.id}
            aria-current="page"
            title={account.address}
            style={name}
            className="shrink-0 [view-transition-class:view-title]"
            onDoubleClick={() => setRenaming(account.id)}
            onContextMenu={menuFor(account.id)}
          >
            {label}
          </span>
        ) : (
          <Link
            key={account.id}
            to={view.listHref(account.id)}
            viewTransition
            onClick={() => {
              toListTop();
              startViewSwitch();
            }}
            onContextMenu={menuFor(account.id)}
            title={account.address}
            style={name}
            className={cn(
              VIEW_LINK_CLASS,
              'shrink-0 rounded-control-sm outline-none [view-transition-class:view-title] focus-visible:ring-2 focus-visible:ring-focus',
            )}
          >
            {label}
          </Link>
        );
      })}
      {menu && named && (
        <ContextMenu
          label={`Aktionen für ${view.labels.get(named.id) ?? named.address}`}
          at={menu.at}
          onClose={() => setMenu(null)}
          actions={[{ label: 'Umbenennen', icon: 'edit', onSelect: () => setRenaming(named.id) }]}
        />
      )}
    </span>
  );
}

const ROLE_ICONS: Record<MailFolderRole, IconName> = {
  inbox: 'mail',
  sent: 'send',
  archive: 'archive',
  spam: 'report',
  trash: 'delete',
};

/**
 * The open mailbox's folders: Posteingang, Gesendet, Archiv, Spam, Papierkorb as a row, one's own
 * (however many) behind „Weitere“ – so the row stays as short as it is and nothing is cut at its
 * edge. On a phone (beside „Neue Mail“) icons only, the picked one backed, its name in its
 * tooltip. Tab with nothing focused steps through all.
 */
export function MailFolderPicker({ view }: { view: MailViewState }) {
  const narrow = useMediaQuery('(max-width: 639px)');
  const { folders, folder, setFolder } = view;
  const special = folders.filter((each) => each.role);
  const own = folders.filter((each) => !each.role);
  const picked = own.find((each) => each.key === folder);
  const latest = useRef({ folders, folder, setFolder });
  useEffect(() => {
    latest.current = { folders, folder, setFolder };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const step = tabStep(event);
      const now = latest.current;
      if (!step || now.folders.length < 2) return;
      event.preventDefault();
      const at = now.folders.findIndex((each) => each.key === now.folder);
      const next = now.folders[(at + step + now.folders.length) % now.folders.length];
      if (next) now.setFolder(next.key);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  return (
    // As Cloud's filter (`ViewToolbar`): the segments in a glass pill, „Weitere“ one of them.
    // `data-mail-folders`: one piece through a mailbox switch (index.css) – it stays, or morphs.
    <GlassPanel data-mail-folders className="flex w-fit max-w-full shrink-0 items-center gap-1 p-1">
      <SegmentedControl
        label="Ordner"
        value={folder}
        onChange={setFolder}
        segments={[
          // Before the Posteingang: what is unread in this mailbox, as a to-do list.
          { value: OVERVIEW, label: 'Übersicht', icon: 'dashboard' as const, iconOnly: narrow },
          ...special.map((each) => ({
            value: each.key,
            label: each.name,
            icon: ROLE_ICONS[each.role ?? 'inbox'],
            iconOnly: narrow,
          })),
        ]}
      />
      {own.length > 0 && (
        <HeaderPopover
          label={picked ? `Ordner: ${picked.name}` : 'Weitere Ordner'}
          className="min-w-0"
          triggerClassName={cn(
            // A segment's look (`FilterChip`, md): picked backed, else bare until hover.
            'flex h-8 max-w-56 min-w-0 items-center gap-1.5 rounded-control pr-2 pl-2.5 text-body transition-colors outline-none focus-visible:ring-2 focus-visible:ring-focus aria-expanded:bg-hover',
            picked
              ? 'bg-selected font-medium text-fg'
              : 'text-fg-muted hover:bg-hover hover:text-fg',
          )}
          trigger={() => (
            <>
              <Icon name="folder" size={18} className="shrink-0" />
              <span className={cn('truncate', narrow && !picked && 'sr-only')}>
                {picked?.name ?? 'Weitere'}
              </span>
              <Icon name="expandMore" size={16} className="shrink-0" />
            </>
          )}
        >
          {(close) => (
            <div className="-m-1 flex max-h-80 flex-col overflow-y-auto p-1">
              {own.map((each) => (
                <MenuItem
                  key={each.key}
                  icon="folder"
                  selected={each.key === folder}
                  truncate
                  title={each.name}
                  onClick={() => {
                    setFolder(each.key);
                    close();
                  }}
                >
                  {each.name}
                </MenuItem>
              ))}
            </div>
          )}
        </HeaderPopover>
      )}
    </GlassPanel>
  );
}

/**
 * The row under the mailboxes: the folders, „Neue Mail“, on the right the search (⌘K; Esc in it
 * keeps the open mail) – and wide, at its
 * end, the switch for the AI beside the open mail (where the mail is the page, it is in the mail's
 * head).
 */
export function MailToolbar({ view }: { view: MailViewState }) {
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2">
      <MailFolderPicker view={view} />
      <NewMailButton className="shrink-0" />
      <ViewSearch
        label="Mails durchsuchen"
        value={view.query}
        onChange={view.setQuery}
        className="ml-auto min-w-36 shrink"
      />
      {view.wide && <MailAsideButton disabled={!isMailThreadOpen(view.threadId)} />}
    </div>
  );
}

/**
 * „Ungelesen“: only the unread mails – one press on, one off, as a comment filter. In the page's
 * head beside „Postfächer“: it holds for every mailbox and folder (`useMailView`).
 */
export function UnreadFilter({ view }: { view: MailViewState }) {
  const narrow = useMediaQuery('(max-width: 639px)');
  if (!view.account) return null;
  return (
    // Free on the page as „Postfächer“ beside it; on, it stands out as a picked choice.
    <Button
      variant="ghost"
      size="sm"
      icon="markEmailUnread"
      aria-pressed={view.unread}
      title={view.unread ? 'Nur Ungelesene – alle zeigen' : 'Nur Ungelesene zeigen'}
      className="aria-pressed:bg-selected aria-pressed:text-fg"
      onClick={() => view.setUnread(!view.unread)}
    >
      <span className={cn(narrow && 'sr-only')}>Ungelesen</span>
    </Button>
  );
}

/**
 * „Abrufen“ beside „Ungelesen“: one's mailboxes here read from their servers now (as each
 * mailbox's „Jetzt abrufen“) – the list fills as they come; the sign turns meanwhile. However
 * often they are read by themselves: Einstellungen › Mail › Abrufen.
 */
export function MailSyncButton({ view }: { view: MailViewState }) {
  const ui = useSender();
  const narrow = useMediaQuery('(max-width: 639px)');
  const sync = useSyncMailAccount(ui.workspace.id);
  const [busy, setBusy] = useState(false);
  const ready = (view.accounts ?? []).filter((each) => each.state !== 'signin');
  if (!view.account || ready.length === 0) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      title="Jetzt abrufen"
      aria-busy={busy || undefined}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void Promise.allSettled(ready.map((each) => sync.mutateAsync(each.id))).finally(() =>
          setBusy(false),
        );
      }}
      className="disabled:opacity-100"
    >
      <Icon
        name="sync"
        size={18}
        className={cn(busy && 'animate-spin motion-reduce:animate-none')}
      />
      <span className={cn(narrow && 'sr-only')}>Abrufen</span>
    </Button>
  );
}

/**
 * Wide: ↑/↓ and j/k step through the list and open the next or previous mail (while the focus is
 * in the list, or on nothing with a mail open). Never while typing, with a menu or dialog open,
 * nor over „Neue Mail“. (Esc closes the open mail: `MailThreadView`, also where it is the page.)
 */
function useMailKeys(view: MailViewState, listRef: RefObject<HTMLElement | null>) {
  const navigate = useNavigate();
  const stepped = useRef(false);
  // Where the last key went, until it is open: keys pressed quickly (held ↓) go on from there.
  const aimed = useRef<string | null>(null);
  const latest = useRef(view);
  useEffect(() => {
    latest.current = view;
  });
  const { wide, threadId } = view;
  useEffect(() => {
    if (!wide) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTextTarget(event.target)) return;
      if (document.querySelector('dialog[open], [role="menu"]')) return;
      const now = latest.current;
      // „Neue Mail“ open: the keys open no mail over the form (`isMailThreadOpen`, as its switch).
      if (now.threadId && !isMailThreadOpen(now.threadId)) return;
      const step =
        event.key === 'ArrowDown' || event.key === 'j'
          ? 1
          : event.key === 'ArrowUp' || event.key === 'k'
            ? -1
            : 0;
      const list = listRef.current;
      if (!step || !list) return;
      const target = event.target as Node;
      if (!list.contains(target) && !(now.threadId && target === document.body)) return;
      const rows = [...list.querySelectorAll<HTMLElement>('[data-mail-thread]')];
      const ids = rows.map((row) => row.dataset.mailThread ?? '');
      if (ids.length === 0) return;
      event.preventDefault();
      const from = ids.indexOf(
        aimed.current ??
          now.threadId ??
          (document.activeElement as HTMLElement | null)?.dataset.mailThread ??
          '',
      );
      const next = ids[from < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, from + step))];
      if (!next || next === (aimed.current ?? now.threadId)) return;
      stepped.current = true;
      aimed.current = next;
      void navigate(now.threadHref(next), { replace: !!now.threadId });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [wide, navigate, listRef]);
  // The open one in sight in the list – and focused, where the keys took it there.
  useLayoutEffect(() => {
    if (!threadId || threadId === aimed.current) aimed.current = null;
    if (!threadId) return;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-mail-thread="${CSS.escape(threadId)}"]`,
    );
    row?.scrollIntoView({ block: 'nearest' });
    if (stepped.current) row?.focus({ preventScroll: true });
    stepped.current = false;
  }, [threadId, listRef]);
}

/** „Vergrößern“ on an open mail: remembered in this browser, for the next one too. */
const EXPANDED_KEY = 'slider.mail.expanded';
/** The list's width beside an open mail as one pulls it, kept in this browser. */
const LIST_WIDTH_KEY = 'slider.mail.listWidth';
const LIST_WIDTH = 396;
const LIST_MIN = 280;
/** What the open mail keeps at least when the list is pulled wide. */
const MAIL_MIN = 480;

/**
 * Under the folders: the list – and wide, with a mail open, the same list narrower on the left
 * and the mail beside it in the page (the conversation route, `Outlet`), a handle between them (as
 * beside an agent's chat); „Vergrößern“ there gives the mail the whole width, the list hidden.
 * The list scrolls in itself in both apps – the same list, its rows rolling away at the top as a
 * chat's messages do.
 */
export function MailBody({ view }: { view: MailViewState }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpandedState] = useState(() => readString(EXPANDED_KEY) === '1');
  const [listWidth, setListWidth] = useKeptWidth(LIST_WIDTH_KEY);
  useMailKeys(view, listRef);
  // One tree whether a mail is open or not: the list stays the same element (its scroll, its
  // place – no shift as a mail opens), only narrowing to its width; the mail comes in beside it.
  const open = !!view.threadId && view.wide;
  const pane: MailOutlet = {
    split: true,
    expanded,
    setExpanded: (next) => {
      setExpandedState(next);
      writeString(EXPANDED_KEY, next ? '1' : null);
    },
  };
  return (
    <div className="flex min-h-0 flex-1">
      {!(open && expanded) && (
        <>
          <div
            ref={listRef}
            data-mail-scroll
            style={
              open
                ? { width: listWidth ?? LIST_WIDTH, maxWidth: `calc(100% - ${MAIL_MIN}px)` }
                : undefined
            }
            // As high as the page leaves in both apps: an empty state stands in the middle of it.
            // The rows bleed 8px out (`RowList`): as much padding, so nothing scrolls sideways.
            // Rows leave at the top as a chat's messages do (`roll-away`), never cut off – up to
            // the toolbar: the list reaches into the 20px above it (`-mt-5`), as the chat.
            className={cn(
              'roll-away-list -mx-2 -mt-5 flex min-h-0 flex-col overflow-y-auto overscroll-contain px-2 pt-5 pb-6 [--roll-scale:0.8] [&_li]:roll-away',
              open ? 'shrink-0' : 'min-w-0 flex-1',
            )}
          >
            {view.folder === OVERVIEW && !view.query.trim() ? (
              <Triage
                key={view.account?.id}
                mailbox={view.account?.id}
                mailHref={view.threadHref}
              />
            ) : (
              <MailInbox view={view} />
            )}
          </div>
          {open && (
            <BarHandle
              axis="x"
              before
              label="Breite der Mail-Liste"
              target={listRef}
              min={LIST_MIN}
              max={() =>
                Math.max(LIST_MIN, (listRef.current?.parentElement?.clientWidth ?? 0) - MAIL_MIN)
              }
              onSize={setListWidth}
              onReset={() => setListWidth(null)}
            />
          )}
        </>
      )}
      {open && (
        // Its own: Cloud's page would start a selection box where text is being selected. Comes
        // in from the right as it opens; another mail opened in it changes in place.
        <div
          // `data-mail-pane`: on a switch of mailbox it goes at once (`styles/index.css`).
          data-mail-pane
          // No padding of its own below: the page's already keeps the reply field where a chat's is.
          className="flex min-h-0 min-w-0 flex-1 animate-pane-in flex-col motion-reduce:animate-none"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <Outlet context={pane} />
        </div>
      )}
    </div>
  );
}
