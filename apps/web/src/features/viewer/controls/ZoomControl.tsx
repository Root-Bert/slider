import { GlassPanel, Icon } from '@/ui';
import { sliderToZoom, stepZoom, zoomToSlider } from '../lib/zoom';
import { useViewerDispatch, useViewerState, ZOOM_MAX, ZOOM_MIN } from '../state/viewer-state';

/**
 * Zoom pill (BER-96, Figma 87:359): ›‹ – slider – ‹› is a timeline zoom of the slide row, from
 * Desktop-1 (one big slide, right end) to Desktop-7 (several small ones, left end). Hidden on
 * phones, where slides always fill the width.
 */
export function ZoomControl() {
  const { zoom } = useViewerState();
  const dispatch = useViewerDispatch();
  const setZoom = (value: number) => dispatch({ type: 'zoomChanged', zoom: value });

  // While the thumb is dragged the stage keeps its height, so the pill stays under the pointer.
  // `pointerup` may happen anywhere on the page, hence the window listeners.
  const startDrag = () => {
    dispatch({ type: 'zoomGestureChanged', active: true });
    const end = () => {
      dispatch({ type: 'zoomGestureChanged', active: false });
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  return (
    <GlassPanel className="flex items-center gap-4 px-4 py-1 max-md:hidden">
      <button
        type="button"
        aria-label="Verkleinern"
        title="Verkleinern"
        disabled={zoom <= ZOOM_MIN}
        onClick={() => setZoom(stepZoom(zoom, -1))}
        className="flex size-6 items-center justify-center rounded text-fg-muted hover:text-fg disabled:opacity-40"
      >
        <Icon name="unfoldLess" size={24} className="-rotate-90" />
      </button>
      <input
        type="range"
        aria-label="Zoom"
        aria-valuetext={`${Math.round((zoom / ZOOM_MAX) * 100)} %`}
        min={0}
        max={1}
        step={0.01}
        value={zoomToSlider(zoom)}
        onChange={(event) => setZoom(sliderToZoom(Number(event.target.value)))}
        onPointerDown={startDrag}
        className={[
          'h-6 w-32 cursor-pointer appearance-none bg-transparent',
          '[&::-webkit-slider-runnable-track]:h-0.5 [&::-webkit-slider-runnable-track]:rounded [&::-webkit-slider-runnable-track]:bg-[rgb(217_217_217/0.5)]',
          '[&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-1 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded [&::-webkit-slider-thumb]:bg-[rgb(217_217_217/0.7)] hover:[&::-webkit-slider-thumb]:bg-white',
          '[&::-moz-range-track]:h-0.5 [&::-moz-range-track]:rounded [&::-moz-range-track]:bg-[rgb(217_217_217/0.5)]',
          '[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-1 [&::-moz-range-thumb]:rounded [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[rgb(217_217_217/0.7)] hover:[&::-moz-range-thumb]:bg-white',
        ].join(' ')}
      />
      <button
        type="button"
        aria-label="Vergrößern"
        title="Vergrößern"
        disabled={zoom >= ZOOM_MAX}
        onClick={() => setZoom(stepZoom(zoom, 1))}
        className="flex size-6 items-center justify-center rounded text-fg-muted hover:text-fg disabled:opacity-40"
      >
        <Icon name="expandAll" size={24} className="-rotate-90" />
      </button>
    </GlassPanel>
  );
}
