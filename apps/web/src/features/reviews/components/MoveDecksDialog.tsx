import { useState, type FormEvent } from 'react';
import type { Deck } from '@slider/shared';
import { pluralize } from '@/lib/format';
import { useCreateFolder, useFolders, type BulkResult } from '@/lib/api';
import { Button, cn, Dialog, Icon, TextField } from '@/ui';
import { useMoveDecks } from '../hooks/useMoveDecks';

/** "Verschieben …": pick a folder (or none) for one or several decks; a new folder on the spot. */
export function MoveDecksDialog({
  decks,
  workspaceId,
  onClose,
  onMoved,
}: {
  decks: readonly Deck[];
  workspaceId: string;
  onClose: () => void;
  onMoved: (result: BulkResult<unknown>, folderName: string | null) => void;
}) {
  const folders = useFolders(workspaceId);
  const create = useCreateFolder(workspaceId);
  const move = useMoveDecks();
  const [newName, setNewName] = useState('');
  const current = new Set(decks.map((deck) => deck.folderId ?? null));
  const only = current.size === 1 ? [...current][0] : undefined;

  const moveTo = (folderId: string | null, name: string | null) =>
    move.mutate(
      { deckIds: decks.map((deck) => deck.id), folderId },
      { onSuccess: (result) => onMoved(result, name) },
    );

  const createAndMove = (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name || create.isPending) return;
    create.mutate(name, { onSuccess: (folder) => moveTo(folder.id, folder.name) });
  };

  const busy = move.isPending || create.isPending;
  const option = (folderId: string | null, label: string) => (
    <li key={folderId ?? 'none'}>
      <button
        type="button"
        disabled={busy || only === folderId}
        onClick={() => moveTo(folderId, folderId ? label : null)}
        className={cn(
          'flex w-full items-center gap-3 rounded-control-sm px-3 py-2 text-left text-sm text-fg',
          'hover:bg-white/10 disabled:cursor-default disabled:hover:bg-transparent',
        )}
      >
        <Icon name={folderId ? 'folder' : 'description'} size={18} className="text-fg-subtle" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {only === folderId && <Icon name="check" size={16} label="Aktueller Ort" />}
      </button>
    </li>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={
        decks.length === 1
          ? `„${decks[0]!.title}“ verschieben`
          : `${pluralize(decks.length, 'Review', 'Reviews')} verschieben`
      }
    >
      <div className="flex flex-col gap-4">
        <ul className="-mx-1 flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {option(null, 'Kein Ordner')}
          {(folders.data ?? []).map((folder) => option(folder.id, folder.name))}
        </ul>
        <form className="flex items-start gap-2" onSubmit={createAndMove}>
          <TextField
            aria-label="Neuer Ordner"
            placeholder="Neuer Ordner"
            icon="folder"
            maxLength={80}
            className="flex-1"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            error={create.error?.message ?? move.error?.message}
          />
          <Button type="submit" variant="secondary" disabled={!newName.trim() || busy}>
            Anlegen
          </Button>
        </form>
      </div>
    </Dialog>
  );
}
