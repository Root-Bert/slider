import { useEffect, useRef, useState } from 'react';
import type { Deck } from '@slider/shared';
import { useDeckStatus, useInvalidateSlideImages, useRerenderDeck, useUpdateDeck } from '@/lib/api';
import { ContextMenu, Menu, type IconButtonVariant, type MenuAction, type ShowToast } from '@/ui';
import { usePinnedDecks } from '../hooks/usePinnedDecks';
import { DeleteDeckDialog } from './DeleteDeckDialog';
import { MoveDecksDialog } from './MoveDecksDialog';
import { movedMessage } from '../hooks/useMoveDecks';

interface DeckActionsProps {
  deck: Deck;
  onNotify: ShowToast;
  className?: string;
  triggerClassName?: string;
  /** Look of the ⋯ button (`glass` over the grid card's thumbnail). */
  triggerVariant?: IconButtonVariant;
  /** Where the card was right-clicked: the same actions open there as a context menu. */
  contextAt?: { x: number; y: number } | null;
  onContextClose?: () => void;
  /** "Umbenennen": the card/row turns its title into an input. */
  onRename: () => void;
}

/**
 * "Neu rendern" (BER-94): starts the re-render (Office first, so a file that was too big before
 * gets another chance) and follows it through the deck status until it is done. Returns the
 * menu label (with progress) and the action.
 */
function useRerender(deck: Deck, onNotify: ShowToast) {
  const rerender = useRerenderDeck(deck.id);
  const invalidateImages = useInvalidateSlideImages(deck.id);
  // The run being followed: `renderedAt` before it and when it was started.
  const [following, setFollowing] = useState<{ renderedAt: string | null; startedAt: number }>();
  const status = useDeckStatus(deck.id, following !== undefined);
  // Only a status fetched after the start counts – the cache may still hold an older one.
  const fresh = following !== undefined && status.dataUpdatedAt >= following.startedAt;
  const rendering = fresh ? (status.data?.rendering ?? null) : null;
  const finished = fresh && !rendering;
  const renderedAt = status.data?.renderedAt ?? null;

  const announced = useRef<typeof following>(undefined);
  useEffect(() => {
    if (!finished || !following || announced.current === following) return;
    announced.current = following;
    if (renderedAt && renderedAt !== following.renderedAt) {
      void invalidateImages();
      onNotify(`„${deck.title}“ neu gerendert`);
    } else {
      onNotify('Keine besseren Folienbilder möglich – die Vorschau bleibt.');
    }
  }, [finished, following, renderedAt, invalidateImages, onNotify, deck.title]);

  const busy = rerender.isPending || (following !== undefined && !finished);
  const start = () => {
    if (busy) return;
    const startedAt = Date.now();
    rerender.mutate(undefined, {
      onSuccess: (result) => {
        if (result.status === 'newVersion') {
          onNotify('Die Datei hat sich geändert – die neue Version wird importiert.');
          return;
        }
        setFollowing({ renderedAt: result.renderedAt, startedAt });
        onNotify('Folien werden neu gerendert …');
      },
      onError: (error) => onNotify(error.message, 'danger'),
    });
  };
  const label = !busy
    ? 'Neu rendern'
    : rendering && rendering.total > 0
      ? `Wird gerendert … ${rendering.done}/${rendering.total}`
      : 'Wird gerendert …';
  return { label, start };
}

/**
 * The ⋯ menu of a deck card/row – pin for every deck; rename, re-render, archive/restore, delete
 * for decks the viewer manages. The same actions open at `contextAt` for a right click.
 */
export function DeckActions({
  deck,
  onNotify,
  className,
  triggerClassName,
  triggerVariant,
  contextAt,
  onContextClose,
  onRename,
}: DeckActionsProps) {
  const [deleting, setDeleting] = useState(false);
  const [moving, setMoving] = useState(false);
  const update = useUpdateDeck(deck.id);
  const rerender = useRerender(deck, onNotify);
  const pins = usePinnedDecks(deck.workspaceId);
  const pinned = pins.isPinned(deck.id);
  const archived = deck.archivedAt !== null;

  const toggleArchived = () =>
    update.mutate(
      { archived: !archived },
      {
        onSuccess: () => {
          onNotify(archived ? `„${deck.title}“ wiederhergestellt` : `„${deck.title}“ archiviert`);
        },
        onError: (error) => onNotify(error.message, 'danger'),
      },
    );

  const pinAction: MenuAction = pinned
    ? { label: 'Lösen', icon: 'pushPin', onSelect: () => pins.unpin(deck.id) }
    : {
        label: 'Anpinnen',
        icon: 'pushPin',
        onSelect: () => pins.pin(deck.id),
        disabled: pins.full,
        title: pins.full ? pins.limitMessage() : undefined,
      };

  // Reviewers and members on other people's decks can only pin them (BER-129).
  const manageActions: MenuAction[] = [
    { label: 'Umbenennen', icon: 'edit', onSelect: onRename },
    { label: 'Verschieben …', icon: 'folder', onSelect: () => setMoving(true) },
    ...(deck.import.status === 'ready'
      ? [{ label: rerender.label, icon: 'image', onSelect: rerender.start } satisfies MenuAction]
      : []),
    archived
      ? { label: 'Wiederherstellen', icon: 'history', onSelect: toggleArchived }
      : { label: 'Archivieren', icon: 'archive', onSelect: toggleArchived },
    { label: 'Löschen', icon: 'delete', tone: 'danger', onSelect: () => setDeleting(true) },
  ];
  const actions = deck.permissions.canManage ? [pinAction, ...manageActions] : [pinAction];

  return (
    <>
      <Menu
        label={`Aktionen für „${deck.title}“`}
        actions={actions}
        className={className}
        triggerClassName={triggerClassName}
        triggerVariant={triggerVariant}
      />
      {contextAt && onContextClose && (
        <ContextMenu
          label={`Aktionen für „${deck.title}“`}
          actions={actions}
          at={contextAt}
          onClose={onContextClose}
        />
      )}
      {moving && (
        <MoveDecksDialog
          decks={[deck]}
          workspaceId={deck.workspaceId}
          onClose={() => setMoving(false)}
          onMoved={(result, folderName) => {
            setMoving(false);
            const message = movedMessage(result, folderName);
            onNotify(message.text, message.tone);
          }}
        />
      )}
      {deleting && (
        <DeleteDeckDialog
          decks={[deck]}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            pins.unpin(deck.id);
            setDeleting(false);
            onNotify(`„${deck.title}“ gelöscht`);
          }}
        />
      )}
    </>
  );
}
