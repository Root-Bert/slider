import { formatFileSize, type AccentColor, type BoardItem, type Material } from '@slider/shared';
import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { accentColor } from '@/lib/accent';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import {
  AutosizeTextarea,
  Avatar,
  Button,
  ColorSwatches,
  ConfirmDialog,
  IconButton,
  Menu,
  useFocusLoop,
  type MenuAction,
} from '@/ui';
import { SidePanel, SidePanelHeader } from '../components/SidePanel';
import { useRestoreFocus } from '../hooks/useRestoreFocus';
import { isMaterial, noteColor, notesOn, type BoardEntry } from './board-nodes';

/*
 * The side panel of something picked on the board (the material page), as a comment's thread:
 * a file (name, what it is, its notes, a field for one more, „Öffnen“, „Löschen“), a link (its
 * address, the same) or a note (its text). Notes read like a thread's messages, the field like
 * its reply field: ↵ hangs a note on the file or link (beside it, no box).
 */

const KIND_NAMES: Record<Material['kind'], string> = {
  pdf: 'PDF',
  document: 'Dokument',
  presentation: 'Präsentation',
  spreadsheet: 'Tabelle',
  image: 'Bild',
  text: 'Text',
  other: 'Datei',
};

export interface BoardPanelProps {
  item: BoardEntry;
  /** Every note of the board, to find the ones on `item`. */
  notes: readonly BoardItem[];
  /** The board's things by id, to name what a note round several hangs on. */
  names: ReadonlyMap<string, string>;
  canComment: boolean;
  mayEdit: (note: BoardItem) => boolean;
  /** A note's or frame's colour (the comment colours). */
  onSetColor: (note: BoardItem, color: AccentColor) => void;
  mayDelete: (item: BoardEntry) => boolean;
  onClose: () => void;
  onOpen: (item: BoardEntry) => void;
  /** A note on it; `ask` (⌘↵): handed to the AI too, its answer under the note on the board. */
  onAddNote: (text: string, ask: boolean) => void;
  onEditNote: (note: BoardItem, text: string) => void;
  onDelete: (item: BoardEntry) => void;
}

/**
 * Rendered on the material page, at the place of the presentation's side panels: the same
 * surface, backdrop and text colour – never inside the board's transformed, clipped box.
 */
export function BoardPanel(props: BoardPanelProps) {
  const host = document.querySelector<HTMLElement>('[data-material-page]') ?? document.body;
  return createPortal(<BoardPanelView key={props.item.id} {...props} />, host);
}

