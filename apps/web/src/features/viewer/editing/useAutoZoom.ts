import { useZoomToRect } from '../stage/hooks/useZoomToRect';
import { useEditing } from './editing-context';

/**
 * Picking an element too small or too thin to work on zooms its slide in on it; letting it go
 * (or leaving edit mode) zooms back. Off in the settings („Kleine Elemente heranzoomen“).
 */
export function useAutoZoom() {
  const editing = useEditing();
  // Not in the layers view: its planes are looked at as they are.
  const zooms = editing.active && !editing.layers;
  const element = zooms ? editing.selectedElement : null;
  const slideId = zooms ? (editing.selection?.slideId ?? null) : null;
  useZoomToRect(
    element && slideId ? { key: element.id, slideId, rect: element.bbox } : null,
    'autoZoom',
  );
}
