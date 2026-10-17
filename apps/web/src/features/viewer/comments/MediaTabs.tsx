import type { Comment, MediaKind as RecordingKind } from '@slider/shared';
import { IconButton, SegmentedControl } from '@/ui';
import { useKeepThreadListed } from './hooks/useKeepThreadListed';
import { MEDIA_KINDS, MEDIA_SOON, type MediaKindId } from './lib/media-kinds';
import { RecordReplyDialog } from '../media/RecordReplyDialog';
import { SketchReplyDialog } from '../media/SketchReplyDialog';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState, type MediaReply } from '../state/viewer-state';

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

const REPLY_LABELS: Record<MediaReply['kind'], { label: string; title: string }> = {
  audio: { label: 'Mit Sprachkommentar antworten', title: 'Sprachkommentar' },
  video: { label: 'Mit Video antworten', title: 'Video' },
  image: { label: 'Mit Bild antworten', title: 'Bild zeichnen' },
};

/**
 * Audio / Video / Bild icons beside a reply field. Text needs no button – typing is the text
 * reply. Mic and camera open the recorder, Bild the sheet to draw on – in `MediaReplyDialog`,
 * which outlives this field (the card may be windowed out or turn compact meanwhile).
 */
export function MediaReplyButtons({ root, size = 'sm' }: { root: Comment; size?: 'sm' | 'md' }) {
  const dispatch = useViewerDispatch();
  return (
    <>
      {MEDIA_KINDS.filter((kind) => kind.id !== 'text').map((kind) => {
        const id = kind.id as MediaReply['kind'];
        return (
          <IconButton
            key={id}
            icon={kind.icon}
            label={REPLY_LABELS[id].label}
            title={REPLY_LABELS[id].title}
            variant="subtle"
            size={size === 'sm' ? 'compact' : 'sm'}
            iconSize={18}
            onClick={() =>
              dispatch({ type: 'mediaReplyOpened', reply: { threadId: root.id, kind: id } })
            }
          />
        );
      })}
    </>
  );
}

/** The open voice, video or sketch reply dialog (`mediaReply`), rendered once by the viewer. */
export function MediaReplyDialog() {
  const { mediaReply } = useViewerState();
  const { deck, threadById } = useViewerData();
  const thread = mediaReply ? threadById.get(mediaReply.threadId) : undefined;
  if (!mediaReply || !thread) return null;
  return (
    <MediaReplyDialogView
      key={`${thread.id}:${mediaReply.kind}`}
      root={thread.root}
      deckId={deck.id}
      kind={mediaReply.kind}
    />
  );
}

function MediaReplyDialogView({
  root,
  deckId,
  kind,
}: {
  root: Comment;
  deckId: string;
  kind: MediaReply['kind'];
}) {
  const dispatch = useViewerDispatch();
  // Resolved by someone else mid-recording: the thread stays listed with its card.
  useKeepThreadListed(root.id, true);
  const close = () => dispatch({ type: 'mediaReplyClosed' });
  return kind === 'image' ? (
    <SketchReplyDialog root={root} deckId={deckId} onClose={close} />
  ) : (
    <RecordReplyDialog
      root={root}
      deckId={deckId}
      kind={kind satisfies RecordingKind}
      onClose={close}
    />
  );
}
