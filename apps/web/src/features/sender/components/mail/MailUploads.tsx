import type { MailAttachment } from '@slider/shared';
import { formatFileSize } from '@/lib/format';
import { cn, Icon } from '@/ui';
import type { PendingUpload } from '../../hooks/useMailUploads';

const CHIP =
  'relative inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-chip bg-surface-2 pr-1 pl-2 text-body text-fg';

/**
 * The files on a mail being written, as chips that wrap: each with its size and ✕; one on its way
 * up fills as it goes (✕ stops it).
 */
export function MailUploads({
  uploads,
  pending,
  onRemove,
  className,
}: {
  uploads: readonly MailAttachment[];
  pending: readonly PendingUpload[];
  onRemove: (id: string) => void;
  className?: string;
}) {
  if (uploads.length + pending.length === 0) return null;
  const chip = (id: string, name: string, size: number, progress?: number) => (
    <li key={id} className={CHIP} aria-busy={progress !== undefined || undefined}>
      {progress !== undefined && (
        <span
          aria-hidden
          style={{ width: `${Math.round(progress * 100)}%` }}
          className="absolute inset-y-0 left-0 bg-selected transition-[width] duration-200"
        />
      )}
      <Icon name="attachFile" size={14} className="relative shrink-0 text-fg-subtle" />
      <span className="relative truncate">{name}</span>
      <span className="relative shrink-0 text-xs text-fg-subtle">
        {progress !== undefined ? `${Math.round(progress * 100)} %` : formatFileSize(size)}
      </span>
      <button
        type="button"
        aria-label={progress !== undefined ? `${name} nicht anhängen` : `${name} entfernen`}
        onClick={() => onRemove(id)}
        className="relative flex size-5 shrink-0 items-center justify-center rounded-full text-fg-subtle hover:bg-selected hover:text-fg"
      >
        <Icon name="close" size={14} />
      </button>
    </li>
  );
  return (
    <ul aria-label="Anhänge" className={cn('flex min-w-0 flex-wrap items-center gap-1', className)}>
      {uploads.map((one) => chip(one.id, one.name, one.size))}
      {pending.map((one) => chip(one.key, one.name, one.size, one.progress))}
    </ul>
  );
}
