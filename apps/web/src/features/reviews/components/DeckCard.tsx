import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { Deck, DeckSearchResult } from '@slider/shared';
import { routes } from '@/lib/routes';
import { AvatarStack, cn, Icon, Tooltip, type ShowToast } from '@/ui';
import { isImporting } from '@/lib/deck-labels';
import { usePinnedDecks } from '../hooks/usePinnedDecks';
import { useDeckContextMenu } from '../hooks/useDeckContextMenu';
import { DeckActions } from './DeckActions';
import { DeckTitleInput } from './DeckTitleInput';
import { DeckStatusBadge, ImportOverlay, OriginChips, SlideCountChip } from './DeckBits';
import { OpenCommentsButton } from './OpenComments';
import { SearchHit } from './SearchHit';
import { SlideThumbnail } from './SlideThumbnail';

/**
 * Renaming in place: the title link turns into an input. Ended with Enter or Escape, the focus
 * goes back to the title link – the input it was on is gone, and it would drop to <body>.
 */
function useInPlaceRename() {
  const [renaming, setRenaming] = useState(false);
  const titleRef = useRef<HTMLAnchorElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (renaming || !refocus.current) return;
    refocus.current = false;
    titleRef.current?.focus();
  }, [renaming]);
  return {
    renaming,
    titleRef,
    startRename: () => setRenaming(true),
    endRename: (hadFocus: boolean) => {
      refocus.current = hadFocus;
      setRenaming(false);
    },
  };
}

/** Marks a deck pinned to the top of the list. */
function PinnedMark({ deck }: { deck: Deck }) {
  if (!usePinnedDecks(deck.workspaceId).isPinned(deck.id)) return null;
  return (
    <Icon
      name="pushPin"
      size={14}
      className="shrink-0 rotate-45 text-fg-subtle"
      label="Angepinnt"
    />
  );
}

/**
 * Marks a review only selected people may open ("Zugriff einschränken …"). Above the stretched
 * title link, so its tooltip shows on hover.
 */
function RestrictedMark({ deck }: { deck: Deck }) {
  if (!deck.restricted) return null;
  const label = 'Zugriff eingeschränkt';
  return (
    <Tooltip
      label={label}
      decorative
      align="start"
      maxWidth="none"
      className="relative z-(--z-raised) shrink-0"
    >
      <Icon name="lock" size={14} className="text-fg-subtle" label={label} />
    </Tooltip>
  );
}

export interface DeckItemProps {
  deck: Deck;
  /** Part of the multi-selection in "Reviews". */
  selected?: boolean;
  onNotify: ShowToast;
  /** Where its text matched the search (BER-175): shown under the title, opened at its slide. */
  searchHit?: DeckSearchResult;
}

/** The deck's link: at the slide of its first search hit, if it has one. */
const deckLink = (deck: Deck, searchHit: DeckSearchResult | undefined) =>
  routes.deck(deck.id, searchHit?.hits[0]?.slideId);

/** Tick in the thumbnail corner of a selected deck. */
function SelectedMark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={cn(
        'absolute z-(--z-raised) flex items-center justify-center rounded-full bg-(--selection) text-(--on-selection) shadow-mark',
        compact ? 'top-1 left-1 size-4' : 'top-2 left-2 size-6',
      )}
    >
      <Icon name="check" size={compact ? 12 : 16} label="Ausgewählt" />
    </span>
  );
}

/**
 * The comments button and avatars: own controls above the stretched title link, so hovering
 * them leaves the deck itself alone.
 */
function DeckFooter({
  deck,
  placement,
  panelSlot,
  onNotify,
  className,
}: {
  deck: Deck;
  placement: 'card' | 'row';
  onNotify: ShowToast;
  /** Where the open comments list goes: the card's thumbnail or the area under the row. */
  panelSlot: HTMLElement | null;
  className?: string;
}) {
  const large = placement === 'card';
  const avatars = (
    <AvatarStack
      authors={deck.participants}
      max={3}
      size={large ? 28 : 24}
      interactive
      // Positioned, so it sits above the card's stretched title link.
      className={cn(large && 'relative')}
    />
  );
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <OpenCommentsButton
        deck={deck}
        placement={placement}
        size={large ? 'md' : 'sm'}
        slot={panelSlot}
        onNotify={onNotify}
      />
      {large ? (
        avatars
      ) : (
        // Room for three avatars plus "+n" (24 + 3 × 16px), so every list row's comments button
        // lines up in one column however many people took part.
        <span className="flex w-18">{avatars}</span>
      )}
    </div>
  );
}

/**
 * Grid card (G1). The title link is stretched over the whole card, so thumbnail and title are
 * one click target while the footer controls (comments, avatars) in the title row stay separate,
 * non-nested controls on top of it. The hover look follows the pointer on that link (and the
 * origin chips, part of the thumbnail) only: the
 * footer controls and an open panel over the thumbnail (comments, storage) lie on top of it, so
 * hovering them leaves the card alone – no open state to track. Deck actions open from the ⋯ button in the thumbnail corner
 * (shown on hover, focus and touch screens) or a right click.
 */
