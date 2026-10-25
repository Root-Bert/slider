import type { Comment } from '@slider/shared';
import { useState } from 'react';
import { Button, Dialog, ErrorText } from '@/ui';
import { replyInput } from '../comments/lib/replies';
import { useViewerData } from '../state/viewer-data';
import { useViewerToast } from '../state/viewer-toast';
import { DEFAULT_SKETCH_ASPECT, exportSketch } from './lib/sketch';
import { SketchPanel, type Sketch } from './SketchPanel';
import { useCreateMediaComment } from './hooks/useMediaComment';
import { asUploads, useImageAttachments } from './hooks/useImageAttachments';
import { NoteField } from './NoteField';
import { useHoldUnsavedWork } from '../lib/unsaved-work';

/**
 * Reply to a thread with a drawn image, optionally with a voice memo recorded while drawing and
 * images pasted into or picked for the note.
 */
export function SketchReplyDialog({
  root,
  deckId,
  onClose,
}: {
  root: Comment;
  deckId: string;
  onClose: () => void;
}) {
  const { viewer, slides } = useViewerData();
  // The sheet takes the format of the thread's slide.
  const aspect =
    slides.find((slide) => slide.id === root.slideId)?.aspectRatio ?? DEFAULT_SKETCH_ASPECT;
  const [sketch, setSketch] = useState<Sketch | null>(null);
  const [note, setNote] = useState('');
  // The sketch takes one of the comment's image places.
  const images = useImageAttachments(1);
  const create = useCreateMediaComment(deckId);
  const showToast = useViewerToast();
  // Leaving the review would drop the sketch and abort its upload: ask first.
  useHoldUnsavedWork(
    sketch !== null || note.trim() !== '' || images.attachments.length > 0 || create.isPending,
  );

  // Cancelling (button, Esc, backdrop) also aborts a running upload: nothing is sent.
  const cancel = () => {
    create.cancel();
    onClose();
  };

  const send = () => {
    if (!sketch || create.isPending) return;
    const { strokes, memo } = sketch;
    create.mutate(
      {
        input: replyInput(root, note),
        recording: memo,
        images: [() => exportSketch(strokes, aspect), ...asUploads(images.attachments)],
      },
      {
        onSuccess: () => {
          showToast('Bild gesendet');
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open
      onClose={cancel}
      title={`Bild an ${root.author.name}`}
      className="w-[min(560px,calc(100vw-32px))] max-w-none"
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>
            Abbrechen
          </Button>
          <Button onClick={send} disabled={!sketch} loading={create.isPending}>
            {create.isPending && create.progress > 0 && create.progress < 1
              ? `${Math.round(create.progress * 100)} %`
              : 'Senden'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <SketchPanel
          deckId={deckId}
          color={viewer.author.color}
          authorName={viewer.author.name}
          aspect={aspect}
          onChange={setSketch}
          autoFocus
          actions={{
            canSend: sketch !== null,
            pending: create.isPending,
            onSend: send,
            onCancel: cancel,
          }}
        />
        <NoteField
          label="Notiz zum Bild"
          value={note}
          onChange={setNote}
          onSend={send}
          images={images}
          disabled={create.isPending}
        />
        {create.error && (
          <ErrorText role="alert" size="xs">
            {create.error.message}
          </ErrorText>
        )}
      </div>
    </Dialog>
  );
}
