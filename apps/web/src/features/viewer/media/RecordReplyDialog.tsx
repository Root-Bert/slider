import type { Comment, MediaKind } from '@slider/shared';
import { useState } from 'react';
import { Button, Dialog, ErrorText } from '@/ui';
import { replyInput } from '../comments/lib/replies';
import { useViewerToast } from '../state/viewer-toast';
import { MEDIA_LABELS } from './lib/recording';
import { RecorderPanel } from './RecorderPanel';
import { useCreateMediaComment } from './hooks/useMediaComment';
import { asUploads, useImageAttachments } from './hooks/useImageAttachments';
import { NoteField } from './NoteField';
import { useHoldUnsavedWork } from '../lib/unsaved-work';
import type { Recording } from './hooks/useRecorder';

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
  const [recordingRunning, setRecordingRunning] = useState(false);
  const [note, setNote] = useState('');
  const images = useImageAttachments();
  const create = useCreateMediaComment(deckId);
  const showToast = useViewerToast();
  // Leaving the review would drop the recording and abort its upload: ask first.
  useHoldUnsavedWork(
    recording !== null || recordingRunning || images.attachments.length > 0 || create.isPending,
  );

  // Cancelling (button, Esc, backdrop) also aborts a running upload: nothing is sent.
  const cancel = () => {
    create.cancel();
    onClose();
  };

  const send = () => {
    if (!recording || create.isPending) return;
    create.mutate(
      {
        input: replyInput(root, note),
        recording,
        images: asUploads(images.attachments),
      },
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
        <RecorderPanel
          kind={kind}
          deckId={deckId}
          onChange={setRecording}
          onRecordingChange={setRecordingRunning}
          autoStart
          autoFocus
        />
        {recording && (
          <NoteField
            label="Notiz zur Aufnahme"
            value={note}
            onChange={setNote}
            onSend={send}
            images={images}
            disabled={create.isPending}
          />
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
