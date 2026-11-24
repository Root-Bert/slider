import { useRef, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import {
  CLOUD_FOLDER_TYPE,
  isCloudReference,
  isPictureAttachment,
  type Attachment,
} from '@slider/shared';
import { attachmentUrl } from '@/lib/api';
import { useActiveWorkspace } from '@/features/workspaces';
import { formatFileSize } from '@/lib/format';
import { cn, ErrorText, Icon, IconButton } from '@/ui';
import type { Attachments, FieldAttachment } from './useAttachments';
import { referenceRoute } from './useCloudDrop';

/** A file's chip symbol: a Cloud folder or file pointed to, else the clip. */
const chipIcon = (one: Pick<Attachment, 'type' | 'nodeId'>) =>
  !isCloudReference(one) ? 'attachFile' : one.type === CLOUD_FOLDER_TYPE ? 'folder' : 'description';

const CHIP =
  'relative inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-chip bg-surface-2 pr-1 pl-2 text-body text-fg';
const THUMB = 'block h-9 w-16 rounded-badge bg-glass-solid object-cover ring-hairline-strong';

/**
 * The clip of a field: picks files (pictures only where only they mean something) – pasting
 * into the field works too. The focus stays in the field.
 */
export function AttachButton({
  files,
  size = 'compact',
  disabled = false,
}: {
  files: Attachments;
  size?: 'sm' | 'compact';
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  if (!files.enabled) return null;
  const pictures = files.accept === 'pictures';
  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const list = [...(event.target.files ?? [])];
    // The same files can be picked again.
    event.target.value = '';
    files.add(list);
  };
  const off = disabled || files.room === 0;
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={pictures ? 'image/png,image/jpeg,image/gif,image/webp' : undefined}
        multiple
        hidden
        tabIndex={-1}
        aria-hidden
        onChange={picked}
      />
      <IconButton
        icon="attachFile"
        label={pictures ? 'Bilder anhängen' : 'Datei anhängen'}
        title={`${pictures ? 'Bilder' : 'Dateien'} anhängen – oder direkt ins Textfeld einfügen`}
        size={size}
        // `aria-disabled`, not `disabled`: a disabled button would drop the focus.
        aria-disabled={off || undefined}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          if (!off) input.current?.click();
        }}
        className={cn(off && 'cursor-default opacity-40')}
      />
    </>
  );
}

/**
 * The files on a field being written, under its words: pictures as small previews, other files
 * as chips with their size – each with ✕; one on its way up fills as it goes (✕ stops it).
 */
export function AttachmentChips({ files, className }: { files: Attachments; className?: string }) {
  if (files.items.length === 0 && !files.error) return null;
  const chip = (one: FieldAttachment) => {
    const going = one.progress !== null;
    // A picture's preview: from the file itself, or – put back after a refusal – from the server.
    const pointed = !!one.attachment && isCloudReference(one.attachment);
    const src =
      one.preview ??
      (one.attachment && !pointed && isPictureAttachment(one.type)
        ? attachmentUrl(one.attachment.id)
        : null);
    const percent = going ? `${Math.round((one.progress ?? 0) * 100)} %` : null;
    const off = (
      <button
        type="button"
        aria-label={going ? `${one.name} nicht anhängen` : `${one.name} entfernen`}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => files.remove(one.key)}
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full text-fg-subtle hover:bg-selected hover:text-fg',
          src &&
            'glass-dark absolute -top-1.5 -right-1.5 opacity-0 group-hover/thumb:opacity-100 focus-visible:opacity-100 max-sm:opacity-100',
        )}
      >
        <Icon name="close" size={14} />
      </button>
    );
    if (src) {
      return (
        <li key={one.key} className="group/thumb relative" aria-busy={going || undefined}>
          <img src={src} alt={one.name} title={one.name} className={THUMB} />
          {going && (
            <span className="glass-dark absolute inset-0 flex items-center justify-center rounded-badge text-xs text-fg">
              {percent}
            </span>
          )}
          {off}
        </li>
      );
    }
    return (
      <li key={one.key} className={CHIP} aria-busy={going || undefined}>
        {going && (
          <span
            aria-hidden
            style={{ width: percent ?? undefined }}
            className="absolute inset-y-0 left-0 bg-selected transition-[width] duration-200"
          />
        )}
        <Icon
          name={one.attachment ? chipIcon(one.attachment) : 'attachFile'}
          size={14}
          className="relative shrink-0 text-fg-subtle"
        />
        <span className="relative truncate" title={pointed ? `${one.name} – aus Cloud` : undefined}>
          {one.name}
        </span>
        {(going || one.type !== CLOUD_FOLDER_TYPE) && (
          <span className="relative shrink-0 text-xs text-fg-subtle">
            {percent ?? formatFileSize(one.size)}
          </span>
        )}
        <span className="relative">{off}</span>
      </li>
    );
  };
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      {files.items.length > 0 && (
        <ul aria-label="Anhänge" className="flex min-w-0 flex-wrap items-center gap-1.5">
          {files.items.map(chip)}
        </ul>
      )}
      {files.error && (
        <ErrorText role="alert" size="xs">
          {files.error}
        </ErrorText>
      )}
    </div>
  );
}

