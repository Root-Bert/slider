import { useEffect, useState } from 'react';
import { cn } from '@/ui';
import { photoPreviews, usePhotoPreview } from './photo-previews';

/** A change that left the slide's picture as it was: the photo shows no longer than this. */
const SAME_PICTURE_MS = 1500;

/**
 * A stock photo shown in its frame while the slide is drawn anew (see `photo-previews`): over
 * the slide's picture `src` until a new one has loaded after the change settled.
 */
export function PhotoPreviewLayer({
  slideId,
  src,
  rounded,
}: {
  slideId: string;
  src: string;
  rounded: string;
}) {
  const preview = usePhotoPreview(slideId);
  // The slide's picture when the photo first showed: the one to wait past.
  const [base, setBase] = useState<{ key: number; src: string } | null>(null);
  const key = preview?.key;
  if (key !== undefined && base?.key !== key) setBase({ key, src });
  const settled = preview?.settled ?? false;
  const waitingPast = base?.key === key ? base?.src : undefined;

  useEffect(() => {
    if (key === undefined || !settled || waitingPast === undefined) return;
    if (src === waitingPast) {
      const timer = window.setTimeout(() => photoPreviews.clear(slideId, key), SAME_PICTURE_MS);
      return () => window.clearTimeout(timer);
    }
    // The new picture: the photo goes once it has loaded, so the old one never flashes up.
    let cancelled = false;
    const image = new Image();
    image.onload = image.onerror = () => {
      if (!cancelled) photoPreviews.clear(slideId, key);
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [slideId, key, settled, src, waitingPast]);

  if (!preview) return null;
  const { rect } = preview;
  return (
    <div
      data-photo-preview={slideId}
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', rounded)}
    >
      <img
        src={preview.url}
        alt=""
        draggable={false}
        className="absolute object-cover"
        style={{
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.w * 100}%`,
          height: `${rect.h * 100}%`,
        }}
      />
    </div>
  );
}
