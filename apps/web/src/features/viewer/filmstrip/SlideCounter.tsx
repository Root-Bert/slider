import { GlassPanel } from '@/ui';
import { useViewerData } from '../state/viewer-data';
import { useViewerState } from '../state/viewer-state';

/** "[1] / 12" pill right of the filmstrip (Figma 87:332). */
export function SlideCounter() {
  const { slides, slideIndex } = useViewerData();
  const { activeSlideId } = useViewerState();
  const position = (activeSlideId ? (slideIndex.get(activeSlideId) ?? 0) : 0) + 1;

  return (
    <GlassPanel
      role="status"
      aria-label={`Folie ${position} von ${slides.length}`}
      className="flex shrink-0 items-center gap-2 px-4 py-1.5 text-base leading-5 text-fg tabular-nums max-md:px-3"
    >
      <span className="rounded-[4px] border border-white/30 px-1 leading-5 text-fg-muted">
        {position}
      </span>
      <span className="text-fg-subtle">/</span>
      <span className="text-fg-muted">{slides.length}</span>
    </GlassPanel>
  );
}
