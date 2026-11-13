import { useEffect, useEffectEvent, useRef } from 'react';
import { useEditing } from '../../editing/editing-context';
import { spaceTaps } from '../../lib/space-taps';
import type { SlideZoom } from '../../stage/lib/slide-zoom';
import { useViewerData } from '../../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../../state/viewer-state';
import { useViewerStore } from '../../state/viewer-store';

/**
 * Space tapped twice: the active slide back at 100 % – and tapped twice again, back to the zoom
 * it had last, however it came to 100 % (Space, its chip, the wheel). Not in the layers view
 * (there it turns the slide to the front, `LayersProvider`), nor while typing.
 */
export function useZoomToggle(enabled: boolean) {
  const editing = useEditing();
  const { slides } = useViewerData();
  const { activeSlideId } = useViewerState();
  const store = useViewerStore();
  const dispatch = useViewerDispatch();
  // The zoom each slide had last, other than 100 %.
  const last = useRef(new Map<string, SlideZoom>());
  useEffect(() => {
    let remembered: ReadonlyMap<string, SlideZoom> | null = null;
    const remember = () => {
      const zooms = store.getState().slideZooms;
      if (zooms === remembered) return;
      remembered = zooms;
      for (const [slideId, zoom] of zooms) last.current.set(slideId, zoom);
    };
    remember();
    return store.subscribe(remember);
  }, [store]);
  const twice = useRef(spaceTaps());

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (!twice.current(event)) return;
    const slideId = activeSlideId ?? slides[0]?.id;
    if (!slideId) return;
    if (store.getState().slideZooms.has(slideId)) {
      dispatch({ type: 'slideZoomChanged', slideId, zoom: null });
      return;
    }
    const back = last.current.get(slideId);
    if (back) dispatch({ type: 'slideZoomChanged', slideId, zoom: back });
  });

  const on = enabled && !editing.layers;
  useEffect(() => {
    if (!on) return;
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener('keydown', listener);
    window.addEventListener('keyup', listener);
    return () => {
      window.removeEventListener('keydown', listener);
      window.removeEventListener('keyup', listener);
    };
  }, [on]);
}
