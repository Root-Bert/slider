import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  API_PREFIX,
  mailThreadKind,
  type MailAttachment,
  type MailMessage,
  type MailThread,
  type SenderMessage,
} from '@slider/shared';
import {
  isPendingMail,
  useAskMailContext,
  useDeleteMailThread,
  useDraftMailReply,
  useMailInsights,
  useMailSpam,
  useMailThread,
  useMailAddressBook,
  useReadMailThread,
  useUnreadMailThread,
  useReplyMail,
  useSendMailAgain,
  useSummarizeMail,
  useTakeBackMail,
  type MailRecipients,
} from '@/lib/api';
import { isTextTarget } from '@/lib/dom';
import { draftFor, draftKeys, hasWords, setDraft, useDrafts, type DraftTarget } from '@/lib/drafts';
import { formatDateTime, formatFileSize } from '@/lib/format';
import {
  Avatar,
  AvatarStack,
  cn,
  ConfirmDialog,
  ContextMenu,
  EmptyState,
  Icon,
  IconButton,
  Menu,
  Toggle,
  type MenuAction,
} from '@/ui';
import { GIVE_WAY_TO_PANEL, useAgentAside } from '@/features/cloud';
import { useMailListLook } from '../../hooks/useMailListLook';
import { useMailUploads } from '../../hooks/useMailUploads';
import { usePinAction } from '../../hooks/usePinAction';
import { useMailAside, useMailPane } from '../../hooks/useMailView';
import { useSender } from '../../hooks/useSender';
import {
  mailAuthor,
  mailGroupName,
  mailName,
  NEW_MAIL,
  splitQuoted,
  unverifiedMail,
} from '../../lib/mail';
import { MAIL_ADDRESS, whenItGoes } from '../../lib/mail-address';
import { forwardedText, forwardSubject, mailPersonLine } from '../../lib/mail-forward';
import { PAGE_HEADER, PAGE_TITLE } from '../../lib/title';
import { Composer } from '../Composer';
import { MenuButton } from '../MenuButton';
import { MessageList } from '../MessageList';
import { MailAside, MailAsideButton } from './MailAside';
import { LinkedText } from '../LinkedText';
import { MailAvatar } from './MailAvatar';
import { MailHtml } from './MailHtml';
import { MailOutboxLine } from './MailOutboxLine';
import { MailUploads } from './MailUploads';
import { ReplyRecipients } from './ReplyRecipients';

const mailDay = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });
const mailTime = new Intl.DateTimeFormat('de-DE', { timeStyle: 'short' });
const UNVERIFIED = 'Nicht bestätigt, dass diese Mail vom Absender kommt.';
/** The AI's column beside the mail; from this width of the mail's body both stand side by side. */
const ASIDE_WIDTH = 320;
const ASIDE_BESIDE = 700;

/** Who wrote a mail – as the colleague the conversation knows only where their domain signed it. */
const signedPerson = (thread: MailThread, message: MailMessage) => ({
  ...message.from,
  userId:
    message.auth === 'pass'
      ? thread.people.find((each) => each.address === message.from.address)?.userId
      : null,
});

const attachmentHref = (threadId: string, attachment: MailAttachment, download = false) =>
  `${API_PREFIX}/mail/threads/${threadId}/attachments/${attachment.id}${download ? '?download=1' : ''}`;

