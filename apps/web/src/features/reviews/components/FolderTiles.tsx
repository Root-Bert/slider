import { useState, type DragEvent, type MouseEvent } from 'react';
import type { DeckFolder } from '@slider/shared';
import { pluralize } from '@/lib/format';
import { cn, ContextMenu, Icon, type MenuAction } from '@/ui';
import { draggedDecks, isDeckDrag } from '../lib/deck-drag';

interface FolderTilesProps {
  folders: readonly DeckFolder[];
  counts: ReadonlyMap<string, number>;
  onOpen: (folderId: string) => void;
  /** Missing for viewers and reviewers: no rename, delete or drop. */
  manage?: {
    onRename: (folder: DeckFolder) => void;
    onDelete: (folder: DeckFolder) => void;
    onDropDecks: (folderId: string, deckIds: string[]) => void;
  };
}

/** The workspace's folders above the decks of the top level – open on click, drop decks onto them. */
export function FolderTiles({ folders, counts, onOpen, manage }: FolderTilesProps) {
  if (folders.length === 0) return null;
  return (
    <ul
      aria-label="Ordner"
      className="grid grid-cols-1 gap-3 min-[500px]:grid-cols-2 min-[900px]:grid-cols-3 min-[1200px]:grid-cols-4"
    >
      {folders.map((folder) => (
        <FolderTile
          key={folder.id}
          folder={folder}
          count={counts.get(folder.id) ?? 0}
          onOpen={() => onOpen(folder.id)}
          manage={manage}
        />
      ))}
    </ul>
  );
}

function FolderTile({
  folder,
  count,
  onOpen,
  manage,
}: {
  folder: DeckFolder;
  count: number;
  onOpen: () => void;
  manage: FolderTilesProps['manage'];
}) {
  const [dropping, setDropping] = useState(false);
  const [contextAt, setContextAt] = useState<{ x: number; y: number } | null>(null);
  const actions: MenuAction[] = manage
    ? [
        { label: 'Umbenennen', icon: 'edit', onSelect: () => manage.onRename(folder) },
        {
          label: 'Ordner löschen',
          icon: 'delete',
          tone: 'danger',
          onSelect: () => manage.onDelete(folder),
        },
      ]
    : [];

  const onDragOver = (event: DragEvent) => {
    if (!manage || !isDeckDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropping(true);
  };
  const onDrop = (event: DragEvent) => {
    setDropping(false);
    if (!manage || !isDeckDrag(event)) return;
    event.preventDefault();
    const ids = draggedDecks(event);
    if (ids.length > 0) manage.onDropDecks(folder.id, ids);
  };
  const onContextMenu = (event: MouseEvent) => {
    if (actions.length === 0) return;
    event.preventDefault();
    setContextAt({ x: event.clientX, y: event.clientY });
  };

  return (
    <li
      className={cn(
        'glass-control group relative flex min-h-14 items-center rounded-panel transition-[background-color,box-shadow] hover:bg-white/15',
        dropping && 'ring-2 ring-(--selection)',
      )}
      onDragOver={onDragOver}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left"
      >
        <Icon
          name="folder"
          size={22}
          className="shrink-0 text-fg-subtle transition-colors group-hover:text-fg"
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-fg">{folder.name}</span>
          <span className="text-xs text-fg-subtle">{pluralize(count, 'Review', 'Reviews')}</span>
        </span>
      </button>
      {contextAt && (
        <ContextMenu
          label={`Aktionen für Ordner „${folder.name}“`}
          actions={actions}
          at={contextAt}
          onClose={() => setContextAt(null)}
        />
      )}
    </li>
  );
}