export function DeckCard({ deck, selected = false, onNotify, searchHit }: DeckItemProps) {
  const { onContextMenu, ...contextMenu } = useDeckContextMenu();
  const [panelSlot, setPanelSlot] = useState<HTMLElement | null>(null);
  const { renaming, startRename, endRename, titleRef } = useInPlaceRename();
  return (
    <article
      // Positioned for the stretched link and the panels floating in the thumbnail;
      // lifted above the neighbours while open.
      className="group relative flex min-w-0 flex-col gap-3 has-[[aria-expanded=true]]:z-(--z-chrome)"
      onContextMenu={onContextMenu}
    >
      <div className="relative">
        <SlideThumbnail
          src={deck.thumbnailUrl}
          pending={isImporting(deck)}
          glow
          // Same trigger as the frame.
          glowClassName="group-has-[[data-deck-hover]:hover]:scale-105 group-has-[[data-deck-hover]:hover]:opacity-60 group-has-[a:focus-visible]:opacity-60"
          className={cn(
            'rounded-panel ring-2 ring-transparent transition-[box-shadow,scale] duration-300',
            'group-has-[[data-deck-hover]:hover]:scale-[0.97] group-has-[[data-deck-hover]:hover]:ring-fg',
            'group-has-[a:focus-visible]:ring-mention',
            selected && 'scale-[0.97] ring-(--selection)!',
          )}
        >
          {selected && <SelectedMark />}
          {deck.slideCount > 0 && <SlideCountChip count={deck.slideCount} />}
          <ImportOverlay deck={deck} />
        </SlideThumbnail>
        <OriginChips
          deck={deck}
          className="transition-[scale] duration-300 group-has-[[data-deck-hover]:hover]:scale-[0.97]"
        />
        <DeckActions
          deck={deck}
          onNotify={onNotify}
          {...contextMenu}
          onRename={startRename}
          hideTrigger
          panelSlot={{ element: panelSlot, kind: 'thumbnail' }}
        />
        {/* The open comments list and the storage overview land here, over the thumbnail. */}
        <div ref={setPanelSlot} />
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <PinnedMark deck={deck} />
        <RestrictedMark deck={deck} />
        <h3 className={cn('text-lg font-medium text-fg', renaming ? 'min-w-0 flex-1' : 'truncate')}>
          {renaming ? (
            <DeckTitleInput deck={deck} onDone={endRename} onNotify={onNotify} />
          ) : (
            <Link
              ref={titleRef}
              to={deckLink(deck, searchHit)}
              data-deck-hover
              className="outline-none transition-colors duration-200 after:absolute after:inset-0 after:content-[''] hover:text-primary-hover"
            >
              {deck.title}
            </Link>
          )}
        </h3>
        <DeckStatusBadge deck={deck} />
        <DeckFooter
          deck={deck}
          placement="card"
          panelSlot={panelSlot}
          onNotify={onNotify}
          className="ml-auto shrink-0 pl-1.5"
        />
      </div>
      {searchHit && <SearchHit result={searchHit} className="-mt-1.5 line-clamp-2" />}
    </article>
  );
}

/**
 * Compact list-view row with the same information as the card. The open comments list and the
 * storage overview open in an area under the row, which expands.
 */
export function DeckRow({ deck, selected = false, onNotify, searchHit }: DeckItemProps) {
  const { onContextMenu, ...contextMenu } = useDeckContextMenu();
  const [panelSlot, setPanelSlot] = useState<HTMLElement | null>(null);
  const { renaming, startRename, endRename, titleRef } = useInPlaceRename();
  return (
    <article
      onContextMenu={onContextMenu}
      className={cn(
        'group relative flex flex-col rounded-control-sm px-3 py-2.5 transition-colors',
        // Only the stretched title link lights up the row – not the controls on top of it.
        'has-[[data-deck-hover]:hover]:bg-surface-1',
        'has-[a:focus-visible]:bg-surface-1 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-mention',
        selected && 'bg-(--selection)/15! ring-1 ring-(--selection)/60',
      )}
    >
      <div className="flex items-center gap-4">
        <div className="relative w-24 shrink-0">
          <SlideThumbnail
            src={deck.thumbnailUrl}
            pending={isImporting(deck)}
            className="rounded-badge"
          >
            {selected && <SelectedMark compact />}
            <ImportOverlay deck={deck} compact />
          </SlideThumbnail>
          <OriginChips deck={deck} compact />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <PinnedMark deck={deck} />
            <RestrictedMark deck={deck} />
            <h3
              className={cn(
                'text-sm font-medium text-fg',
                renaming ? 'min-w-0 flex-1' : 'truncate',
              )}
            >
              {renaming ? (
                <DeckTitleInput deck={deck} onDone={endRename} onNotify={onNotify} />
              ) : (
                <Link
                  ref={titleRef}
                  to={deckLink(deck, searchHit)}
                  data-deck-hover
                  className="outline-none transition-colors duration-200 after:absolute after:inset-0 after:content-[''] hover:text-primary-hover"
                >
                  {deck.title}
                </Link>
              )}
            </h3>
            <DeckStatusBadge deck={deck} />
          </div>
          {searchHit && <SearchHit result={searchHit} className="truncate text-xs" />}
        </div>

        <DeckFooter
          deck={deck}
          placement="row"
          panelSlot={panelSlot}
          onNotify={onNotify}
          // Above the stretched title link.
          className="relative z-(--z-raised) hidden shrink-0 gap-4 sm:flex"
        />
        <DeckActions
          deck={deck}
          onNotify={onNotify}
          {...contextMenu}
          onRename={startRename}
          panelSlot={{ element: panelSlot, kind: 'row' }}
          className="z-(--z-raised) shrink-0"
        />
      </div>
      <div ref={setPanelSlot} />
    </article>
  );
}
