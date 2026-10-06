import type { Deck } from '@slider/shared';

/**
 * Notifications derived on the client from the deck list (G2).
 *
 * This is a stop-gap: without an event feed we can only tell *that* a deck changed since the
 * last visit, not *what* happened (mentions, resolved threads, new versions). A real
 * notifications endpoint is planned in BER-124 / BER-120; swap `deriveNotifications` for it then.
 */
export type NotificationKind = 'feedback' | 'imported' | 'import_failed';

export interface DeckNotification {
  id: string;
  kind: NotificationKind;
  deck: Deck;
  /** ISO timestamp of the change. */
  at: string;
  unread: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Changes this long after creation are treated as review activity rather than the import itself. */
const IMPORT_WINDOW_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 14 * DAY_MS;
const MAX_ITEMS = 20;

function kindOf(deck: Deck): NotificationKind | null {
  if (deck.import.status === 'failed') return 'import_failed';
  if (deck.import.status !== 'ready') return null;
  const sinceCreation = Date.parse(deck.updatedAt) - Date.parse(deck.createdAt);
  return sinceCreation < IMPORT_WINDOW_MS ? 'imported' : 'feedback';
}

export function deriveNotifications(
  decks: readonly Deck[],
  isUnseen: (deck: Deck) => boolean,
  now: number = Date.now(),
): DeckNotification[] {
  return decks
    .filter((deck) => deck.archivedAt === null && now - Date.parse(deck.updatedAt) < MAX_AGE_MS)
    .flatMap((deck) => {
      const kind = kindOf(deck);
      return kind
        ? [
            {
              id: `${deck.id}:${deck.updatedAt}`,
              kind,
              deck,
              at: deck.updatedAt,
              unread: isUnseen(deck),
            },
          ]
        : [];
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, MAX_ITEMS);
}

export function notificationTitle({ kind, deck }: DeckNotification): string {
  switch (kind) {
    case 'feedback':
      return `Neues Feedback in „${deck.title}“`;
    case 'imported':
      return `Import abgeschlossen: „${deck.title}“`;
    case 'import_failed':
      return `Import fehlgeschlagen: „${deck.title}“`;
  }
}

/** Splits notifications into "Heute" and "Früher" (calendar day, local time). */
export function groupByDay(items: readonly DeckNotification[], now: Date = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return {
    today: items.filter((item) => Date.parse(item.at) >= startOfToday),
    earlier: items.filter((item) => Date.parse(item.at) < startOfToday),
  };
}
