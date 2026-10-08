import type { Comment, MediaKind } from '@slider/shared';
import { useState } from 'react';
import { Button, Dialog } from '@/ui';
import { AutosizeTextarea } from '../components/AutosizeTextarea';
import { replyInput } from '../lib/replies';
import { useViewerToast } from '../state/viewer-toast';
import { MEDIA_LABELS } from './recording';
import { RecorderPanel } from './RecorderPanel';
import { useCreateMediaComment } from './useMediaComment';
import type { Recording } from './useRecorder';

/** Voice or video reply to a thread (BER-116, Figma B3 "Antworten in jedem Format"). */
export function RecordReplyDialog({
  root,
  deckId,
  kind,
  onClose,
}: {
  root: Comment;
  deckId: string;
  kind: MediaKind;
  onClose: () => void;
}) {
  const [recording, setRecording] = useState<Recording | null>(null);
  const [note, setNote] = useState('');
  const create = useCreateMediaComment(deckId);
  const showToast = useViewerToast();

  const send = () => {
    if (!recording || create.isPending) return;
    create.mutate(
      { input: replyInput(root, note), recording },
      {
        onSuccess: () => {
          showToast(`${MEDIA_LABELS[kind].noun} gesendet`);
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open
      onClose={() => !create.isPending && onClose()}
      title={`${MEDIA_LABELS[kind].noun} an ${root.author.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            Abbrechen
          </Button>
          <Button onClick={send} disabled={!recording} loading={create.isPending}>
            {create.isPending && create.progress > 0 && create.progress < 1
              ? `${Math.round(create.progress * 100)} %`
              : 'Senden'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <RecorderPanel kind={kind} deckId={deckId} onChange={setRecording} autoStart />
        {recording && (
          <div className="rounded-control-sm bg-white/5 px-3 py-2 shadow-[inset_0_0_0_1px_var(--color-hairline-strong)]">
            <AutosizeTextarea
              aria-label="Notiz zur Aufnahme"
              placeholder="Optional: Notiz zur Aufnahme"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) send();
              }}
              className="text-[13px] leading-5 text-fg"
            />
          </div>
        )}
        {create.isError && (
          <p role="alert" className="text-xs text-danger">
            {create.error.message}
          </p>
        )}
      </div>
    </Dialog>
  );
}
