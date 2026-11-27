import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { CLOUD_TRASH_DAYS, isWriterMarkdown, type WriterDocument } from '@slider/shared';
import {
  documentFilePath,
  documentThumbnailUrl,
  usePurgeDocuments,
  useRenameDocument,
  useRestoreDocuments,
  useTrashDocuments,
} from '@/lib/api';
import { apiDownload } from '@/lib/api-client';
import { formatRelativeTime, pluralize } from '@/lib/format';
import { routes } from '@/lib/routes';
import { useDeckContextMenu } from '@/features/reviews';
import {
  Avatar,
  Badge,
  cn,
  ConfirmDialog,
  ContextMenu,
  Icon,
  Menu,
  SelectedMark,
  selectedCardClass,
  selectedRowClass,
  type MenuAction,
  type ShowToast,
} from '@/ui';
import { trashDaysLeft } from '../lib/documents';

/** A page's first sheet, upright. Decorative – the link beside it carries the title. */
export function DocumentThumbnail({
  document,
  className,
  children,
}: {
  document: Pick<WriterDocument, 'id' | 'versionId' | 'hasThumbnail'>;
  className?: string;
  children?: ReactNode;
}) {
  // A picture that does not come (not drawn yet) leaves the sheet's own sign.
  const [failed, setFailed] = useState<string | null>(null);
  const src = document.hasThumbnail ? documentThumbnailUrl(document) : null;
  return (
    <div className={cn('relative aspect-[210/297] overflow-hidden bg-placeholder', className)}>
      {src && failed !== src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(src)}
          className="size-full object-cover object-top"
        />
      ) : (
        <div className="flex size-full items-center justify-center text-fg-faint">
          <Icon name="article" size={24} />
        </div>
      )}
      {children}
    </div>
  );
}

const MAX_TITLE_LENGTH = 200;

/** „Umbenennen“ in place, as a presentation's: Enter or leaving saves, Escape cancels. */
function DocumentTitleInput({
  document,
  onDone,
  onNotify,
}: {
  document: WriterDocument;
  onDone: (hadFocus: boolean) => void;
  onNotify: ShowToast;
}) {
  const [title, setTitle] = useState(document.title);
  const rename = useRenameDocument(document.workspaceId);
  const ref = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = () => {
    settled.current = true;
    onDone(globalThis.document.activeElement === ref.current);
  };
  const save = () => {
    if (settled.current) return;
    const trimmed = title.trim();
    if (trimmed === '' || trimmed === document.title) return finish();
    rename.mutate(
      { id: document.id, title: trimmed, fileName: document.fileName },
      { onError: (error) => onNotify(error.message, 'danger') },
    );
    finish();
  };
  return (
    <input
      ref={ref}
      value={title}
      onChange={(event) => setTitle(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          save();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish();
        }
      }}
      onContextMenu={(event) => event.stopPropagation()}
      maxLength={MAX_TITLE_LENGTH}
      aria-label="Name des Dokuments"
      className="-mx-1 w-full min-w-0 rounded-badge bg-surface-1 px-1 text-fg ring-2 ring-focus outline-none"
    />
  );
}

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

const LISTED_TITLES = 5;

/** „X löschen?“ – into the trash, or out of it for good. */
export function DeleteDocumentsDialog({
  documents,
  forGood = false,
  onClose,
  onDeleted,
}: {
  documents: readonly WriterDocument[];
  forGood?: boolean;
  onClose: () => void;
  onDeleted: (count: number) => void;
}) {
  const workspaceId = documents[0]?.workspaceId ?? '';
  const trash = useTrashDocuments(workspaceId);
  const purge = usePurgeDocuments(workspaceId);
  const remove = forGood ? purge : trash;
  const single = documents.length === 1 ? documents[0] : undefined;
  const skipped = remove.data?.skipped ?? [];
  return (
    <ConfirmDialog
      onClose={onClose}
      title={
        single
          ? `„${single.title}“ ${forGood ? 'endgültig ' : ''}löschen?`
          : `${pluralize(documents.length, 'Dokument', 'Dokumente')} ${forGood ? 'endgültig ' : ''}löschen?`
      }
      description={
        <div className="flex flex-col gap-2">
          {!single && (
            <ul className="flex flex-col gap-0.5 text-fg">
              {documents.slice(0, LISTED_TITLES).map((document) => (
                <li key={document.id} className="truncate">
                  „{document.title}“
                </li>
              ))}
              {documents.length > LISTED_TITLES && (
                <li className="text-fg-subtle">und {documents.length - LISTED_TITLES} weitere</li>
              )}
            </ul>
          )}
          {forGood ? (
            <span>
              Text, Kommentare und frühere Versionen werden endgültig gelöscht. Das lässt sich nicht
              rückgängig machen.
            </span>
          ) : (
            <span>
              {single ? 'Es liegt' : 'Sie liegen'} noch {CLOUD_TRASH_DAYS} Tage im Papierkorb und{' '}
              {single ? 'lässt' : 'lassen'} sich so lange wiederherstellen.
            </span>
          )}
        </div>
      }
      confirmLabel={forGood ? 'Endgültig löschen' : 'Löschen'}
      confirmIcon={forGood ? 'deleteForever' : 'delete'}
      pending={remove.isPending}
      onConfirm={() =>
        remove.mutate(
          documents.map((document) => document.id),
          {
            // Nothing went: the dialog stays open with the reason.
            onSuccess: (result) => result.nodes.length > 0 && onDeleted(result.nodes.length),
          },
        )
      }
      error={remove.error?.message ?? skipped[0]?.reason}
    />
  );
}

