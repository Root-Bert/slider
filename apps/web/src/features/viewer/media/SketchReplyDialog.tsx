import type { Comment } from '@slider/shared';
import { useState } from 'react';
import { Button, Dialog } from '@/ui';
import { AutosizeTextarea } from '../components/AutosizeTextarea';
import { replyInput } from '../lib/replies';
import { useViewerData } from '../state/viewer-data';
import { useViewerToast } from '../state/viewer-toast';
import { DEFAULT_SKETCH_ASPECT, exportSketch } from './sketch';
import { SketchPanel, type Sketch } from './SketchPanel';
import { useCreateMediaComment } from './useMediaComment';

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
      { input: replyInput(root, note), recording: memo, image: () => exportSketch(strokes, aspect) },
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
          aspect={aspect}
          onChange={setSketch}
          autoFocus
        />
        <div className="rounded-control-sm bg-white/5 px-3 py-2 shadow-[inset_0_0_0_1px_var(--color-hairline-strong)]">
          <AutosizeTextarea
            aria-label="Notiz zum Bild"
            placeholder="Optional: Notiz zum Bild"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) send();
            }}
            className="text-[13px] leading-5 text-fg"
          />
        </div>
        {create.error && (
          <p role="alert" className="text-xs text-danger">
            {create.error.message}
          </p>
        )}
      </div>
    </Dialog>
  );
}
