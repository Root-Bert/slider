import { useEffect, useRef, useState } from 'react';
import type { Deck } from '@slider/shared';
import {
  useDeckStatus,
  useInvalidateSlideImages,
  useRerenderDeck,
  useUpdateDeck,
} from '@/lib/queries';
import type { ShowToast } from '@/ui';
import { markDeckVisited } from '../lib/last-visits';
import { DeleteDeckDialog } from './DeleteDeckDialog';
import { Menu, type MenuAction } from '@/ui';
import { RenameDeckDialog } from './RenameDeckDialog';

interface DeckActionsProps {
  deck: Deck;
  onNotify: ShowToast;
  className?: string;
  triggerClassName?: string;
}

/**
 * "Folienbilder neu erzeugen" (BER-94): starts the re-render and follows it through the deck
 * status until it is done. Returns the menu label (with progress) and the action.
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
      onNotify(`Folienbilder von „${deck.title}“ neu erzeugt`);
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
        setFollowing({ renderedAt: result.renderedAt, startedAt });
        onNotify('Folienbilder werden neu erzeugt …');
      },
      onError: (error) => onNotify(error.message, 'danger'),
    });
  };
  const label = !busy
    ? 'Folienbilder neu erzeugen'
    : rendering && rendering.total > 0
      ? `Folienbilder werden erzeugt … ${rendering.done}/${rendering.total}`
      : 'Folienbilder werden erzeugt …';
  return { label, start };
}

/** The ⋯ menu of a deck card/row: rename, archive/restore, delete – for decks the viewer manages. */
export function DeckActions({ deck, onNotify, className, triggerClassName }: DeckActionsProps) {
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const update = useUpdateDeck(deck.id);
  const rerender = useRerender(deck, onNotify);
  const archived = deck.archivedAt !== null;
  const close = () => setDialog(null);

  const toggleArchived = () =>
    update.mutate(
      { archived: !archived },
      {
        onSuccess: () => {
          // Our own change bumps `updatedAt` – it shouldn't show up as "Neu".
          markDeckVisited(deck.id);
          onNotify(archived ? `„${deck.title}“ wiederhergestellt` : `„${deck.title}“ archiviert`);
        },
        onError: (error) => onNotify(error.message, 'danger'),
      },
    );

  const actions: MenuAction[] = [
    { label: 'Umbenennen', icon: 'edit', onSelect: () => setDialog('rename') },
    ...(deck.import.status === 'ready'
      ? [{ label: rerender.label, icon: 'image', onSelect: rerender.start } satisfies MenuAction]
      : []),
    archived
      ? { label: 'Wiederherstellen', icon: 'history', onSelect: toggleArchived }
      : { label: 'Archivieren', icon: 'archive', onSelect: toggleArchived },
    { label: 'Löschen', icon: 'delete', tone: 'danger', onSelect: () => setDialog('delete') },
  ];

  // Reviewers and members on other people's decks: nothing to manage (BER-129).
  if (!deck.permissions.canManage) return null;

  return (
    <>
      <Menu
        label={`Aktionen für „${deck.title}“`}
        actions={actions}
        className={className}
        triggerClassName={triggerClassName}
      />
      {dialog === 'rename' && (
        <RenameDeckDialog
          deck={deck}
          onClose={close}
          onRenamed={() => {
            markDeckVisited(deck.id);
            close();
            onNotify('Review umbenannt');
          }}
        />
      )}
      {dialog === 'delete' && (
        <DeleteDeckDialog
          deck={deck}
          onClose={close}
          onDeleted={() => {
            close();
            onNotify(`„${deck.title}“ gelöscht`);
          }}
        />
      )}
    </>
  );
}
