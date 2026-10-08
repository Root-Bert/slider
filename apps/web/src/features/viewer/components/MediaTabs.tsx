import type { Comment, MediaKind as RecordingKind } from '@slider/shared';
import { useState } from 'react';
import { cn, Icon } from '@/ui';
import { MEDIA_KINDS, MEDIA_SOON, type MediaKindId } from '../lib/media-kinds';
import { RecordReplyDialog } from '../media/RecordReplyDialog';

/** Text / Audio / Video / Bild switch of the composers (Figma B2, B4 "Tabs"). */
export function MediaTabs({
  value,
  onChange,
  className,
}: {
  value: MediaKindId;
  onChange: (kind: MediaKindId) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="Kommentarart"
      className={cn('flex w-fit items-center gap-1 rounded-control bg-white/5 p-1', className)}
    >
      {MEDIA_KINDS.map((kind) => {
        const selected = kind.id === value;
        return (
          <button
            key={kind.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-disabled={!kind.enabled || undefined}
            tabIndex={kind.enabled ? 0 : -1}
            title={kind.enabled ? undefined : MEDIA_SOON}
            onClick={() => kind.enabled && onChange(kind.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-chip py-1.5 pr-3 pl-2.5 text-xs font-medium',
              !kind.enabled
                ? 'cursor-not-allowed text-fg-subtle'
                : selected
                  ? 'bg-white/12 text-fg'
                  : 'text-fg-muted hover:bg-white/5 hover:text-fg',
            )}
          >
            <Icon name={kind.icon} size={16} />
            {kind.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Audio / Video / Bild icons beside a reply field. Text needs no button – typing is the text
 * reply. Mic and camera open the recorder; images stay disabled for now.
 */
export function MediaReplyButtons({
  root,
  deckId,
  size = 'sm',
}: {
  root: Comment;
  deckId: string;
  size?: 'sm' | 'md';
}) {
  const [recording, setRecording] = useState<RecordingKind | null>(null);
  return (
    <>
      {MEDIA_KINDS.filter((kind) => kind.id !== 'text').map((kind) =>
        kind.id === 'audio' || kind.id === 'video' ? (
          <button
            key={kind.id}
            type="button"
            aria-label={
              kind.id === 'audio' ? 'Mit Sprachkommentar antworten' : 'Mit Video antworten'
            }
            title={kind.id === 'audio' ? 'Sprachkommentar' : 'Video'}
            onClick={() => setRecording(kind.id as RecordingKind)}
            className={cn(
              'flex shrink-0 items-center justify-center rounded-chip text-fg-subtle hover:bg-white/10 hover:text-fg',
              size === 'sm' ? 'size-7' : 'size-8',
            )}
          >
            <Icon name={kind.icon} size={18} />
          </button>
        ) : (
          <button
            key={kind.id}
            type="button"
            aria-label={`${kind.label} – ${MEDIA_SOON}`}
            aria-disabled
            tabIndex={-1}
            title={MEDIA_SOON}
            className={cn(
              'flex shrink-0 cursor-not-allowed items-center justify-center rounded-chip text-fg-faint',
              size === 'sm' ? 'size-7' : 'size-8',
            )}
          >
            <Icon name={kind.icon} size={18} />
          </button>
        ),
      )}
      {recording && (
        <RecordReplyDialog
          root={root}
          deckId={deckId}
          kind={recording}
          onClose={() => setRecording(null)}
        />
      )}
    </>
  );
}
