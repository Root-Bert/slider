import type { EditableElement } from '@slider/shared';
import { useEditing } from '../editing-context';
import { useTiltRefresh } from './useTilt';

/**
 * Draws tilted elements anew once they changed (`useTiltRefresh`) – picked or not: typed in on
 * the slide and let go, its tilted picture still follows, also once „Bearbeiten“ is left. The
 * picked one is always watched while editing, so an undone change is drawn anew too.
 */
export function TiltRefreshes() {
  const editing = useEditing();
  // Changed ones also after leaving „Bearbeiten“: review shows them as they are now too.
  if (!editing.available) return null;
  const watched = new Map(editing.retilting);
  const picked = editing.active ? editing.selectedElement : null;
  if (picked?.tilt && editing.selection) watched.set(picked.id, editing.selection.slideId);
  return [...watched].map(([elementId, slideId]) => {
    const element = editing.elementsOf(slideId).find((item) => item.id === elementId);
    return element ? <TiltRefresh key={elementId} element={element} slideId={slideId} /> : null;
  });
}

function TiltRefresh({ element, slideId }: { element: EditableElement; slideId: string }) {
  const { retilted } = useEditing();
  useTiltRefresh(element, slideId, () => retilted(element.id));
  return null;
}