function BoardPanelView({
  item,
  notes,
  names,
  canComment,
  mayEdit,
  onSetColor,
  mayDelete,
  onClose,
  onOpen,
  onAddNote,
  onEditNote,
  onDelete,
}: BoardPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const [confirming, setConfirming] = useState(false);
  useRestoreFocus();
  useFocusLoop(panelRef);
  useEffect(() => panelRef.current?.focus({ preventScroll: true }), []);

  const note = !isMaterial(item) && (item.kind === 'note' || item.kind === 'box') ? item : null;
  const link = !isMaterial(item) && item.kind === 'link' ? item : null;
  const folder = !isMaterial(item) && item.kind === 'folder' ? item : null;
  const title = isMaterial(item)
    ? item.name
    : link
      ? link.text || hostOf(link.url)
      : item.kind === 'box'
        ? 'Notiz'
        : folder
          ? folder.text
          : 'Notiz';
  const meta = isMaterial(item)
    ? [
        KIND_NAMES[item.kind],
        formatFileSize(item.sizeBytes),
        item.kind === 'spreadsheet' && item.sheets.length > 0
          ? `${item.sheets.length} ${item.sheets.length === 1 ? 'Blatt' : 'Blätter'}`
          : item.pages
            ? `${item.pages} ${item.kind === 'presentation' ? 'Folien' : 'Seiten'}`
            : null,
        item.author.name,
        formatRelativeTime(item.createdAt),
      ]
    : folder
      ? [
          'Ordner',
          `${folder.boundIds.length} ${folder.boundIds.length === 1 ? 'Datei' : 'Dateien'}`,
          item.author.name,
          formatRelativeTime(item.createdAt),
        ]
      : [item.author.name, formatRelativeTime(item.createdAt)];
  const own = notesOn(notes, item.id);
  const label = isMaterial(item)
    ? 'Datei'
    : link
      ? 'Link'
      : item.kind === 'box'
        ? 'Notiz'
        : folder
          ? 'Ordner'
          : 'Notiz';

  return (
    <SidePanel
      ref={panelRef}
      data-board-panel
      aria-labelledby={titleId}
      style={
        {
          '--card-accent': accentColor(isMaterial(item) ? item.author.color : noteColor(item)),
        } as CSSProperties
      }
    >
      <SidePanelHeader>
        <div className="flex items-center gap-2">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
            {title}
          </h2>
          <IconButton icon="close" label={`${label} schließen (Esc)`} size="sm" onClick={onClose} />
        </div>
        <p className="truncate text-xs text-fg-subtle" title={formatDateTime(item.createdAt)}>
          {meta.filter(Boolean).join(' | ')}
        </p>
        {(isMaterial(item) || link || mayDelete(item)) && (
          <div className="flex items-center gap-2">
            {(isMaterial(item) || link) && (
              <Button size="sm" variant="secondary" icon="openInFull" onClick={() => onOpen(item)}>
                Öffnen
              </Button>
            )}
            {mayDelete(item) && (
              <Button
                size="sm"
                variant="ghost"
                icon="delete"
                className="ml-auto"
                // A folder with files asks its own question (keep them or not).
                onClick={() =>
                  folder && folder.boundIds.length > 0 ? onDelete(item) : setConfirming(true)
                }
              >
                Löschen
              </Button>
            )}
          </div>
        )}
      </SidePanelHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-5 pt-3.5 pb-4">
        {folder && (
          <ol aria-label="Dateien im Ordner" className="flex flex-col gap-1">
            {folder.boundIds
              .map((id) => names.get(id) ?? 'Datei')
              .sort((a, b) => a.localeCompare(b, 'de', { numeric: true }))
              .map((name, index) => (
                <li key={index} className="truncate text-body text-fg-muted">
                  {name}
                </li>
              ))}
          </ol>
        )}
        {link && (
          <a
            href={link.url ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-body text-fg-muted underline-offset-2 hover:underline"
          >
            {link.url}
          </a>
        )}
        {note ? (
          <>
            <NoteMessage note={note} editable={mayEdit(note)} onEdit={onEditNote} />
            {mayEdit(note) && (
              <ColorSwatches
                variant="dot"
                label="Farbe"
                value={(note.color ?? note.author.color) as AccentColor}
                onChange={(color) => onSetColor(note, color)}
                ringOffset="glass-solid"
              />
            )}
            {note.boundIds.length > 0 && (
              <p className="text-caption text-fg-subtle">
                {note.kind === 'box' ? 'Darin: ' : 'An '}
                {note.boundIds.map((id) => `„${names.get(id) ?? 'Gelöscht'}“`).join(', ')}
              </p>
            )}
          </>
        ) : own.length > 0 ? (
          <ol aria-label="Notizen" className="flex flex-col gap-2">
            {own.map((each) => (
              <li key={each.id}>
                <NoteMessage
                  note={each}
                  editable={mayEdit(each)}
                  deletable={mayDelete(each)}
                  onEdit={onEditNote}
                  onDelete={onDelete}
                />
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-body text-fg-subtle">Noch keine Notizen</p>
        )}
      </div>

      {!note && canComment && <NoteField label={label} onAdd={onAddNote} />}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={note ? 'Notiz löschen?' : `„${title}“ löschen?`}
        description={
          own.length > 0
            ? 'Die Notizen daran werden mitgelöscht, wenn sie nur daran hängen.'
            : 'Das lässt sich nicht rückgängig machen.'
        }
        confirmLabel="Löschen"
        confirmIcon="delete"
        onConfirm={() => {
          setConfirming(false);
          onDelete(item);
        }}
      />
    </SidePanel>
  );
}

const hostOf = (url: string | null) => {
  try {
    return new URL(url ?? '').host;
  } catch {
    return url ?? '';
  }
};

/** A note as a thread's message: its author, when, its text – one's own changed in place. */
function NoteMessage({
  note,
  editable,
  deletable = false,
  onEdit,
  onDelete,
}: {
  note: BoardItem;
  editable: boolean;
  deletable?: boolean;
  onEdit: (note: BoardItem, text: string) => void;
  onDelete?: (note: BoardItem) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  const [confirming, setConfirming] = useState(false);
  const actions: MenuAction[] = [];
  if (editable)
    actions.push({
      label: 'Bearbeiten',
      icon: 'edit',
      onSelect: () => {
        setText(note.text);
        setEditing(true);
      },
    });
  if (deletable && onDelete)
    actions.push({
      label: 'Löschen',
      icon: 'delete',
      tone: 'danger',
      onSelect: () => setConfirming(true),
    });
  const save = () => {
    setEditing(false);
    if (text.trim() !== note.text) onEdit(note, text.trim());
  };
  return (
    <article
      data-board-note={note.id}
      className="relative flex flex-col gap-2 rounded-panel bg-surface-1 px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--note-accent)]"
      style={{ '--note-accent': accentColor(noteColor(note)) } as CSSProperties}
    >
      <header className="-my-1 flex min-w-0 items-center gap-2">
        <Avatar author={note.author} size={24} />
        <span className="min-w-0 truncate text-xs font-medium text-fg">{note.author.name}</span>
        <time
          dateTime={note.createdAt}
          title={formatDateTime(note.createdAt)}
          className="min-w-0 shrink-[4] truncate text-caption text-fg-subtle"
        >
          {formatRelativeTime(note.createdAt)}
        </time>
        {actions.length > 0 && !editing && (
          <span className="ml-auto flex shrink-0 items-center">
            <Menu label="Aktionen für diese Notiz" triggerSize="compact" actions={actions} />
          </span>
        )}
      </header>
      {editing ? (
        <div className="field-well focus-field rounded-control py-1.5 pr-1 pl-3">
          <AutosizeTextarea
            autoFocus
            value={text}
            aria-label="Notiz bearbeiten"
            className="py-[3px] text-body leading-5 text-fg"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setEditing(false);
              } else if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                save();
              }
            }}
          />
        </div>
      ) : (
        <p className="text-body leading-5 break-words whitespace-pre-wrap text-fg">{note.text}</p>
      )}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Notiz löschen?"
        description="Das lässt sich nicht rückgängig machen."
        confirmLabel="Löschen"
        confirmIcon="delete"
        onConfirm={() => {
          setConfirming(false);
          onDelete?.(note);
        }}
      />
    </article>
  );
}

/** The reply field's look: ↵ hangs a note on what is shown, ⇧↵ a new line. */
function NoteField({
  label,
  onAdd,
}: {
  label: string;
  onAdd: (text: string, ask: boolean) => void;
}) {
  const [text, setText] = useState('');
  const submit = (event?: FormEvent, ask = false) => {
    event?.preventDefault();
    if (!text.trim()) return;
    onAdd(text.trim(), ask);
    setText('');
  };
  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 border-t border-hairline px-5 pt-3.5 pb-[18px]"
    >
      <div className="flex items-end gap-2">
        <div className="field-well focus-field flex min-h-10 min-w-0 flex-1 items-end gap-0.5 rounded-control py-1.5 pr-1 pl-3.5">
          <div className="min-w-0 flex-1 overflow-hidden py-[5px]">
            <AutosizeTextarea
              value={text}
              placeholder={
                label === 'Link'
                  ? 'Notiz zu diesem Link'
                  : label === 'Ordner'
                    ? 'Notiz zu diesem Ordner'
                    : 'Notiz zu dieser Datei'
              }
              aria-label="Notiz hinzufügen"
              aria-keyshortcuts="Meta+Enter"
              className="text-body leading-5 text-fg"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  // ⌘↵: put down and handed to the AI, as in a note on the board.
                  submit(undefined, event.metaKey || event.ctrlKey);
                }
              }}
            />
          </div>
        </div>
        <IconButton
          type="submit"
          icon="arrowUpward"
          label="Notiz hinzufügen"
          title="Hinzufügen (Enter)"
          variant="primary"
          size="md"
          iconSize={20}
          disabled={!text.trim()}
        />
      </div>
    </form>
  );
}
