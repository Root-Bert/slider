import { IMAGE_PROMPT_MAX, type EditableElement } from '@slider/shared';
import { useEffect, useRef, useState } from 'react';
import { useGenerateEditImage } from '@/lib/api';
import { AutosizeTextarea, Button } from '@/ui';
import { useViewerData } from '../../state/viewer-data';
import { useViewerToast } from '../../state/viewer-toast';
import { useEditing } from '../editing-context';

/**
 * Generating a picture for a picture frame (in the format bar) with the workspace's key for it
 * (Integrationen → Bildgenerierung): a description, ↵ or „Erzeugen“ – the picture comes cut to
 * the frame's proportions. The description stays for another try.
 */
export function GenerateImage({
  element,
  initialPrompt = '',
  prompt: given,
}: {
  element: EditableElement;
  /** Typed already (into the new frame): the description goes on from it. */
  initialPrompt?: string;
  /** Set from outside (a frame's preview): shown as the description. */
  prompt?: string;
}) {
  const editing = useEditing();
  const { deck } = useViewerData();
  const toast = useViewerToast();
  const generate = useGenerateEditImage(deck.id);
  const [typed, setPrompt] = useState(initialPrompt);
  const prompt = given ?? typed;
  const { w, h } = element.bbox;
  const aspect = h > 0 ? (w * editing.pageSize.width) / (h * editing.pageSize.height) : null;

  const submit = async (text: string) => {
    if (generate.isPending) return;
    try {
      const image = await generate.mutateAsync({ prompt: text, aspect });
      await editing.apply([
        { type: 'replaceImage', elementId: element.id, imageId: image.imageId },
      ]);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Das Bild ging nicht.', 'danger');
    }
  };

  return (
    <ImagePrompt
      prompt={prompt}
      onPrompt={setPrompt}
      pending={generate.isPending}
      onSubmit={(text) => void submit(text)}
    />
  );
}

/**
 * The description of a picture to generate and „Erzeugen“ – a slide's picture frame and a
 * document's picture (Writer) alike. ↵ generates, ⇧↵ is a new line; the caret after what is there.
 */
export function ImagePrompt({
  prompt,
  onPrompt,
  pending,
  onSubmit,
}: {
  prompt: string;
  onPrompt: (prompt: string) => void;
  pending: boolean;
  onSubmit: (prompt: string) => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const end = field.current?.value.length ?? 0;
    field.current?.setSelectionRange(end, end);
  }, []);
  const submit = () => {
    if (prompt.trim() && !pending) onSubmit(prompt.trim());
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="field-well focus-field rounded-control-sm px-3 py-2">
        <AutosizeTextarea
          autoFocus
          ref={field}
          aria-label="Bildbeschreibung"
          placeholder="Was soll das Bild zeigen? z. B. Team am Whiteboard, Aquarell"
          maxLength={IMAGE_PROMPT_MAX}
          value={prompt}
          disabled={pending}
          onChange={(event) => onPrompt(event.target.value)}
          onKeyDown={(event) => {
            // ↵ generates, ⇧↵ is a new line – as in the comments.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          className="text-xs leading-5 text-fg"
        />
      </div>
      <Button
        size="sm"
        variant="primary"
        icon="autoAwesome"
        loading={pending}
        disabled={!prompt.trim()}
        onClick={submit}
      >
        {pending ? 'Wird erzeugt …' : 'Erzeugen'}
      </Button>
    </div>
  );
}
