import type { CommentImage } from '@slider/shared';
import { useState } from 'react';
import { Dialog } from '@/ui';
import { IMAGE_THUMB_CLASSES } from './lib/image-thumb';

/** A comment's images – drawn, pasted or picked: tiny 16:9 thumbnails in the card, full size on click. */
export function CommentImagesView({
  images,
  author,
}: {
  images: readonly CommentImage[];
  author: string;
}) {
  // By id: a refetch brings new objects for the same images. Gone meanwhile: closed.
  const [openId, setOpenId] = useState<string | null>(null);
  if (images.length === 0) return null;
  const openIndex = images.findIndex((image) => image.id === openId);
  const open = openIndex === -1 ? null : images[openIndex];
  const name = (index: number) =>
    images.length === 1 ? `Bild von ${author}` : `Bild ${index + 1} von ${author}`;
  return (
    <>
      <ul className="flex flex-wrap gap-1.5">
        {images.map((image, index) => (
          <li key={image.id}>
            <button
              type="button"
              onClick={() => setOpenId(image.id)}
              aria-label={`${name(index)} vergrößern`}
              title="Vergrößern"
              className="relative z-(--z-raised) block rounded-badge hover:opacity-90"
            >
              <img
                src={image.url}
                alt={name(index)}
                loading="lazy"
                className={IMAGE_THUMB_CLASSES}
              />
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <Dialog
          open
          onClose={() => setOpenId(null)}
          title={name(openIndex)}
          className="w-[min(960px,calc(100vw-32px))] max-w-none"
        >
          <img
            src={open.url}
            alt={name(openIndex)}
            className="block w-full rounded-control bg-glass-solid object-contain"
          />
        </Dialog>
      )}
    </>
  );
}
