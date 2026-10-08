import type { DeletedSlide } from '@slider/shared';
import { cn, Icon } from '@/ui';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

const deletedLabel = (count: number) => `Gelöschte Folien (${count})`;

/**
 * The "Gelöschte Folien" slot at the end of the slide track (BER-109): a dashed ghost slide with
 * the last images of the deleted slides fanned out. Opens the panel with their comments – no
 * slide and no comment ever disappears from the review.
 */
export function DeletedSlidesEntry({
  deletedSlides,
  commentCount,
  x,
  w,
  h,
}: {
  deletedSlides: readonly DeletedSlide[];
  commentCount: number;
  x: number;
  w: number;
  h: number;
}) {
  const { deletedPanelOpen } = useViewerState();
  const dispatch = useViewerDispatch();
  const roomy = h >= 150;
  const previews = deletedSlides.slice(0, 3);
  const previewW = Math.min(w - 32, (h - 72) * (16 / 9));

  return (
    <button
      type="button"
      data-deleted-entry
      aria-expanded={deletedPanelOpen}
      aria-label={`${deletedLabel(deletedSlides.length)} – ${commentCount} Kommentare anzeigen`}
      title={deletedLabel(deletedSlides.length)}
      onClick={() => dispatch({ type: 'deletedPanelSet', open: !deletedPanelOpen })}
      className={cn(
        'absolute top-0 flex flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-dashed border-white/20 bg-white/[0.02] px-3 text-center text-fg-muted transition-colors hover:border-white/35 hover:bg-white/[0.05] hover:text-fg',
        deletedPanelOpen && 'border-white/45 bg-white/[0.06] text-fg',
      )}
      style={{ left: x, width: w, height: h }}
    >
      {roomy && previewW > 40 && (
        <span
          aria-hidden
          className="relative mb-1"
          style={{ width: previewW, height: previewW / (16 / 9) }}
        >
          {previews.map((slide, index) => (
            <img
              key={slide.slideId}
              src={slide.thumbnailUrl}
              alt=""
              loading="lazy"
              draggable={false}
              className="absolute inset-0 size-full rounded-thumb object-cover opacity-50 shadow-[0_2px_8px_rgb(0_0_0/0.6)] grayscale"
              style={{
                transform: `translate(${(index - (previews.length - 1) / 2) * 8}px, ${index * -4}px) rotate(${(index - (previews.length - 1) / 2) * 4}deg)`,
                zIndex: previews.length - index,
              }}
            />
          ))}
        </span>
      )}
      <Icon name="delete" size={roomy ? 20 : 18} className="shrink-0" />
      <span className="text-xs leading-4 font-medium">
        Gelöschte Folien
        <span className="ml-1 text-fg-subtle tabular-nums">({deletedSlides.length})</span>
      </span>
      {roomy && commentCount > 0 && (
        <span className="text-[11px] text-fg-subtle">
          {commentCount === 1 ? '1 Kommentar' : `${commentCount} Kommentare`} bleiben erhalten
        </span>
      )}
    </button>
  );
}
