import { GlassPanel, Icon } from '@/ui';
import { useViewerDispatch, useViewerState, ZOOM_MAX, ZOOM_MIN } from '../state/viewer-state';

const STEP = 0.1;

/** Zoom pill (BER-96): ›‹ – slider – ‹› scales the stage height. */
export function ZoomControl() {
  const { zoom } = useViewerState();
  const dispatch = useViewerDispatch();
  const setZoom = (value: number) =>
    dispatch({ type: 'zoomChanged', zoom: Math.round(value * 100) / 100 });

  return (
    <GlassPanel className="flex h-10 items-center gap-2 px-3">
      <button
        type="button"
        aria-label="Verkleinern"
        title="Verkleinern"
        disabled={zoom <= ZOOM_MIN}
        onClick={() => setZoom(zoom - STEP)}
        className="flex size-7 items-center justify-center rounded-lg text-fg-muted hover:text-fg disabled:opacity-40"
      >
        <Icon name="unfoldLess" size={20} className="-rotate-90" />
      </button>
      <input
        type="range"
        aria-label="Zoom"
        aria-valuetext={`${Math.round(zoom * 100)} %`}
        min={ZOOM_MIN}
        max={ZOOM_MAX}
        step={0.05}
        value={zoom}
        onChange={(event) => setZoom(Number(event.target.value))}
        className={[
          'h-4 w-24 cursor-pointer appearance-none bg-transparent md:w-32',
          '[&::-webkit-slider-runnable-track]:h-0.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/50',
          '[&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-1 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white',
          '[&::-moz-range-track]:h-0.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-white/50',
          '[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-1 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white',
        ].join(' ')}
      />
      <button
        type="button"
        aria-label="Vergrößern"
        title="Vergrößern"
        disabled={zoom >= ZOOM_MAX}
        onClick={() => setZoom(zoom + STEP)}
        className="flex size-7 items-center justify-center rounded-lg text-fg-muted hover:text-fg disabled:opacity-40"
      >
        <Icon name="expandAll" size={20} className="-rotate-90" />
      </button>
    </GlassPanel>
  );
}
