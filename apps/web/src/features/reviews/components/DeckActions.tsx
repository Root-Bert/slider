import { useState } from 'react';
import type { Deck } from '@slider/shared';
import { useUpdateDeck } from '@/lib/queries';
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

/** The ⋯ menu of a deck card/row: rename, archive/restore, delete. */
export function DeckActions({ deck, onNotify, className, triggerClassName }: DeckActionsProps) {
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const update = useUpdateDeck(deck.id);
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
    archived
      ? { label: 'Wiederherstellen', icon: 'history', onSelect: toggleArchived }
      : { label: 'Archivieren', icon: 'archive', onSelect: toggleArchived },
    { label: 'Löschen', icon: 'delete', tone: 'danger', onSelect: () => setDialog('delete') },
  ];

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