/** A document's own actions – the ⋯ button's and the right click's. */
function useDocumentActions(
  document: WriterDocument,
  onNotify: ShowToast,
  onRename: () => void,
): { actions: MenuAction[]; dialog: ReactNode } {
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const mayManage = document.permissions.canManage;
  const actions: MenuAction[] = [
    ...(mayManage
      ? [{ label: 'Umbenennen', icon: 'edit', onSelect: onRename } satisfies MenuAction]
      : []),
    // What was collected for it: its „Material“ in the open document, beside the text – not for a
    // Markdown file, which opens as a page in Cloud.
    ...(isWriterMarkdown(document.fileName)
      ? []
      : [
          {
            label: 'Material',
            icon: 'folderOpen',
            onSelect: () => void navigate(routes.documentMaterial(document.id)),
          } satisfies MenuAction,
        ]),
    {
      label: 'Herunterladen',
      icon: 'download',
      onSelect: () =>
        void apiDownload(documentFilePath(document.id), document.fileName).catch((error: unknown) =>
          onNotify(error instanceof Error ? error.message : 'Download fehlgeschlagen', 'danger'),
        ),
    },
    ...(mayManage
      ? [
          {
            label: 'Löschen',
            icon: 'delete',
            tone: 'danger',
            onSelect: () => setDeleting(true),
          } satisfies MenuAction,
        ]
      : []),
  ];
  const dialog = deleting && (
    <DeleteDocumentsDialog
      documents={[document]}
      onClose={() => setDeleting(false)}
      onDeleted={() => {
        setDeleting(false);
        onNotify(`„${document.title}“ gelöscht`);
      }}
    />
  );
  return { actions, dialog };
}

function OpenCommentsChip({ document }: { document: WriterDocument }) {
  if (document.openComments === 0) return null;
  return (
    <Badge
      tone="neutral"
      title={pluralize(document.openComments, 'offener Kommentar', 'offene Kommentare')}
    >
      <Icon name="chatBubble" size={12} />
      {document.openComments}
    </Badge>
  );
}

const placeLine = (document: WriterDocument) =>
  `${document.place} | ${formatRelativeTime(document.updatedAt)}`;

export interface DocumentItemProps {
  document: WriterDocument;
  selected?: boolean;
  onNotify: ShowToast;
}

const TITLE_LINK =
  "outline-none transition-colors duration-200 after:absolute after:inset-0 after:content-[''] hover:text-primary-hover";

/** Grid card: the sheet, then title, place and who changed it last – built like a deck's card. */
export function DocumentCard({ document, selected = false, onNotify }: DocumentItemProps) {
  const { onContextMenu, contextAt, onContextClose } = useDeckContextMenu();
  const { renaming, startRename, endRename, titleRef } = useInPlaceRename();
  const { actions, dialog } = useDocumentActions(document, onNotify, startRename);
  return (
    <article className="group relative flex min-w-0 flex-col gap-3" onContextMenu={onContextMenu}>
      <DocumentThumbnail
        document={document}
        className={cn(
          'rounded-control ring-2 ring-transparent transition-[box-shadow,scale] duration-300',
          'group-has-[[data-deck-hover]:hover]:scale-[0.97] group-has-[[data-deck-hover]:hover]:ring-fg',
          'group-has-[a:focus-visible]:ring-focus',
          selected && selectedCardClass,
        )}
      >
        {selected && <SelectedMark />}
      </DocumentThumbnail>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <h3
            className={cn('text-sm font-medium text-fg', renaming ? 'min-w-0 flex-1' : 'truncate')}
          >
            {renaming ? (
              <DocumentTitleInput document={document} onDone={endRename} onNotify={onNotify} />
            ) : (
              <Link
                ref={titleRef}
                to={routes.document(document.id)}
                data-deck-hover
                className={TITLE_LINK}
              >
                {document.title}
              </Link>
            )}
          </h3>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <OpenCommentsChip document={document} />
            {document.updatedBy && <Avatar author={document.updatedBy} size={20} />}
          </span>
        </div>
        <span className="truncate text-xs text-fg-subtle">{placeLine(document)}</span>
      </div>
      {contextAt && (
        <ContextMenu
          label={`Aktionen für „${document.title}“`}
          actions={actions}
          at={contextAt}
          onClose={onContextClose}
        />
      )}
      {dialog}
    </article>
  );
}

