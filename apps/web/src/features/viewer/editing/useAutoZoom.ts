import { useZoomToRect } from '../stage/hooks/useZoomToRect';
import { useEditing } from './editing-context';

/**
 * Picking an element too small or too thin to work on zooms its slide in on it; letting it go
 * (or leaving edit mode) zooms back. Off in the settings („Kleine Elemente heranzoomen“).
 */
export function useAutoZoom() {
  const editing = useEditing();
  const element = editing.active ? editing.selectedElement : null;
  const slideId = editing.active ? (editing.selection?.slideId ?? null) : null;
  useZoomToRect(
    element && slideId ? { key: element.id, slideId, rect: element.bbox } : null,
    'autoZoom',
  );
}