/** A mail's attachments: each opens in a tab of its own, as a file would. */
function Attachments({
  threadId,
  attachments,
}: {
  threadId: string;
  attachments: MailAttachment[];
}) {
  if (attachments.length === 0) return null;
  return (
    <ul aria-label="Anhänge" className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <a
            href={attachmentHref(threadId, attachment)}
            target="_blank"
            rel="noopener noreferrer"
            title={attachment.name}
            className="flex h-8 max-w-64 items-center gap-1.5 rounded-control bg-surface-1 pr-2.5 pl-2 text-xs text-fg ring-hairline transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
          >
            <Icon name="attachFile" size={16} className="shrink-0 text-fg-muted" />
            <span className="min-w-0 truncate font-medium">{attachment.name}</span>
            <span className="shrink-0 text-fg-subtle">{formatFileSize(attachment.size)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * A mail's words, what it quotes folded away until asked for. Long links and words break anywhere
 * (`break-word` would leave them as wide as they are: the card overflowed sideways).
 */
function MailText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const { fresh, quoted } = splitQuoted(text);
  return (
    <div className="flex flex-col items-start gap-1">
      <p className="w-full text-body leading-[1.5] whitespace-pre-wrap text-fg select-text [overflow-wrap:anywhere]">
        <LinkedText text={fresh || quoted} />
      </p>
      {fresh && quoted && (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="rounded-chip px-1 text-xs text-fg-muted hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
          >
            {open ? 'Zitat ausblenden' : 'Zitat zeigen'}
          </button>
          {open && (
            <p className="w-full border-l-2 border-hairline-strong pl-3 text-caption whitespace-pre-wrap text-fg-muted select-text [overflow-wrap:anywhere]">
              <LinkedText text={quoted} />
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Only people from outside on it: each mail as a mail – who, to whom, when, its words, its files. */
function MailCards({
  thread,
  reply,
  onTakeBack,
  onSendAgain,
  actionsFor,
  keys,
}: {
  thread: MailThread;
  reply: ReactNode;
  /** A mail of one's own still in the outbox: back into the field. */
  onTakeBack: (message: MailMessage) => void;
  onSendAgain: (message: MailMessage) => void;
  /** A mail's menu at the pointer (right click): answer it, all on it, pass it on. */
  actionsFor: (message: MailMessage) => MenuAction[];
  /** Keys as in mail apps – R answers, A all, F passes on (not while typing). */
  keys: Partial<Record<'r' | 'a' | 'f', () => void>>;
}) {
  const ui = useSender();
  const [menu, setMenu] = useState<{ message: MailMessage; at: { x: number; y: number } } | null>(
    null,
  );
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.shiftKey || isTextTarget(event.target)) return;
      if (document.querySelector('dialog[open], [role="menu"]')) return;
      const run = keys[event.key.toLowerCase() as 'r' | 'a' | 'f'];
      if (!run) return;
      event.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keys]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLDivElement>(null);
  // The reply's height at its smallest (one line): the frame keeps the rest of the column, so a
  // reply that grows never takes room from the mail – it stands under it, the column scrolls.
  const [replyBase, setReplyBase] = useState<number | null>(null);
  const last = thread.messages.at(-1);
  useLayoutEffect(() => {
    const column = columnRef.current;
    const reply = replyRef.current;
    if (!column || !reply) return;
    let base = Infinity;
    let was = 0;
    const observer = new ResizeObserver(() => {
      const height = reply.offsetHeight;
      if (height < base) {
        base = height;
        setReplyBase(height);
      }
      // Writing, the words stay in sight as the field grows under the mail.
      if (height > was && reply.contains(document.activeElement)) {
        column.scrollTop = column.scrollHeight;
      }
      was = height;
    });
    observer.observe(reply);
    return () => observer.disconnect();
  }, [thread.id]);
  // Read from the top as a mail is: one mail opens at its start, a long thread at the start of
  // its latest mail (not its end), and goes there when one comes or is sent. Sheets above it that
  // grow once measured keep it there – until one scrolls oneself.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const list = listRef.current;
    if (!scroller || !list) return;
    const toLatest = () => {
      const latest = list.lastElementChild;
      if (!latest) return;
      scroller.scrollTop +=
        latest.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    };
    toLatest();
    const observer = new ResizeObserver(toLatest);
    observer.observe(list);
    const own = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    const release = () => {
      observer.disconnect();
      for (const type of own) scroller.removeEventListener(type, release);
    };
    for (const type of own) scroller.addEventListener(type, release, { passive: true });
    return release;
  }, [thread.id, thread.messages.length, last?.id]);
  // The mail and the reply under it scroll as one: down, the mail to its end, then on to the reply;
  // up, back to the whole mail, then up it – the reply's first line under the frame all along.
  useEffect(() => {
    const column = columnRef.current;
    const inner = scrollRef.current;
    if (!column || !inner) return;
    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey) return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? column.clientHeight
            : 1;
      const delta = event.deltaY * unit;
      if (delta === 0) return;
      const room = (element: Element) =>
        delta > 0
          ? element.scrollHeight - element.clientHeight - element.scrollTop
          : element.scrollTop;
      // Something under the pointer that scrolls itself this way (a long field, a list): its own.
      for (
        let node = event.target instanceof Element ? event.target : null;
        node && node !== inner && node !== column;
        node = node.parentElement
      ) {
        if (/auto|scroll/.test(getComputedStyle(node).overflowY) && room(node) >= 1) return;
      }
      const [first, second] = delta > 0 ? [inner, column] : [column, inner];
      if (room(first) + room(second) < 1) return;
      event.preventDefault();
      const step = Math.sign(delta) * Math.min(Math.abs(delta), Math.max(0, room(first)));
      first.scrollTop += step;
      second.scrollTop += delta - step;
    };
    column.addEventListener('wheel', onWheel, { passive: false });
    return () => column.removeEventListener('wheel', onWheel);
  }, [thread.id]);
  const nameOf = (message: MailMessage) => (message.outgoing ? ui.me.name : mailName(message.from));
  // One frame that stands still – round, its one edge drawn over what is in it (not under it as
  // `glass` draws it: twice as dark over the sender as over a sheet) – and the mails scroll
  // inside it, parted by a line; nothing is cut or redrawn as one scrolls. The latest mail fills
  // the rest of the frame, a mail's own sheet (its HTML) to the frame's edges and foot. The reply
  // stands under the frame: one line beside it in the column, grown under it (the column scrolls).
  return (
    <div
      ref={columnRef}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain"
    >
      <div
        // As tall as the column less the one-line reply and the gap (12px) – until measured, the rest.
        style={replyBase === null ? undefined : { height: `calc(100% - ${replyBase + 12}px)` }}
        className={cn(
          'glass relative flex shrink-0 flex-col overflow-hidden rounded-panel shadow-none! after:pointer-events-none after:absolute after:inset-0 after:z-10 after:rounded-panel after:ring-hairline',
          replyBase === null && 'min-h-0 flex-1',
        )}
      >
        <div
          ref={scrollRef}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
        >
          <ol aria-label="Mails" ref={listRef} className="flex grow flex-col">
            {thread.messages.map((message, index) => {
              const to = [...message.to, ...message.cc, ...(message.bcc ?? [])].map(mailName);
              return (
                <li
                  key={message.id}
                  onContextMenu={(event) => {
                    if (event.shiftKey || isPendingMail(message)) return;
                    // Words picked in it: the browser's own menu, to copy them.
                    const picked = window.getSelection();
                    if (picked && !picked.isCollapsed) return;
                    event.preventDefault();
                    setMenu({ message, at: { x: event.clientX, y: event.clientY } });
                  }}
                  className={cn(
                    'flex flex-col gap-3 p-4',
                    index > 0 && 'border-t border-hairline',
                    message === last && 'grow',
                    message.html && 'pb-0',
                    isPendingMail(message) && 'opacity-60',
                  )}
                >
                  <div className="flex items-start gap-3">
                    {message.outgoing ? (
                      <Avatar author={ui.me} size={32} nativeTitle={false} />
                    ) : (
                      <MailAvatar
                        person={signedPerson(thread, message)}
                        vouched={message.auth === 'pass'}
                        size={32}
                        nativeTitle={false}
                      />
                    )}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate text-sm font-semibold text-fg">
                          {nameOf(message)}
                        </span>
                        {!message.outgoing && (
                          <span className="truncate text-xs text-fg-subtle">
                            {message.from.address}
                          </span>
                        )}
                      </span>
                      {to.length > 0 && (
                        <span className="truncate text-xs text-fg-muted" title={to.join(', ')}>
                          an {to.join(', ')}
                        </span>
                      )}
                      {message.outbox && (
                        <MailOutboxLine
                          outbox={message.outbox}
                          onTakeBack={() => onTakeBack(message)}
                          onSendAgain={() => onSendAgain(message)}
                        />
                      )}
                    </div>
                    {unverifiedMail(message, thread) && (
                      <span title={UNVERIFIED}>
                        <Icon name="report" size={16} className="mt-0.5 text-danger" />
                      </span>
                    )}
                    {/* The day over its time, as the name over its address beside it. */}
                    <time
                      dateTime={message.sentAt}
                      title={formatDateTime(message.sentAt)}
                      className="flex shrink-0 flex-col items-end text-xs text-fg-subtle tabular-nums"
                    >
                      {isPendingMail(message) ? (
                        'Wird gesendet …'
                      ) : message.outbox ? null : (
                        <>
                          <span>{mailDay.format(new Date(message.sentAt))}</span>
                          <span>{mailTime.format(new Date(message.sentAt))}</span>
                        </>
                      )}
                    </time>
                  </div>
                  {message.html ? (
                    // Its sheet to the frame's left and right edge – attachments above it.
                    <>
                      {message.attachments.length > 0 && (
                        <div className="-mt-2 min-w-0">
                          <Attachments threadId={thread.id} attachments={message.attachments} />
                        </div>
                      )}
                      <div className="-mx-4 flex min-w-0 grow flex-col">
                        <MailHtml threadId={thread.id} message={message} />
                      </div>
                    </>
                  ) : (
                    // The words from the left edge, flush with the picture above them.
                    <div className="min-w-0">
                      <MailText text={message.text} />
                      <Attachments threadId={thread.id} attachments={message.attachments} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {menu && (
            <ContextMenu
              label={`Aktionen für die Mail von ${nameOf(menu.message)}`}
              actions={actionsFor(menu.message)}
              at={menu.at}
              onClose={() => setMenu(null)}
            />
          )}
        </div>
      </div>
      <div ref={replyRef} data-mail-reply className="flex shrink-0 flex-col gap-2">
        {reply}
      </div>
    </div>
  );
}

/** Colleagues only: its mails as a group chat's messages. */
function MailChat({ thread }: { thread: MailThread }) {
  const ui = useSender();
  const home = ui.home;
  const byId = new Map(thread.messages.map((message) => [message.id, message]));
  const messages = useMemo<SenderMessage[]>(
    () =>
      thread.messages.map((message, index) => {
        // Shown as the colleague only where this very mail was signed by their domain.
        const known =
          message.auth === 'pass'
            ? thread.people.find((each) => each.address === message.from.address)
            : undefined;
        const from = { address: message.from.address, name: message.from.name };
        return {
          id: message.id,
          seq: index + 1,
          author: message.outgoing ? ui.me : mailAuthor(known ?? from, home?.people ?? []),
          agent: null,
          text: splitQuoted(message.text).fresh || message.text,
          createdAt: message.sentAt,
          editedAt: null,
          deleted: false,
        };
      }),
    [thread.messages, thread.people, ui.me, home],
  );
  return (
    <MessageList
      conversationId={`mail:${thread.id}`}
      messages={messages}
      readSeq={messages.length}
      me={ui.me}
      people={home?.people ?? []}
      editing={null}
      older={{ more: false, loading: false, load: () => {} }}
      intro={
        <p className="px-3 pt-6 pb-4 text-body text-fg-muted">
          Eine Mail mit Leuten von außerhalb. Was du hier schreibst, geht als Mail an alle darauf.
        </p>
      }
      readOnly
      onEditing={() => {}}
      onSave={() => {}}
      onDelete={() => {}}
      below={(message) => {
        const mail = byId.get(message.id);
        return (
          <>
            {mail && unverifiedMail(mail, thread) && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-danger">
                <Icon name="report" size={14} className="shrink-0" />
                {UNVERIFIED} ({mail.from.address})
              </p>
            )}
            <Attachments threadId={thread.id} attachments={mail?.attachments ?? []} />
          </>
        );
      }}
    />
  );
}

/**
 * A mail conversation: colleagues only, as a group chat; anyone from outside on it (colleagues
 * with them or not), as mail. Answered below (to everyone on it, or its sender), what the AI makes of
 * it beside it. Opened, it is read.
 */
export function MailThreadView({ threadId }: { threadId: string }) {
  const ui = useSender();
  const navigate = useNavigate();
  // Beside the list the focus stays there, so ↑/↓ go on to the next mail.
  const pane = useMailPane();
  const split = pane?.split ?? false;
  // The list's mailbox and folder (`?postfach=&ordner=`), kept when it closes.
  const { search } = useLocation();
  const workspaceId = ui.workspace.id;
  const query = useMailThread(workspaceId, threadId);
  const thread = query.data;
  const read = useReadMailThread(workspaceId);
  const spam = useMailSpam(workspaceId);
  const unreadAgain = useUnreadMailThread(workspaceId);
  const remove = useDeleteMailThread(workspaceId);
  const own = thread
    ? { address: thread.account.address, name: ui.me.name }
    : { address: '', name: '' };
  const reply = useReplyMail(workspaceId, threadId, own);
  const takeBack = useTakeBackMail(workspaceId);
  const draftReply = useDraftMailReply(threadId);
  const sendAgain = useSendMailAgain(workspaceId);
  const assess = useAskMailContext(workspaceId, threadId);
  const summarize = useSummarizeMail(workspaceId, threadId);
  // Only what the panel asked already (not fetched for the menu).
  const insights = useMailInsights(workspaceId, threadId, false);
  const [look] = useMailListLook();
  const [deleting, setDeleting] = useState(false);
  const [all, setAll] = useState(true);
  // Whom the reply goes to, once set by hand (else as „Allen antworten“ picks) – and its fields open.
  const [custom, setCustom] = useState<MailRecipients | null>(null);
  const [recipientsOpen, setRecipientsOpen] = useState(false);
  const book = useMailAddressBook(workspaceId, recipientsOpen);
  const pinAction = usePinAction(workspaceId, ui.notify);
  // Passing a mail on over a new mail already begun: asked first, this goes on once yes.
  const [replacing, setReplacing] = useState<(() => void) | null>(null);
  // Files put on the reply: kept with its draft (on every device), up before it goes.
  const replyKey = draftKeys.mail(threadId);
  const replyDraft = useDrafts()[replyKey];
  const uploads = (replyDraft?.target?.kind === 'mail' && replyDraft.target.uploads) || [];
  const files = useMailUploads({
    accountId: thread?.account.id ?? '',
    uploads,
    onChange: (next) => {
      const target = draftFor(replyKey)?.target;
      if (target?.kind === 'mail')
        setDraft(replyKey, draftFor(replyKey)?.text ?? '', { ...target, uploads: next });
      else if (thread)
        setDraft(replyKey, draftFor(replyKey)?.text ?? '', {
          kind: 'mail',
          workspaceId,
          threadId: thread.id,
          name: thread.subject,
          uploads: next,
        });
    },
    notify: ui.notify,
  });
  // Files dragged over the mail: put on the reply where they are let go.
  const [dropping, setDropping] = useState(false);
  // A refused answer comes back into the field: the field starts anew with it as its draft.
  const [round, setRound] = useState(0);

  // The AI beside the mail (`MailAside`), with a handle as beside an agent's chat – where both do
  // not fit side by side, over the mail.
  const [asideOpen, setAsideOpen] = useMailAside();
  const asideRef = useRef<HTMLDivElement>(null);
  const [bodyWidth, setBodyWidth] = useState(0);
  const watched = useRef<ResizeObserver | null>(null);
  const bodyRef = useCallback((element: HTMLDivElement | null) => {
    watched.current?.disconnect();
    watched.current = null;
    if (!element) return;
    setBodyWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBodyWidth(entry.contentRect.width);
    });
    observer.observe(element);
    watched.current = observer;
  }, []);
  const beside = bodyWidth >= ASIDE_BESIDE;
  const aside = useAgentAside(beside, ASIDE_WIDTH, asideRef, {
    key: 'slider.mail.asideWidth',
    label: 'Größe von Mail und KI',
    // The mail's card has its own edge: no extra room before the handle, as after it.
    even: true,
  });
  const covers = asideOpen && !beside;
  // A panel of Cloud's (`data-cloud-panel`, 400 + 12 from the edge) lies over the column beside
  // (`data-page-aside`, `CloudLayout`): the mail gives way as far as it reaches past column and
  // handle (32), plus the 12px every page keeps beside a panel.
  const asideRoom =
    asideOpen && beside
      ? ({
          '--aside-room': `${(typeof aside.style?.width === 'number' ? aside.style.width : ASIDE_WIDTH) + 32}px`,
        } as CSSProperties)
      : undefined;

  // Esc closes it, back to the list – beside the list and where it is the page; the AI over it first.
  const closeHref = `${ui.mailPath}${search}`;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (isTextTarget(event.target)) return;
      if (document.querySelector('dialog[open], [role="menu"]')) return;
      event.preventDefault();
      if (covers) setAsideOpen(false);
      else void navigate(closeHref);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, closeHref, covers, setAsideOpen]);

  const count = thread?.messages.length ?? 0;
  const { mutate: markRead } = read;
  useEffect(() => {
    if (count > 0) markRead(threadId);
  }, [threadId, count, markRead]);

  // „Empfänger“ opened: the fields grow the reply under the mail – the column follows, the
  // whole reply (its fields and the field written in) in sight, not pushed below the edge.
  useEffect(() => {
    if (!recipientsOpen) return;
    const frame = requestAnimationFrame(() =>
      document.querySelector('[data-mail-reply]')?.scrollIntoView({ block: 'nearest' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [recipientsOpen]);

  if (query.isError && !thread) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <MenuButton />
        <div className="m-auto">
          <EmptyState title="Mail nicht gefunden" message="Es gibt sie hier nicht mehr." />
        </div>
      </div>
    );
  }
  if (!thread) return null;

  const group = mailThreadKind(thread.people) === 'group';
  const lastIn = thread.messages.findLast((message) => !message.outgoing);
  const sender = lastIn?.from ?? thread.people[0];
  // More than its sender on the last mail: answering all is a choice (a group chat: always).
  const others = lastIn
    ? [...lastIn.to, ...lastIn.cc].filter(
        (one) => one.address !== thread.account.address.toLowerCase(),
      )
    : [];
  const toAll = group || (others.length > 0 && all);
  const self = thread.account.address.toLowerCase();
  // As the server picks them: the last mail's sender (one's own last mail: whom it went to), and
  // with „Allen antworten“ everyone else on it in Cc.
  const lastOut = thread.messages.findLast((message) => message.outgoing);
  const picked: MailRecipients = (() => {
    const to = lastIn ? [lastIn.from.address] : (lastOut?.to ?? []).map((one) => one.address);
    const cc = toAll
      ? others.map((one) => one.address).filter((address) => !to.includes(address))
      : [];
    return { to, cc, bcc: [] };
  })();
  const recipients = custom ?? picked;
  // Back to whom „Allen antworten“ picks; or set by hand.
  const pick = () => setCustom(null);
  const setRecipients = setCustom;
  // The names the conversation knows its addresses by – for the chips.
  const names = new Map<string, string>();
  for (const message of thread.messages)
    for (const one of [message.from, ...message.to, ...message.cc])
      if (one.name && one.address !== self) names.set(one.address.toLowerCase(), one.name);
  const conversationId = draftKeys.mail(thread.id);
  const fail = (error: Error) => ui.notify(error.message, 'danger');
  // Taken back out of the outbox: its words into the field (before what stands there), whom it
  // went to into the fields.
  const restore = (messageId: string) =>
    takeBack.mutate(
      { threadId, messageId },
      {
        onSuccess: (taken) => {
          const there = draftFor(conversationId)?.text.trim();
          const kept = draftFor(conversationId)?.target;
          setDraft(conversationId, there ? `${taken.text}\n\n${there}` : taken.text, {
            ...draftTarget,
            uploads: [...(kept?.kind === 'mail' ? (kept.uploads ?? []) : []), ...taken.uploads],
          });
          if (!group) {
            setRecipients({ to: taken.to, cc: taken.cc, bcc: taken.bcc });
            if (taken.bcc.length > 0) setRecipientsOpen(true);
          }
          setRound((now) => now + 1);
          ui.notify('Zurück im Entwurf');
        },
        onError: fail,
      },
    );
  // The field, written into at once (its words in sight).
  const focusReply = () =>
    requestAnimationFrame(() => {
      const field = document.querySelector<HTMLTextAreaElement>('[data-mail-reply] textarea');
      field?.focus();
      field?.scrollIntoView({ block: 'nearest' });
    });
  /** Everyone else on a mail: whom it went to, less its sender and oneself. */
  const othersOn = (message: MailMessage) =>
    [...message.to, ...message.cc]
      .map((one) => one.address.toLowerCase())
      .filter((address) => address !== self && address !== message.from.address.toLowerCase());
  // Answering one mail: its sender (one's own: whom it went to), all on it in Cc – the latest
  // one's as „Allen antworten“ picks.
  const replyTo = (message: MailMessage, toEveryone: boolean) => {
    if (message === lastIn) {
      setAll(toEveryone);
      pick();
    } else {
      const to = message.outgoing ? message.to.map((one) => one.address) : [message.from.address];
      const cc = toEveryone ? othersOn(message).filter((address) => !to.includes(address)) : [];
      setRecipients({ to, cc, bcc: [] });
    }
    focusReply();
  };
  // Passed on: a new mail from this mailbox with its words (and its attachments along).
  const forwardMail = (message: MailMessage) => {
    const key = draftKeys.newMail(workspaceId);
    const go = () => {
      setDraft(
        key,
        forwardedText(message, message.outgoing ? ui.me.name : mailPersonLine(message.from)),
        {
          kind: 'mail-new',
          workspaceId,
          accountId: thread.account.id,
          to: '',
          cc: '',
          bcc: '',
          subject: forwardSubject(message.subject || thread.subject),
          forward:
            message.attachments.length > 0 ? { threadId: thread.id, messageId: message.id } : null,
        },
      );
      void navigate(`${ui.mailThreadPath(NEW_MAIL)}${search}`);
    };
    if (hasWords(draftFor(key))) setReplacing(() => go);
    else go();
  };
  const actionsFor = (message: MailMessage): MenuAction[] =>
    isPendingMail(message)
      ? []
      : [
          ...(group
            ? []
            : [
                {
                  label: 'Antworten',
                  icon: 'reply' as const,
                  onSelect: () => replyTo(message, false),
                },
                ...(othersOn(message).length > 0
                  ? [
                      {
                        label: 'Allen antworten',
                        icon: 'replyAll' as const,
                        onSelect: () => replyTo(message, true),
                      },
                    ]
                  : []),
              ]),
          { label: 'Weiterleiten', icon: 'forward', onSelect: () => forwardMail(message) },
        ];
  // The menu's and the keys' mail: the latest that came in, else the latest.
  const latestMail = lastIn ?? thread.messages.at(-1);
  const send = (text: string) => {
    const chosen = recipients;
    if (!group) {
      const wrong = [...chosen.to, ...chosen.cc, ...chosen.bcc].find(
        (one) => !MAIL_ADDRESS.test(one),
      );
      const refusal =
        chosen.to.length === 0
          ? 'Gib an, an wen sie geht.'
          : wrong
            ? `„${wrong}“ ist keine E-Mail-Adresse.`
            : null;
      if (refusal) {
        setDraft(conversationId, text, draftTarget);
        setRound((now) => now + 1);
        setRecipientsOpen(true);
        ui.notify(refusal, 'danger');
        return;
      }
    }
    const delay = look.delay;
    const sentFiles = uploads;
    // Off the field with the words – back if it does not go.
    if (sentFiles.length > 0) setDraft(conversationId, '', { ...draftTarget, uploads: [] });
    const input = group
      ? { text, all: true, delay, uploads: sentFiles }
      : { text, all: toAll, ...chosen, delay, uploads: sentFiles };
    reply.mutate(input, {
      onSuccess: (message) => {
        pick();
        setRecipientsOpen(false);
        if (message.outbox?.state === 'queued')
          ui.notify(
            `Im Postausgang – geht ${whenItGoes(message.outbox.at, Date.now())} raus`,
            'neutral',
            { label: 'Rückgängig', run: () => restore(message.id) },
          );
      },
      onError: (error) => {
        setDraft(conversationId, text, draftTarget);
        setRound((now) => now + 1);
        ui.notify(`Nicht gesendet: ${error.message}`, 'danger');
      },
    });
  };
  const title = group ? mailGroupName(thread) : thread.subject;
  // In „Entwürfe“ by the conversation's name, as its title here.
  const draftTarget: Extract<DraftTarget, { kind: 'mail' }> = {
    kind: 'mail',
    workspaceId,
    threadId: thread.id,
    name: title,
    uploads,
  };
  // Bullets were made for it (the AI reads this mailbox): made again with the rest.
  const summarized = insights.data?.summary.state === 'ready';
  const actions: MenuAction[] = [
    ...(latestMail ? actionsFor(latestMail) : []),
    pinAction('mail', thread.id, thread.pinnedAt),
    // New again, as a mail program does it: it closes (open, it would be read at once), its row
    // bold in the list.
    {
      label: 'Als ungelesen markieren',
      icon: 'markEmailUnread',
      onSelect: () => {
        unreadAgain.mutate(threadId, { onError: fail });
        void navigate(closeHref);
      },
    },
    // What the AI made of it, made again – beside the mail (opened), its spark breathing meanwhile.
    ...(!group && (thread.context || summarized)
      ? [
          {
            label: 'Neu einschätzen',
            icon: 'autoAwesome' as const,
            onSelect: () => {
              setAsideOpen(true);
              assess.mutate(undefined, { onError: fail });
              if (summarized) summarize.mutate(true, { onError: fail });
            },
          },
        ]
      : []),
    thread.spam
      ? {
          label: 'Kein Spam',
          icon: 'mail',
          onSelect: () =>
            spam.mutate(
              { threadId, spam: false },
              { onSuccess: () => ui.notify('Zurück im Posteingang'), onError: fail },
            ),
        }
      : {
          label: 'Als Spam markieren',
          icon: 'report',
          onSelect: () =>
            spam.mutate(
              { threadId, spam: true },
              { onSuccess: () => ui.notify('Als Spam markiert'), onError: fail },
            ),
        },
    { label: 'Löschen', icon: 'delete', tone: 'danger', onSelect: () => setDeleting(true) },
  ];
  const peopleAuthors = thread.people.map((each) => mailAuthor(each, ui.home?.people ?? []));
  const composer = (
    <Composer
      key={`${conversationId}:${round}`}
      conversationId={conversationId}
      target={draftTarget}
      placeholder={
        group || !sender
          ? 'Antwort an alle'
          : recipients.to.length + recipients.cc.length > 1
            ? 'Antwort an alle'
            : `Antwort an ${mailName(sender)}`
      }
      people={[]}
      onSend={send}
      focusOnOpen={!split}
      // A mail's reply grows with its words under the mail (`MailCards`); a group's keeps its cap.
      maxHeight={group ? undefined : Infinity}
      // Under the mail in its column (which cuts what sticks out): no shadow to be cut.
      flat={!group}
      // Letters are the mail's keys here (R, A, F; j/k in the list).
      typeInto={false}
      // A mail goes out on ⌘↵ (as a new one), Enter breaks the line.
      sendKey="mod-enter"
      onFiles={(picked) => {
        files.add(picked);
        focusReply();
      }}
      // The AI writes the reply – from the notes typed (⌘Z gives them back), or anew.
      assist={
        thread.ai && !group
          ? async (notes, put) => {
              try {
                const { text } = await draftReply.mutateAsync(notes);
                put(text);
              } catch (error) {
                fail(error as Error);
              }
            }
          : undefined
      }
    />
  );

  return (
    <section
      aria-label={title}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDropping(false);
        files.add([...event.dataTransfer.files]);
        focusReply();
      }}
      className="@container flex min-h-0 flex-1 flex-col gap-3"
    >
      {/* Over the column too: under a panel lying over it it gives way all the way. */}
      <header className={cn(PAGE_HEADER, GIVE_WAY_TO_PANEL)}>
        <MenuButton />
        {/* The subject alone over mails: who wrote stands once, at each mail (`MailCards`). */}
        {group && (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-chip bg-surface-2 text-fg-muted">
            <Icon name="groups" size={18} />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className={PAGE_TITLE}>{title}</h1>
        </div>
        {thread.spam && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-danger">
            <Icon name="report" size={16} />
            Spam
          </span>
        )}
        {group && peopleAuthors.length > 0 && (
          <AvatarStack authors={peopleAuthors} max={4} size={24} interactive />
        )}
        {/* Where the mail is the page: the AI's switch here (beside the list: in the folders' row). */}
        {!pane && <MailAsideButton bare />}
        <Menu label={`Aktionen für „${title}“`} actions={actions} triggerVariant="subtle" />
        {/* Beside the list: the whole width for the mail, or back beside the list. */}
        {pane && (
          <IconButton
            icon={pane.expanded ? 'closeFullscreen' : 'openInFull'}
            label={pane.expanded ? 'Verkleinern' : 'Vergrößern'}
            size="sm"
            active={pane.expanded}
            onClick={() => pane.setExpanded(!pane.expanded)}
          />
        )}
        <IconButton
          icon="close"
          label="Schließen"
          title="Schließen (Esc)"
          size="sm"
          onClick={() => void navigate(closeHref)}
        />
      </header>
      <div ref={bodyRef} className={cn('relative flex min-h-0 flex-1', !aside.handle && 'gap-5')}>
        <div
          inert={covers}
          style={asideRoom}
          className={cn(
            'relative flex min-h-0 min-w-0 flex-1 flex-col gap-3 transition-[margin] duration-300 ease-out',
            covers && 'invisible',
            asideRoom &&
              '[body:has([data-cloud-panel])_&]:mr-[max(0px,calc(400px_-_var(--aside-room)))]',
          )}
        >
          {dropping && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-panel border-2 border-dashed border-primary bg-surface/80 text-body font-semibold text-fg">
              <span className="flex items-center gap-2">
                <Icon name="attachFile" size={18} />
                Zum Anhängen loslassen
              </span>
            </div>
          )}
          {/* The AI's warning (phishing, spam) stands over the mail while its panel is closed. */}
          {!asideOpen && thread.context?.warning && (
            <p className="flex shrink-0 items-start gap-2 text-body text-danger">
              <Icon name="report" size={16} className="mt-0.5 shrink-0" />
              <span>{thread.context.warning}</span>
            </p>
          )}
          {group ? (
            <>
              <MailChat thread={thread} />
              <MailUploads uploads={uploads} pending={files.pending} onRemove={files.remove} />
              {composer}
            </>
          ) : (
            <MailCards
              thread={thread}
              actionsFor={actionsFor}
              keys={
                latestMail
                  ? {
                      r: () => replyTo(latestMail, false),
                      a: () => replyTo(latestMail, othersOn(latestMail).length > 0),
                      f: () => forwardMail(latestMail),
                    }
                  : {}
              }
              onTakeBack={(message) => restore(message.id)}
              onSendAgain={(message) =>
                sendAgain.mutate(
                  { threadId, messageId: message.id },
                  {
                    onSuccess: () => ui.notify('Mail gesendet'),
                    onError: (error) => ui.notify(`Nicht gesendet: ${error.message}`, 'danger'),
                  },
                )
              }
              reply={
                <>
                  <ReplyRecipients
                    recipients={recipients}
                    onChange={setRecipients}
                    open={recipientsOpen}
                    onOpenChange={setRecipientsOpen}
                    names={names}
                    book={book.data}
                    aside={
                      others.length > 0 && (
                        <Toggle
                          size="sm"
                          checked={all}
                          onChange={(next) => {
                            setAll(next);
                            // The choice anew: whom it picks, not what was set by hand.
                            pick();
                          }}
                          label={`Allen antworten (${others.length + 1})`}
                        />
                      )
                    }
                  />
                  <MailUploads
                    uploads={uploads}
                    pending={files.pending}
                    onRemove={files.remove}
                    className="px-1"
                  />
                  {composer}
                </>
              }
            />
          )}
        </div>
        {asideOpen && (
          <>
            {aside.handle}
            <div
              ref={asideRef}
              data-page-aside={beside || undefined}
              style={aside.style}
              className={cn(
                'flex min-h-0 flex-col',
                beside ? 'w-[320px] shrink-0' : 'absolute inset-0 z-10',
              )}
            >
              <MailAside
                key={thread.id}
                thread={thread}
                workspaceId={workspaceId}
                notify={ui.notify}
              />
            </div>
          </>
        )}
      </div>
      {replacing && (
        <ConfirmDialog
          title="Neue Mail ersetzen?"
          description="Du hast schon eine neue Mail angefangen. Die Weiterleitung tritt an ihre Stelle."
          confirmLabel="Ersetzen"
          onClose={() => setReplacing(null)}
          onConfirm={() => {
            setReplacing(null);
            replacing();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Mail löschen?"
          description="Sie verschwindet hier. Im Postfach auf dem Mail-Server bleibt sie."
          confirmLabel="Löschen"
          onClose={() => setDeleting(false)}
          onConfirm={() => {
            setDeleting(false);
            remove.mutate(threadId, {
              onSuccess: () => ui.notify('Mail gelöscht'),
              onError: fail,
            });
            void navigate(closeHref, { replace: true });
          }}
        />
      )}
    </section>
  );
}
