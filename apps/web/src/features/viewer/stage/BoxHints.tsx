import { useEditing } from '../editing/editing-context';
import { coversSlide } from './lib/covers-slide';
import type { SlideBox } from './hooks/useSlideBoxes';
import { ShapeOutline } from './ShapeOutline';

/**
 * Box mode: every box of the slide faintly outlined, also the empty ones, so they can be found
 * before the pointer comes over them – the same boxes in review and while editing
 * (`useSlideBoxes`). One spanning the whole slide (a background) is left out, and so is
 * `hoveredId`, outlined in colour; while editing also the picked element and the one typed in,
 * outlined by their own frame or editor. The outline takes its contrast from what lies under it
 * (`ShapeOutline`, `faint`): it must sit next to the slide picture, not inside a layer of its own.
 * Never a pointer target.
 */
export function BoxHints({
  slideId,
  boxes,
  hoveredId,
}: {
  slideId: string;
  boxes: readonly SlideBox[];
  hoveredId?: string | null;
}) {
  const editing = useEditing();
  const picked =
    editing.active && editing.selection?.slideId === slideId ? editing.selectedElement : null;
  const typedIn = editing.active ? editing.textEditing : null;
  return boxes
    .filter(
      (box) =>
        box.id !== hoveredId && box.id !== picked?.id && box.id !== typedIn && !coversSlide(box),
    )
    .map((box) => <ShapeOutline key={box.id} shape={box} variant="faint" />);
}
