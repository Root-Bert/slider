import type { EditableElement, LiveElement } from '@slider/shared';
import { memo } from 'react';
import { cn } from '@/ui';
import { groupFrameOf, useEditing } from '../editing-context';
import { usePreviewSelector } from '../preview-store';
import { liveLayerStyle, PT_PER_CM } from './css';
import { LiveElementView } from './render';

/**
 * While editing (Bearbeiten, a template being designed): what each empty placeholder of the
 * slide asks for, greyed, where its text would go – at rest, under the pointer and picked alike;
 * typed in, its editor shows it until the first character. The one thing the editor adds to the
 * slide's look: LibreOffice draws an empty placeholder not at all, so Prüfen, the presentation,
 * thumbnails and exports show nothing there. Only drawn: clicks go to the elements' frames.
 */
export function PromptLayer({ slideId, rounded }: { slideId: string; rounded: string }) {
  const editing = useEditing();
  const empty = editing.active
    ? editing.elementsOf(slideId).filter((element) => element.live?.placeholder)
    : [];
  if (empty.length === 0) return null;
  return (
    <div
      data-prompt-layer={slideId}
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 overflow-hidden select-none', rounded)}
      style={liveLayerStyle(
        editing.pageSize.width * PT_PER_CM,
        editing.pageSize.height * PT_PER_CM,
      )}
    >
      {empty.map((element) => (
        <Prompt
          key={element.id}
          element={element}
          live={element.live!}
          typing={editing.textEditing === element.id}
        />
      ))}
    </div>
  );
}

/** One prompt, where its element is now – also dragged, alone or picked together with others. */
const Prompt = memo(function Prompt({
  element,
  live,
  typing,
}: {
  element: EditableElement;
  live: LiveElement;
  typing: boolean;
}) {
  const preview = usePreviewSelector((preview) =>
    preview?.elementId === element.id || preview?.group?.elementIds.includes(element.id)
      ? preview
      : null,
  );
  // Typed in: its editor shows the prompt (`InlineTextEditor`).
  if (typing) return null;
  const shown: EditableElement = !preview
    ? element
    : preview.elementId === element.id
      ? {
          ...element,
          bbox: preview.rect,
          rotation: preview.rotation ?? element.rotation,
          flip: preview.flip ?? element.flip,
          tilt: preview.tilt !== undefined ? preview.tilt : element.tilt,
        }
      : { ...element, ...groupFrameOf(preview, element) };
  return <LiveElementView element={shown} live={live} textOnly prompt="alone" />;
});
