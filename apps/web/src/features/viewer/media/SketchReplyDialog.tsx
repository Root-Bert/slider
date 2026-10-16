import { MAX_COMMENT_BODY_LENGTH, type Comment } from '@slider/shared';
import { useState } from 'react';
import { AutosizeTextarea, Button, Dialog, ErrorText } from '@/ui';
import { replyInput } from '../comments/lib/replies';
import { useViewerData } from '../state/viewer-data';
import { useViewerToast } from '../state/viewer-toast';
import { DEFAULT_SKETCH_ASPECT, exportSketch } from './lib/sketch';
import { SketchPanel, type Sketch } from './SketchPanel';
import { useCreateMediaComment } from './hooks/useMediaComment';
import { isModEnter } from '@/lib/keyboard';

/** Reply to a thread with a drawn image, optionally with a voice memo recorded while drawing. */
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
  const create = useCreateMediaComment(deckId);
  const showToast = useViewerToast();

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
        image: () => exportSketch(strokes, aspect),
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
        <div className="field-well rounded-control-sm px-3 py-2">
          <AutosizeTextarea
            aria-label="Notiz zum Bild"
            maxLength={MAX_COMMENT_BODY_LENGTH}
            placeholder="Optional: Notiz zum Bild"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (isModEnter(event)) send();
            }}
            className="text-body leading-5 text-fg"
          />
        </div>
        {create.error && (
          <ErrorText role="alert" size="xs">
            {create.error.message}
          </ErrorText>
        )}
      </div>
    </Dialog>
  );
}
