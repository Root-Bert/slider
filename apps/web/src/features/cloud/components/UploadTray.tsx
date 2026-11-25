import { useState } from 'react';
import { cloudFileType } from '@slider/shared';
import { formatFileSize } from '@/lib/format';
import { cn, Icon, IconButton, ProgressBar } from '@/ui';
import type { Uploads } from '../hooks/useUploads';
import { FileIcon } from './FileIcon';

/**
 * The uploads under way, bottom right: one line saying how far they are, the files below it –
 * each with its bar, a way to stop it and, when it failed, why and a retry. Stays until closed
 * once everything is through, so what failed is not missed. PDFs the server makes („Als PDF
 * ablegen“) stand here alike, without bytes to count or a way to stop them.
 */
export function UploadTray({
  uploads,
  onOpen,
}: {
  uploads: Uploads;
  onOpen: (nodeId: string) => void;
}) {
  const [folded, setFolded] = useState(false);
  const { items } = uploads;
  if (items.length === 0) return null;
  const done = items.filter((item) => item.status === 'done').length;
  const failed = items.filter((item) => item.status === 'failed').length;
  const total = items.reduce((sum, item) => sum + item.size, 0);
  const sent = items.reduce((sum, item) => sum + Math.min(item.sent, item.size), 0);
  const pdfs = items.every((item) => item.made);
  const title = pdfs
    ? uploads.busy
      ? `${done} von ${items.length} PDFs abgelegt`
      : failed > 0
        ? `${failed} ${failed === 1 ? 'PDF' : 'PDFs'} nicht abgelegt`
        : items.length === 1
          ? '1 PDF abgelegt'
          : `${items.length} PDFs abgelegt`
    : uploads.busy
      ? `${done} von ${items.length} hochgeladen`
      : failed > 0
        ? `${failed} ${failed === 1 ? 'Upload' : 'Uploads'} fehlgeschlagen`
        : items.length === 1
          ? '1 Datei hochgeladen'
          : `${items.length} Dateien hochgeladen`;
  // What goes up can be stopped; what the server makes cannot.
  const stoppable = items.some(
    (item) => !item.made && (item.status === 'waiting' || item.status === 'sending'),
  );

  return (
    <section
      aria-label="Uploads"
      className="glass-elevated fixed right-6 bottom-6 z-(--z-popover) flex w-[min(360px,calc(100vw-32px))] flex-col overflow-hidden rounded-panel"
    >
      <header className="flex items-center gap-2 py-2 pr-2 pl-4">
        <Icon
          name={
            uploads.busy ? (pdfs ? 'pictureAsPdf' : 'upload') : failed > 0 ? 'error' : 'checkCircle'
          }
          size={18}
          className={cn(
            'shrink-0',
            uploads.busy ? 'text-fg-muted' : failed > 0 ? 'text-danger' : 'text-success',
          )}
        />
        <p className="min-w-0 flex-1 truncate text-body font-medium text-fg" aria-live="polite">
          {title}
          {uploads.busy && total > 0 && (
            <span className="font-normal text-fg-subtle tabular-nums">
              {' '}
              | {Math.floor((sent / total) * 100)} %
            </span>
          )}
        </p>
        <IconButton
          icon={folded ? 'expandLess' : 'expandMore'}
          label={folded ? 'Uploads zeigen' : 'Uploads einklappen'}
          size="compact"
          onClick={() => setFolded(!folded)}
        />
        <IconButton
          icon="close"
          label={stoppable ? 'Alle Uploads abbrechen' : 'Schließen'}
          size="compact"
          onClick={uploads.clear}
        />
      </header>
      {uploads.busy && total > 0 && <ProgressBar value={sent / total} label="Uploads" />}
      {!folded && (
        <ul className="flex max-h-[min(320px,40vh)] flex-col overflow-y-auto border-t border-hairline p-1.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="group flex min-h-11 items-center gap-2.5 rounded-control-sm px-2 py-1.5 hover:bg-surface-1"
            >
              <FileIcon kind="file" type={cloudFileType(item.name)} size={32} />
              <div className="flex min-w-0 flex-1 flex-col">
                {item.node ? (
                  <button
                    type="button"
                    className="truncate text-left text-body text-fg hover:underline"
                    onClick={() => item.node && onOpen(item.node.id)}
                  >
                    {item.node.name}
                  </button>
                ) : (
                  <span className="truncate text-body text-fg">{item.name}</span>
                )}
                <span
                  className={cn(
                    'truncate text-caption',
                    item.status === 'failed' ? 'text-danger' : 'text-fg-subtle',
                  )}
                >
                  {item.status === 'failed'
                    ? item.error
                    : item.status === 'done'
                      ? item.created === false
                        ? `Neue Fassung | ${formatFileSize(item.size)}`
                        : formatFileSize(item.size)
                      : item.made
                        ? 'Wird erstellt'
                        : item.status === 'waiting'
                          ? 'Wartet'
                          : `${formatFileSize(item.sent)} von ${formatFileSize(item.size)}`}
                </span>
              </div>
              {item.status === 'failed' && !item.made && (
                <IconButton
                  icon="refresh"
                  label={`${item.name} noch einmal hochladen`}
                  size="compact"
                  onClick={() => uploads.retry(item.id)}
                />
              )}
              {item.status === 'done' ? (
                <Icon name="check" size={16} className="mr-1.5 shrink-0 text-success" />
              ) : item.made ? null : (
                <IconButton
                  icon="close"
                  label={`Upload von ${item.name} abbrechen`}
                  size="compact"
                  onClick={() => uploads.cancel(item.id)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
