import type { Comment, MediaKind as RecordingKind } from '@slider/shared';
import { useState } from 'react';
import { IconButton, SegmentedControl } from '@/ui';
import { MEDIA_KINDS, MEDIA_SOON, type MediaKindId } from './lib/media-kinds';
import { RecordReplyDialog } from '../media/RecordReplyDialog';
import { SketchReplyDialog } from '../media/SketchReplyDialog';

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
    <SegmentedControl<MediaKindId>
      label="Kommentarart"
      mode="tabs"
      size="sm"
      track="soft"
      value={value}
      onChange={onChange}
      segments={MEDIA_KINDS.map((kind) => ({
        value: kind.id,
        label: kind.label,
        icon: kind.icon,
        disabled: !kind.enabled,
        ...(kind.enabled ? {} : { title: MEDIA_SOON }),
      }))}
      className={className}
    />
  );
}

const REPLY_LABELS: Record<Exclude<MediaKindId, 'text'>, { label: string; title: string }> = {
  audio: { label: 'Mit Sprachkommentar antworten', title: 'Sprachkommentar' },
  video: { label: 'Mit Video antworten', title: 'Video' },
  image: { label: 'Mit Bild antworten', title: 'Bild zeichnen' },
};

/**
 * Audio / Video / Bild icons beside a reply field. Text needs no button – typing is the text
 * reply. Mic and camera open the recorder, Bild the sheet to draw on.
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
  const [open, setOpen] = useState<Exclude<MediaKindId, 'text'> | null>(null);
  return (
    <>
      {MEDIA_KINDS.filter((kind) => kind.id !== 'text').map((kind) => {
        const id = kind.id as Exclude<MediaKindId, 'text'>;
        return (
          <IconButton
            key={id}
            icon={kind.icon}
            label={REPLY_LABELS[id].label}
            title={REPLY_LABELS[id].title}
            variant="subtle"
            size={size === 'sm' ? 'compact' : 'sm'}
            iconSize={18}
            onClick={() => setOpen(id)}
          />
        );
      })}
      {(open === 'audio' || open === 'video') && (
        <RecordReplyDialog
          root={root}
          deckId={deckId}
          kind={open satisfies RecordingKind}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'image' && (
        <SketchReplyDialog root={root} deckId={deckId} onClose={() => setOpen(null)} />
      )}
    </>
  );
}
