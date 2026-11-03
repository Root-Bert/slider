import { useEffect } from 'react';
import { whenPictureShown } from '../../stage/shown-pictures';
import { useEditing } from '../editing-context';
import { cn } from '@/ui';
import { photoPreviews, usePhotoPreview } from './photo-previews';

/**
 * A stock photo shown in its frame while the slide is drawn anew (see `photo-previews`): over
 * the slide's picture `src` until the slide's newest picture is on screen after the change settled.
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
  const editing = useEditing();
  const key = preview?.key;
  // Settled, and the slide's picture fetched after it: shown until that one is on screen – in
  // the frame `SwapImage` shows it, never on a timer.
  const settled = (preview?.settled ?? false) && editing.slidePicturesReady;
  useEffect(() => {
    if (key === undefined || !settled) return;
    return whenPictureShown(src, () => photoPreviews.clear(slideId, key));
  }, [slideId, key, settled, src]);

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
