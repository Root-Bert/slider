import { useState } from 'react';
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
import { DeckTitleInput } from './DeckTitleInput';
import { DeckStatusBadge, ImportOverlay, NewChip, OriginChips, SlideCountChip } from './DeckBits';
import { OpenCommentsButton } from './OpenComments';
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

/** The comments button and avatars: own controls, so hovering them leaves the deck itself alone. */
function DeckFooter({
  deck,
  placement,
  commentsSlot,
  className,
}: {
  deck: Deck;
  placement: 'card' | 'above';
  commentsSlot?: HTMLElement | null;
  className?: string;
}) {
  const large = placement === 'card';
  return (
    <div data-deck-footer className={cn('flex items-center gap-3', className)}>
      <OpenCommentsButton
        deck={deck}
        placement={placement}
        size={large ? 'md' : 'sm'}
        cardSlot={commentsSlot}
      />
      <AvatarStack
        authors={deck.participants}
        max={3}
        size={large ? 28 : 24}
        interactive
        // Positioned, so it sits above the card's stretched title link.
        className={cn(large && 'relative')}
      />
    </div>
  );
}

/**
 * Grid card (G1). The title link is stretched over the whole card, so thumbnail and title are
 * one click target while the footer controls (comments, avatars) in the title row stay separate,
 * non-nested controls on top of it. Deck actions open on a right click only.
 */
export function DeckCard({ deck, unseen, onNotify }: DeckItemProps) {
  const { onContextMenu, ...contextMenu } = useDeckContextMenu();
  const [commentsSlot, setCommentsSlot] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  return (
    <article
      // Positioned for the stretched link and the comments list floating in the thumbnail;
      // lifted above the neighbours while open.
      className="group relative flex min-w-0 flex-col gap-3 has-[[aria-expanded=true]]:z-30"
      onContextMenu={onContextMenu}
    >
      <div className="relative">
        <SlideThumbnail
          src={deck.thumbnailUrl}
          pending={isImporting(deck)}
          glow
          // Same trigger as the frame, so hovering the footer controls leaves the halo alone too.
          glowClassName={cn(
            'group-[:hover:not(:has([data-deck-footer]:hover))]:scale-105 group-[:hover:not(:has([data-deck-footer]:hover))]:opacity-60',
            'group-has-[a:focus-visible]:opacity-60',
          )}
          className={cn(
            'rounded-control-sm ring-2 ring-transparent transition-[box-shadow,scale] duration-300',
            // Hovering the footer controls must not light up the card.
            'group-[:hover:not(:has([data-deck-footer]:hover))]:scale-[0.97] group-[:hover:not(:has([data-deck-footer]:hover))]:ring-fg',
            'group-has-[a:focus-visible]:ring-mention',
          )}
        >
          <NewChip deck={deck} unseen={unseen} />
          {deck.slideCount > 0 && <SlideCountChip count={deck.slideCount} />}
          <ImportOverlay deck={deck} />
        </SlideThumbnail>
        <OriginChips
          deck={deck}
          className="transition-[scale] duration-300 group-[:hover:not(:has([data-deck-footer]:hover))]:scale-[0.97]"
        />
        <DeckActions
          deck={deck}
          onNotify={onNotify}
          {...contextMenu}
          onRename={() => setRenaming(true)}
          hideTrigger
        />
        {/* The open comments list lands here, over the thumbnail; counted as footer, so hovering
            it leaves the card alone. */}
        <div ref={setCommentsSlot} data-deck-footer />
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <PinnedMark deckId={deck.id} />
        <h3 className={cn('text-lg font-medium text-fg', renaming ? 'min-w-0 flex-1' : 'truncate')}>
          {renaming ? (
            <DeckTitleInput deck={deck} onDone={() => setRenaming(false)} onNotify={onNotify} />
          ) : (
            <Link
              to={routes.deck(deck.id)}
              onClick={() => markDeckVisited(deck.id)}
              className="outline-none transition-colors duration-200 group-[:hover:not(:has([data-deck-footer]:hover))]:text-white after:absolute after:inset-0 after:content-['']"
            >
              {deck.title}
            </Link>
          )}
        </h3>
        {/* "Neu" sits on the thumbnail instead. */}
        <DeckStatusBadge deck={deck} unseen={false} />
        <DeckFooter
          deck={deck}
          placement="card"
          commentsSlot={commentsSlot}
          className="ml-auto shrink-0 pl-1.5"
        />
      </div>
    </article>
  );
}

/** Compact list-view row with the same information as the card. */
export function DeckRow({ deck, unseen, onNotify }: DeckItemProps) {
  const { onContextMenu, ...contextMenu } = useDeckContextMenu();
  const [renaming, setRenaming] = useState(false);
  return (
    <article
      onContextMenu={onContextMenu}
      className={cn(
        'group relative flex items-center gap-4 rounded-control-sm px-3 py-2.5 transition-colors',
        // Hovering the footer controls must not light up the whole row.
        '[&:hover:not(:has([data-deck-footer]:hover))]:bg-white/5',
        'has-[a:focus-visible]:bg-white/5 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-mention',
      )}
    >
      <div className="relative w-24 shrink-0">
        <SlideThumbnail
          src={deck.thumbnailUrl}
          pending={isImporting(deck)}
          className="rounded-badge"
        >
          <ImportOverlay deck={deck} compact />
        </SlideThumbnail>
        <OriginChips deck={deck} compact />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <PinnedMark deckId={deck.id} />
          <h3 className={cn('text-sm font-medium text-fg', renaming ? 'min-w-0 flex-1' : 'truncate')}>
            {renaming ? (
              <DeckTitleInput deck={deck} onDone={() => setRenaming(false)} onNotify={onNotify} />
            ) : (
              <Link
                to={routes.deck(deck.id)}
                onClick={() => markDeckVisited(deck.id)}
                className="outline-none transition-colors duration-200 group-[:hover:not(:has([data-deck-footer]:hover))]:text-white after:absolute after:inset-0 after:content-['']"
              >
                {deck.title}
              </Link>
            )}
          </h3>
          <DeckStatusBadge deck={deck} unseen={unseen} />
        </div>
      </div>

      <DeckFooter
        deck={deck}
        placement="above"
        // Above the stretched title link; an open list covers the rows above it.
        className="relative z-10 hidden shrink-0 gap-4 has-[[aria-expanded=true]]:z-30 sm:flex"
      />
      <DeckActions
        deck={deck}
        onNotify={onNotify}
        {...contextMenu}
        onRename={() => setRenaming(true)}
        className="z-10 shrink-0"
      />
    </article>
  );
}
