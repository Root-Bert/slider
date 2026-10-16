import { MAX_COMMENT_BODY_LENGTH, type Comment, type MediaKind } from '@slider/shared';
import { useState } from 'react';
import { AutosizeTextarea, Button, Dialog, ErrorText } from '@/ui';
import { replyInput } from '../comments/lib/replies';
import { useViewerToast } from '../state/viewer-toast';
import { MEDIA_LABELS } from './lib/recording';
import { RecorderPanel } from './RecorderPanel';
import { useCreateMediaComment } from './hooks/useMediaComment';
import type { Recording } from './hooks/useRecorder';
import { isModEnter } from '@/lib/keyboard';

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

  // Cancelling (button, Esc, backdrop) also aborts a running upload: nothing is sent.
  const cancel = () => {
    create.cancel();
    onClose();
  };

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
      onClose={cancel}
      title={`${MEDIA_LABELS[kind].noun} an ${root.author.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>
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
        <RecorderPanel kind={kind} deckId={deckId} onChange={setRecording} autoStart autoFocus />
        {recording && (
          <div className="field-well rounded-control-sm px-3 py-2">
            <AutosizeTextarea
              aria-label="Notiz zur Aufnahme"
              maxLength={MAX_COMMENT_BODY_LENGTH}
              placeholder="Optional: Notiz zur Aufnahme"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => {
                if (isModEnter(event)) send();
              }}
              className="text-body leading-5 text-fg"
            />
          </div>
        )}
        {create.error && (
          <ErrorText role="alert" size="xs">
            {create.error.message}
          </ErrorText>
        )}
      </div>
    </Dialog>
  );
}
