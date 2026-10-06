import { GlassPanel } from '@/ui';
import { useViewerData } from '../state/viewer-data';
import { useViewerState } from '../state/viewer-state';

/** "[1] / 12" pill next to the filmstrip. */
export function SlideCounter() {
  const { slides, slideIndex } = useViewerData();
  const { activeSlideId } = useViewerState();
  const position = (activeSlideId ? (slideIndex.get(activeSlideId) ?? 0) : 0) + 1;

  return (
    <GlassPanel
      role="status"
      aria-label={`Folie ${position} von ${slides.length}`}
      className="flex shrink-0 items-center gap-1.5 px-4 py-2 text-base text-fg tabular-nums"
    >
      <span className="rounded-[6px] border border-white/30 px-1.5 leading-6">{position}</span>
      <span className="text-fg-muted">/ {slides.length}</span>
    </GlassPanel>
  );
}
