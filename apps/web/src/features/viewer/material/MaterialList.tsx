import type { BoardItem, Material } from '@slider/shared';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { FileIcon } from '@/features/cloud';
import { useDeleteMaterial, useMaterial, useMe, type BoardRef } from '@/lib/api';
import { formatFileSize, formatRelativeTime } from '@/lib/format';
import {
  ConfirmDialog,
  Icon,
  IconButton,
  type IconName,
  SidePanel,
  SidePanelHeader,
  useFocusLoop,
} from '@/ui';
import { RichText } from '../chat/rich-text';
import { openSource } from '../chat/source-text';
import { useRestoreFocus } from '../hooks/useRestoreFocus';

/*
 * „Material“: what was collected for a presentation or a text document – the files given at its
 * start, the notes, links and files the AI apps put there – which its AI reads. A side panel with
 * one list: a file opens in a tab of its own, a link on its site, a note unfolds in place; each
 * can be deleted after asking, one's own (with comment rights) or anyone's (managing it).
 */

/** One row of the list: a file, or a note, link or folder of the old board. */
type Entry =
  | { kind: 'file'; id: string; createdAt: string; material: Material }
  | { kind: 'item'; id: string; createdAt: string; item: BoardItem };

const FILE_LABELS: Record<Material['kind'], string> = {
  pdf: 'PDF',
  document: 'Dokument',
  presentation: 'Präsentation',
  spreadsheet: 'Tabelle',
  image: 'Bild',
  text: 'Text',
  other: 'Datei',
};