/**
 * The files of something written and sent, under its words: pictures as previews that open in
 * full, other files as chips that download; Cloud files and folders it points to as chips that
 * open them in Cloud.
 */
export function SentAttachments({
  attachments,
  className,
  onDelete,
}: {
  attachments: readonly Attachment[] | undefined;
  className?: string;
  /** Where they stay on what is kept (a to-do): each with ✕ – it asks first. */
  onDelete?: (one: Attachment) => void;
}) {
  const workspace = useActiveWorkspace();
  if (!attachments?.length) return null;
  const off = (one: Attachment, onPicture: boolean) =>
    onDelete && (
      <button
        type="button"
        aria-label={`${one.name} löschen`}
        title="Löschen"
        onClick={() => onDelete(one)}
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full text-fg-subtle hover:bg-selected hover:text-fg',
          onPicture &&
            'glass-dark absolute -top-1.5 -right-1.5 opacity-0 group-hover/thumb:opacity-100 focus-visible:opacity-100 max-sm:opacity-100',
        )}
      >
        <Icon name="close" size={14} />
      </button>
    );
  const pictures = attachments.filter(
    (one) => isPictureAttachment(one.type) && !isCloudReference(one),
  );
  const others = attachments.filter(
    (one) => !isPictureAttachment(one.type) || isCloudReference(one),
  );
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {pictures.length > 0 && (
        <ul aria-label="Bilder" className="flex flex-wrap gap-1.5">
          {pictures.map((one) => (
            <li key={one.id} className="group/thumb relative">
              <a
                href={attachmentUrl(one.id)}
                target="_blank"
                rel="noreferrer"
                title={one.name}
                className="block rounded-badge focus-visible:ring-focus"
              >
                <img
                  src={attachmentUrl(one.id)}
                  alt={one.name}
                  loading="lazy"
                  className={cn(
                    'block max-h-60 max-w-full rounded-badge bg-glass-solid object-contain ring-hairline',
                    pictures.length > 1 && 'size-28 object-cover',
                  )}
                />
              </a>
              {off(one, true)}
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <ul aria-label="Dateien" className="flex min-w-0 flex-wrap gap-1">
          {others.map((one) => (
            <li key={one.id} className="flex max-w-full min-w-0 items-center">
              {isCloudReference(one) && workspace ? (
                <Link
                  to={referenceRoute(workspace.id, one)}
                  title={`${one.name} in Cloud öffnen`}
                  className={cn(CHIP, 'pr-2 hover:bg-selected', onDelete && 'rounded-r-none')}
                >
                  <Icon name={chipIcon(one)} size={14} className="shrink-0 text-fg-subtle" />
                  <span className="truncate">{one.name}</span>
                  {one.type !== CLOUD_FOLDER_TYPE && (
                    <span className="shrink-0 text-xs text-fg-subtle">
                      {formatFileSize(one.size)}
                    </span>
                  )}
                </Link>
              ) : (
                <a
                  href={attachmentUrl(one.id, true)}
                  download={one.name}
                  title={`${one.name} laden`}
                  className={cn(CHIP, 'pr-2 hover:bg-selected', onDelete && 'rounded-r-none')}
                >
                  <Icon name="attachFile" size={14} className="shrink-0 text-fg-subtle" />
                  <span className="truncate">{one.name}</span>
                  <span className="shrink-0 text-xs text-fg-subtle">
                    {formatFileSize(one.size)}
                  </span>
                </a>
              )}
              {onDelete && (
                <span className="flex h-7 items-center rounded-r-chip bg-surface-2 pr-1">
                  {off(one, false)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
