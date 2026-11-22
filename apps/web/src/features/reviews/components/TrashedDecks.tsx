import { useState } from 'react';
import { DECK_TRASH_DAYS, searchFold, type Deck } from '@slider/shared';
import { formatRelativeTime } from '@/lib/format';
import { useRestoreDeck, useTrashedDecks } from '@/lib/api';
import { Badge, ContextMenu, Menu, type MenuAction, type ShowToast } from '@/ui';
import { useDeckContextMenu } from '../hooks/useDeckContextMenu';
import { DeleteDeckDialog } from './DeleteDeckDialog';
import { SlideThumbnail } from './SlideThumbnail';

const DAY_MS = 86_400_000;

/** Rows, or tiles as Cloud's files (its grid). */
type TrashView = 'list' | 'tiles';

const TILE_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(188px,1fr))] gap-x-4 gap-y-6';

/** Days a deleted presentation still lies in the trash, at least one. */
function trashDaysLeft(deck: Deck, now = Date.now()): number {
  const since = deck.deletedAt ? Date.parse(deck.deletedAt) : now;
  return Math.max(1, Math.ceil((since + DECK_TRASH_DAYS * DAY_MS - now) / DAY_MS));
}

function TrashedDeckItem({
  deck,
  onNotify,
  view,
}: {
  deck: Deck;
  onNotify: ShowToast;
  view: TrashView;
}) {
  const [purging, setPurging] = useState(false);
  const menu = useDeckContextMenu();
  const restore = useRestoreDeck();
  const daysLeft = trashDaysLeft(deck);
  const actions: MenuAction[] = [
    {
      label: 'Wiederherstellen',
      icon: 'history',
      onSelect: () =>
        restore.mutate(deck.id, {
          onSuccess: () => onNotify(`„${deck.title}“ wiederhergestellt`),
          onError: (error) => onNotify(error.message, 'danger'),
        }),
    },
    {
      label: 'Endgültig löschen',
      icon: 'deleteForever',
      tone: 'danger',
      onSelect: () => setPurging(true),
    },
  ];
  const label = `Aktionen für „${deck.title}“`;
  const soon = daysLeft <= 3 && <Badge tone="warning">bald weg</Badge>;
  const deleted = `Gelöscht ${deck.deletedAt ? formatRelativeTime(deck.deletedAt) : ''}`;
  const stays = `Bleibt ${daysLeft} ${daysLeft === 1 ? 'Tag' : 'Tage'}`;
  const dialogs = (
    <>
      {menu.contextAt && (
        <ContextMenu
          label={label}
          actions={actions}
          at={menu.contextAt}
          onClose={menu.onContextClose}
        />
      )}
      {purging && (
        <DeleteDeckDialog
          decks={[deck]}
          forGood
          onClose={() => setPurging(false)}
          onDeleted={() => {
            setPurging(false);
            onNotify(`„${deck.title}“ gelöscht`);
          }}
        />
      )}
    </>
  );
  if (view === 'tiles') {
    // As a file's tile in Cloud (`FileTile`): the picture, under it the name and what is known.
    return (
      <li className="group relative flex flex-col gap-2.5" onContextMenu={menu.onContextMenu}>
        <div className="relative overflow-hidden rounded-panel bg-surface-1 ring-hairline">
          <SlideThumbnail src={deck.thumbnailUrl} />
          <Menu
            label={label}
            actions={actions}
            className="absolute top-1.5 right-1.5 rounded-control-sm bg-scrim opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 has-[:focus-visible]:opacity-100 has-[[aria-expanded=true]]:opacity-100 pointer-coarse:opacity-100"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-body font-medium text-fg">{deck.title}</h3>
            {soon}
          </span>
          <span className="truncate text-xs text-fg-muted">
            {deleted} | {stays}
          </span>
        </div>
        {dialogs}
      </li>
    );
  }
  return (
    <li
      className="flex items-center gap-4 rounded-control-sm px-3 py-2.5 transition-colors hover:bg-surface-1"
      onContextMenu={menu.onContextMenu}
    >
      <div className="w-24 shrink-0">
        <SlideThumbnail src={deck.thumbnailUrl} className="rounded-badge" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-medium text-fg">{deck.title}</h3>
          {soon}
        </span>
        <span className="truncate text-xs text-fg-subtle">{deleted}</span>
      </div>
      <span className="shrink-0 text-sm text-fg-subtle tabular-nums max-sm:hidden">{stays}</span>
      <Menu label={label} actions={actions} className="shrink-0" />
      {dialogs}
    </li>
  );
}

/**
 * The deleted presentations of a workspace one may bring back – Slider's „Papierkorb“, and a part
 * of Cloud's „Gelöscht“. Renders nothing while there are none; `empty` says so instead.
 */
export function TrashedDecks({
  workspaceId,
  onNotify,
  heading,
  empty,
  query = '',
  order,
  view = 'list',
}: {
  workspaceId: string;
  onNotify: ShowToast;
  /** Above the list, where it is one part of a page. */
  heading?: string;
  empty?: React.ReactNode;
  /** What the page's search field says: only the names with it in them. */
  query?: string;
  /** The page's sort; without one, as the server lists them. */
  order?: (a: Deck, b: Deck) => number;
  view?: TrashView;
}) {
  const trash = useTrashedDecks(workspaceId);
  const needle = searchFold(query.trim());
  const found = (trash.data ?? []).filter((deck) => searchFold(deck.title).includes(needle));
  const decks = order ? found.sort(order) : found;
  if (decks.length === 0) return trash.isPending ? null : (empty ?? null);
  return (
    <section aria-label={heading ?? 'Papierkorb'} className="flex flex-col gap-2">
      {heading && <h2 className="px-3 text-caption text-fg-subtle">{heading}</h2>}
      <ul className={view === 'tiles' ? TILE_GRID : 'flex flex-col'}>
        {decks.map((deck) => (
          <TrashedDeckItem key={deck.id} deck={deck} onNotify={onNotify} view={view} />
        ))}
      </ul>
    </section>
  );
}
