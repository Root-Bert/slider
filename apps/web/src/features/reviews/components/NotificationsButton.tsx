import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Deck } from '@slider/shared';
import { routes } from '@/app/routes';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { Badge, cn, Icon, SegmentedControl, type IconName } from '@/ui';
import { useDismiss } from '@/ui';
import { markDeckVisited, markDecksVisited } from '../lib/last-visits';
import {
  deriveNotifications,
  groupByDay,
  notificationTitle,
  type DeckNotification,
  type NotificationKind,
} from '../lib/notifications';

type Filter = 'all' | 'unread';

/** Bell with unread dot and the notifications popover (G2). */
export function NotificationsButton({
  decks,
  isUnseen,
}: {
  decks: readonly Deck[];
  isUnseen: (deck: Deck) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const notifications = deriveNotifications(decks, isUnseen);
  const unreadCount = notifications.filter((item) => item.unread).length;

  useDismiss({
    open,
    onDismiss: () => setOpen(false),
    refs: [wrapperRef],
    returnFocusTo: triggerRef,
  });

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={
          unreadCount > 0 ? `Benachrichtigungen, ${unreadCount} ungelesen` : 'Benachrichtigungen'
        }
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="glass relative inline-flex size-8 items-center justify-center rounded-full text-fg-muted transition-colors hover:text-fg"
      >
        <Icon name="notifications" size={18} />
        {unreadCount > 0 && (
          <span
            className="absolute top-0.5 right-0.5 size-2 rounded-full bg-danger ring-2 ring-canvas"
            aria-hidden
          />
        )}
      </button>
      {open && (
        <NotificationsPopover
          id={popoverId}
          notifications={notifications}
          unreadCount={unreadCount}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

interface NotificationsPopoverProps {
  id: string;
  notifications: readonly DeckNotification[];
  unreadCount: number;
  onClose: () => void;
}

function NotificationsPopover({
  id,
  notifications,
  unreadCount,
  onClose,
}: NotificationsPopoverProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const navigate = useNavigate();
  const headingId = useId();
  const visible = filter === 'unread' ? notifications.filter((item) => item.unread) : notifications;
  const { today, earlier } = groupByDay(visible);

  const openDeck = (item: DeckNotification) => {
    markDeckVisited(item.deck.id);
    onClose();
    void navigate(routes.deck(item.deck.id));
  };

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="glass-elevated absolute top-full right-0 z-30 mt-2 flex w-[min(380px,calc(100vw-32px))] animate-pop-in flex-col rounded-panel"
    >
      <header className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <h2 id={headingId} className="text-sm font-semibold text-fg">
          Benachrichtigungen
        </h2>
        <SegmentedControl<Filter>
          label="Benachrichtigungen filtern"
          value={filter}
          onChange={setFilter}
          segments={[
            { value: 'all', label: 'Alle' },
            { value: 'unread', label: 'Ungelesen', count: unreadCount },
          ]}
        />
      </header>

      <div className="max-h-[min(480px,60vh)] overflow-y-auto px-2 pb-2">
        {visible.length === 0 ? (
          <p className="px-2 py-8 text-center text-[13px] text-fg-subtle">
            {filter === 'unread'
              ? 'Du bist auf dem neuesten Stand.'
              : 'Noch keine Benachrichtigungen.'}
          </p>
        ) : (
          <>
            <NotificationGroup title="Heute" items={today} onOpen={openDeck} />
            <NotificationGroup title="Früher" items={earlier} onOpen={openDeck} />
          </>
        )}
      </div>

      <footer className="flex items-center justify-between border-t border-hairline px-4 py-3">
        <button
          type="button"
          disabled={unreadCount === 0}
          onClick={() =>
            markDecksVisited(
              notifications.filter((item) => item.unread).map((item) => item.deck.id),
            )
          }
          className="text-[13px] text-fg-muted hover:text-fg disabled:opacity-40"
        >
          Alle als gelesen markieren
        </button>
      </footer>
    </section>
  );
}

function NotificationGroup({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: readonly DeckNotification[];
  onOpen: (item: DeckNotification) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="px-2 pt-2 pb-1 text-xs text-fg-subtle">{title}</h3>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id}>
            <NotificationItem item={item} onOpen={() => onOpen(item)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

const KIND_ICONS: Record<NotificationKind, IconName> = {
  feedback: 'chatBubble',
  imported: 'sync',
  import_failed: 'error',
};

function NotificationItem({ item, onOpen }: { item: DeckNotification; onOpen: () => void }) {
  const { deck, kind } = item;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full items-start gap-3 rounded-control p-2.5 text-left transition-colors hover:bg-white/10',
        item.unread && 'bg-white/5',
      )}
    >
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10',
          kind === 'import_failed' ? 'text-danger' : 'text-fg-muted',
        )}
      >
        <Icon name={KIND_ICONS[kind]} size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[13px] text-fg">{notificationTitle(item)}</span>
        {kind === 'feedback' && deck.openCommentCount > 0 && (
          <Badge tone="info" className="self-start">
            {deck.openCommentCount} offen
          </Badge>
        )}
        {kind === 'import_failed' && deck.import.status === 'failed' && (
          <span className="line-clamp-2 text-xs text-fg-subtle">{deck.import.error}</span>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-2">
        <time dateTime={item.at} title={formatDateTime(item.at)} className="text-xs text-fg-subtle">
          {formatRelativeTime(item.at)}
        </time>
        {item.unread && (
          <span className="size-1.5 rounded-full bg-danger">
            <span className="sr-only">ungelesen</span>
          </span>
        )}
      </span>
    </button>
  );
}