/** A note's first line without its Markdown marks: what it is called in the list. */
const firstLine = (text: string) =>
  text
    .split('\n')
    .map((line) => line.replace(/^\s*(#+|[-*+]|\d+\.|>)\s*/, '').replace(/[*_`~]/g, ''))
    .find((line) => line.trim().length > 0)
    ?.trim() ?? '';

/** A plain note's text unfolded: its paragraphs, without the first line the row shows already. */
const restOf = (text: string, title: string): string[] => {
  const lines = text.trim().split('\n');
  const rest = lines[0]?.trim() === title ? lines.slice(1) : lines;
  return rest
    .join('\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
};

type RichNode = { text?: string; children?: RichNode[] };
const plainOf = (node: RichNode): string =>
  (node.text ?? '') + (node.children ?? []).map(plainOf).join('');

/** A rich note unfolded: without its first paragraph when that is the title the row shows. */
const richRest = (rich: Record<string, unknown>, title: string): Record<string, unknown> => {
  const root = (rich as { root?: RichNode }).root;
  const [first, ...rest] = root?.children ?? [];
  if (!root || !first || plainOf(first).trim() !== title) return rich;
  return { ...rich, root: { ...root, children: rest } };
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

function titleOf(entry: Entry): string {
  if (entry.kind === 'file') return entry.material.name;
  const { item } = entry;
  if (item.kind === 'link') return item.text.trim() || hostOf(item.url ?? '');
  if (item.kind === 'folder') return item.text.trim() || 'Ordner';
  return firstLine(item.text) || (item.kind === 'question' ? 'Frage' : 'Notiz');
}

/** The side panel: the material's list under its title, ✕ and Esc close it. */
export function MaterialPanel({
  owner,
  canComment,
  canManage,
  onClose,
  onRefused,
}: {
  owner: BoardRef;
  canComment: boolean;
  canManage: boolean;
  onClose: () => void;
  /** A delete the server refused (no right, offline): the page's danger toast. */
  onRefused: (message: string) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  // The ConfirmDialog is rendered beside the panel, not in it: the panel's focus loop would
  // otherwise pull Tab back from the open dialog.
  const [asking, setAsking] = useState<Entry | null>(null);
  const remove = useDeleteMaterial(owner, onRefused);
  useRestoreFocus();
  useFocusLoop(panelRef);
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <>
      <SidePanel
        ref={panelRef}
        data-material-panel
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return;
          if (event.target instanceof Element && event.target.closest('dialog')) return;
          event.preventDefault();
          onClose();
        }}
      >
        <SidePanelHeader gap="sm">
          <div className="flex items-center gap-2">
            <Icon name="folderOpen" size={20} className="shrink-0 text-fg-muted" />
            <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
              Material
            </h2>
            <IconButton icon="close" label="Schließen (Esc)" size="sm" onClick={onClose} />
          </div>
          <p className="text-xs leading-4 text-fg-subtle">
            {owner.kind === 'deck'
              ? 'Was für die Präsentation gesammelt wurde – die KI liest es, Teil der Folien ist es nicht.'
              : 'Was für das Dokument gesammelt wurde – die KI liest es, Teil des Textes ist es nicht.'}
          </p>
        </SidePanelHeader>
        <MaterialList
          owner={owner}
          canComment={canComment}
          canManage={canManage}
          onDelete={setAsking}
        />
      </SidePanel>
      <ConfirmDialog
        open={asking !== null}
        onClose={() => setAsking(null)}
        title={asking ? `„${titleOf(asking)}“ löschen?` : ''}
        description={
          asking?.kind === 'file'
            ? 'Die Datei und ihr gelesener Text werden für alle gelöscht – die KI liest sie nicht mehr.'
            : 'Das wird für alle gelöscht – die KI liest es nicht mehr.'
        }
        confirmLabel="Löschen"
        confirmIcon="delete"
        onConfirm={() => {
          if (!asking) return;
          remove.mutate({ id: asking.id, title: titleOf(asking) });
          setAsking(null);
        }}
      />
    </>
  );
}

/** The list itself: newest first, files, notes and links together. */
export function MaterialList({
  owner,
  canComment,
  canManage,
  onDelete,
}: {
  owner: BoardRef;
  canComment: boolean;
  canManage: boolean;
  /** „Löschen“ on a row: the panel asks first. */
  onDelete: (entry: Entry) => void;
}) {
  const board = useMaterial(owner);
  const me = useMe().data?.viewer.author.id;
  const [open, setOpen] = useState<string | null>(null);

  if (!board.data) {
    return (
      <p className="px-5 py-6 text-body text-fg-subtle">
        {board.isError ? 'Das Material konnte nicht geladen werden.' : 'Wird geladen …'}
      </p>
    );
  }
  const entries: Entry[] = [
    ...board.data.materials.map((material): Entry => ({
      kind: 'file',
      id: material.id,
      createdAt: material.createdAt,
      material,
    })),
    ...board.data.items.map((item): Entry => ({
      kind: 'item',
      id: item.id,
      createdAt: item.createdAt,
      item,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <Icon name="folderOpen" size={28} className="text-fg-subtle" />
        <p className="text-body text-fg-muted">Noch kein Material</p>
        <p className="text-caption text-fg-subtle">
          {owner.kind === 'deck'
            ? 'Dateien kommen über die Büroklammer an der Eingabe auf Folie 1 dazu, Notizen und Links über die KI-Apps.'
            : 'Notizen, Links und Dateien kommen über die KI-Apps dazu.'}
        </p>
      </div>
    );
  }

  const deletable = (entry: Entry) => {
    const author = entry.kind === 'file' ? entry.material.author : entry.item.author;
    return canManage || (canComment && author.id === me);
  };

  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-3 pt-2 pb-4">
      {entries.map((entry) => (
        <Row
          key={entry.id}
          entry={entry}
          open={open === entry.id}
          onToggle={() => setOpen((current) => (current === entry.id ? null : entry.id))}
          onDelete={deletable(entry) ? () => onDelete(entry) : undefined}
        />
      ))}
    </ul>
  );
}

function Row({
  entry,
  open,
  onToggle,
  onDelete,
}: {
  entry: Entry;
  open: boolean;
  onToggle: () => void;
  onDelete?: () => void;
}) {
  const title = titleOf(entry);
  const author = entry.kind === 'file' ? entry.material.author : entry.item.author;
  const when = formatRelativeTime(entry.createdAt);
  let icon: ReactNode;
  let meta: string;
  let action: { label: string; run: () => void; expands?: boolean } | null;
  if (entry.kind === 'file') {
    const { material } = entry;
    icon = <FileIcon kind="file" type={material.kind} size={32} />;
    const pages =
      material.pages && material.kind !== 'image'
        ? `${material.pages} ${material.kind === 'presentation' ? 'Folien' : 'S.'}`
        : null;
    const reading =
      material.readState === 'pending'
        ? 'wird gelesen …'
        : material.readState === 'failed'
          ? 'Text nicht lesbar'
          : null;
    meta = [FILE_LABELS[material.kind], pages, formatFileSize(material.sizeBytes), reading]
      .filter(Boolean)
      .join(' | ');
    action = { label: `„${material.name}“ öffnen`, run: () => openSource(material, null) };
  } else {
    const { item } = entry;
    const symbol: IconName =
      item.kind === 'link'
        ? 'link'
        : item.kind === 'folder'
          ? 'folder'
          : item.kind === 'question'
            ? 'chatBubble'
            : 'notes';
    icon = (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-chip bg-surface-2 text-fg-muted">
        <Icon name={symbol} size={18} />
      </span>
    );
    if (item.kind === 'link') {
      meta = (item.url ?? '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
      action = item.url
        ? {
            label: `„${title}“ öffnen`,
            run: () => window.open(item.url!, '_blank', 'noopener,noreferrer'),
          }
        : null;
    } else if (item.kind === 'folder') {
      meta = 'Ordner';
      action = null;
    } else {
      meta = item.kind === 'question' ? 'Frage' : 'Notiz';
      action = { label: open ? 'Zuklappen' : 'Aufklappen', run: onToggle, expands: true };
    }
  }
  const body = (
    <>
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body text-fg">{title}</span>
        <span className="truncate text-caption text-fg-subtle">
          {meta} | {author.name} | {when}
        </span>
      </span>
      {action && !action.expands && (
        <Icon name="openInNew" size={16} className="shrink-0 text-fg-subtle" />
      )}
      {action?.expands && (
        <Icon
          name={open ? 'expandLess' : 'expandMore'}
          size={18}
          className="shrink-0 text-fg-subtle"
        />
      )}
    </>
  );
  const note = entry.kind === 'item' && open ? entry.item : null;
  return (
    <li data-material-entry className="group rounded-control hover:bg-hover">
      <div className="flex items-center">
        {action ? (
          <button
            type="button"
            title={action.expands ? undefined : action.label}
            aria-expanded={action.expands ? open : undefined}
            onClick={action.run}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-control px-2 py-2 text-left"
          >
            {body}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2">{body}</div>
        )}
        {onDelete && (
          <IconButton
            icon="delete"
            label={`„${title}“ löschen`}
            size="sm"
            className="mr-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
            onClick={onDelete}
          />
        )}
      </div>
      {note && (
        <div className="px-2 pb-3 pl-13 text-body text-fg">
          {note.rich ? (
            <RichText rich={richRest(note.rich, title)} className="flex flex-col gap-1.5" />
          ) : (
            <div className="flex flex-col gap-1.5">
              {restOf(note.text, title).map((paragraph, index) => (
                <p key={index} className="whitespace-pre-line">
                  {paragraph}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