/** List row with the same as the card. */
export function DocumentRow({ document, selected = false, onNotify }: DocumentItemProps) {
  const { onContextMenu, contextAt, onContextClose } = useDeckContextMenu();
  const { renaming, startRename, endRename, titleRef } = useInPlaceRename();
  const { actions, dialog } = useDocumentActions(document, onNotify, startRename);
  return (
    <article
      onContextMenu={onContextMenu}
      className={cn(
        'group relative flex items-center gap-4 rounded-control-sm px-3 py-2.5 transition-colors',
        'has-[[data-deck-hover]:hover]:bg-surface-1',
        'has-[a:focus-visible]:bg-surface-1 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-focus',
        selected && selectedRowClass,
      )}
    >
      <div data-grip className="relative w-10 shrink-0">
        <DocumentThumbnail document={document} className="rounded-thumb">
          {selected && <SelectedMark compact />}
        </DocumentThumbnail>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h3
          data-grip
          className={cn('text-sm font-medium text-fg', renaming ? 'min-w-0 flex-1' : 'truncate')}
        >
          {renaming ? (
            <DocumentTitleInput document={document} onDone={endRename} onNotify={onNotify} />
          ) : (
            <Link
              ref={titleRef}
              to={routes.document(document.id)}
              data-deck-hover
              className={TITLE_LINK}
            >
              {document.title}
            </Link>
          )}
        </h3>
        <span className="truncate text-xs text-fg-subtle">{placeLine(document)}</span>
      </div>
      <span className="relative z-(--z-raised) hidden shrink-0 items-center gap-3 sm:flex">
        <OpenCommentsChip document={document} />
        {document.updatedBy && <Avatar author={document.updatedBy} size={24} />}
      </span>
      <Menu
        label={`Aktionen für „${document.title}“`}
        actions={actions}
        className="z-(--z-raised) shrink-0"
      />
      {contextAt && (
        <ContextMenu
          label={`Aktionen für „${document.title}“`}
          actions={actions}
          at={contextAt}
          onClose={onContextClose}
        />
      )}
      {dialog}
    </article>
  );
}

/** A deleted document: back, or gone for good. */
export function TrashedDocumentRow({
  document,
  onNotify,
}: {
  document: WriterDocument;
  onNotify: ShowToast;
}) {
  const [purging, setPurging] = useState(false);
  const menu = useDeckContextMenu();
  const restore = useRestoreDocuments(document.workspaceId);
  const daysLeft = trashDaysLeft(document);
  const actions: MenuAction[] = [
    {
      label: 'Wiederherstellen',
      icon: 'history',
      onSelect: () =>
        restore.mutate([document.id], {
          onSuccess: () => onNotify(`„${document.title}“ wiederhergestellt`),
          onError: (error) => onNotify(error.message, 'danger'),
        }),
    },
    {
      label: 'Endgültig löschen',
      icon: 'deleteForever',
      tone: 'danger',
      onSelect: () => setPurging(true),
    },
  ];
  return (
    <li
      className="flex items-center gap-4 rounded-control-sm px-3 py-2.5 transition-colors hover:bg-surface-1"
      onContextMenu={menu.onContextMenu}
    >
      <div className="w-10 shrink-0">
        <DocumentThumbnail document={document} className="rounded-thumb" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-medium text-fg">{document.title}</h3>
          {daysLeft <= 3 && <Badge tone="warning">bald weg</Badge>}
        </span>
        <span className="truncate text-xs text-fg-subtle">
          Gelöscht {document.deletedAt ? formatRelativeTime(document.deletedAt) : ''}
        </span>
      </div>
      <span className="shrink-0 text-sm text-fg-subtle tabular-nums max-sm:hidden">
        Bleibt {daysLeft} {daysLeft === 1 ? 'Tag' : 'Tage'}
      </span>
      {document.permissions.canManage && (
        <Menu label={`Aktionen für „${document.title}“`} actions={actions} className="shrink-0" />
      )}
      {menu.contextAt && document.permissions.canManage && (
        <ContextMenu
          label={`Aktionen für „${document.title}“`}
          actions={actions}
          at={menu.contextAt}
          onClose={menu.onContextClose}
        />
      )}
      {purging && (
        <DeleteDocumentsDialog
          documents={[document]}
          forGood
          onClose={() => setPurging(false)}
          onDeleted={() => {
            setPurging(false);
            onNotify(`„${document.title}“ gelöscht`);
          }}
        />
      )}
    </li>
  );
}
