import { Link } from 'react-router';
import type { Deck } from '@slider/shared';
import { routes } from '@/app/routes';
import { AvatarStack, cn, Icon } from '@/ui';
import type { ShowToast } from '@/ui';
import { isImporting } from '../lib/deck-labels';
import { markDeckVisited } from '../lib/last-visits';
import { usePinnedDecks } from '../lib/pinned-decks';
import { useDeckContextMenu } from '../hooks/useDeckContextMenu';
import { DeckActions } from './DeckActions';
import {
  DeckMeta,
  DeckStatusBadge,
  ImportOverlay,
  OpenCommentsChip,
  RendererChip,
  SlideCountChip,
} from './DeckBits';
import { SlideThumbnail } from './SlideThumbnail';

/** Marks a deck pinned to the top of the list. */
function PinnedMark({ deckId }: { deckId: string }) {
  if (!usePinnedDecks().isPinned(deckId)) return null;
  return (
    <Icon
      name="pushPin"
      size={14}
      className="shrink-0 rotate-45 text-fg-subtle"
      label="Angepinnt"
    />
  );
}

export interface DeckItemProps {
  deck: Deck;
  unseen: boolean;
  onNotify: ShowToast;
}

/**
 * Grid card (G1). The title link is stretched over the whole card, so the card is one click
 * target while the ⋯ menu stays a separate, non-nested control.
 */
export function DeckCard({ deck, unseen, onNotify }: DeckItemProps) {
  const { onContextMenu, ...contextMenu } = useDeckContextMenu();
  return (
    <article className="group relative flex min-w-0 flex-col gap-3" onContextMenu={onContextMenu}>
      <div className="relative">
        <SlideThumbnail
          src={deck.thumbnailUrl}
          pending={isImporting(deck)}
          className={cn(
            'rounded-control-sm ring-2 ring-transparent transition-shadow',
            'group-hover:ring-fg group-has-[a:focus-visible]:ring-mention',
          )}
        >
          {deck.slideCount > 0 && (
            <RendererChip renderer={deck.thumbnailRenderer} officeFailure={deck.officeFailure} />
          )}
          {deck.slideCount > 0 && <SlideCountChip count={deck.slideCount} />}
          <ImportOverlay deck={deck} />
        </SlideThumbnail>
        <div className="absolute top-2 right-2 z-10">
          <DeckActions
            deck={deck}
            onNotify={onNotify}
            {...contextMenu}
            triggerClassName={cn(
              'glass opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100',
              'pointer-coarse:opacity-100',
            )}
          />
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <PinnedMark deckId={deck.id} />
          <h3 className="mr-auto truncate pr-1.5 text-[15px] font-medium text-fg">
            <Link
              to={routes.deck(deck.id)}
              onClick={() => markDeckVisited(deck.id)}
              className="outline-none group-hover:underline group-hover:underline-offset-2 after:absolute after:inset-0 after:content-['']"
            >
              {deck.title}
            </Link>
          </h3>
          <DeckStatusBadge deck={deck} unseen={unseen} />
        </div>
        <DeckMeta deck={deck} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <OpenCommentsChip count={deck.openCommentCount} />
        <AvatarStack authors={deck.participants} max={3} size={24} />
      </div>
    </article>
  );
}

/** Compact list-view row with the same information as the card. */
export function DeckRow({ deck, unseen, onNotify }: DeckItemProps) {
  const { onContextMenu, ...contextMenu } = useDeckContextMenu();
  return (
    <article
      onContextMenu={onContextMenu}
      className={cn(
        'group relative flex items-center gap-4 rounded-control-sm px-3 py-2.5 transition-colors',
        'hover:bg-white/5 has-[a:focus-visible]:bg-white/5 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-mention',
      )}
    >
      <SlideThumbnail
        src={deck.thumbnailUrl}
        pending={isImporting(deck)}
        className="w-24 shrink-0 rounded-badge"
      >
        <ImportOverlay deck={deck} compact />
      </SlideThumbnail>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <PinnedMark deckId={deck.id} />
          <h3 className="truncate text-sm font-medium text-fg">
            <Link
              to={routes.deck(deck.id)}
              onClick={() => markDeckVisited(deck.id)}
              className="outline-none group-hover:underline group-hover:underline-offset-2 after:absolute after:inset-0 after:content-['']"
            >
              {deck.title}
            </Link>
          </h3>
          <DeckStatusBadge deck={deck} unseen={unseen} />
        </div>
        <DeckMeta deck={deck} />
      </div>

      <div className="hidden shrink-0 items-center gap-4 sm:flex">
        <OpenCommentsChip count={deck.openCommentCount} />
        <AvatarStack authors={deck.participants} max={3} size={24} className="w-20 justify-end" />
      </div>
      <DeckActions deck={deck} onNotify={onNotify} {...contextMenu} className="z-10 shrink-0" />
    </article>
  );
}
