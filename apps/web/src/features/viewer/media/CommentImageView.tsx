import type { CommentImage } from '@slider/shared';
import { useState } from 'react';
import { cn, Dialog } from '@/ui';

/**
 * A comment's images – drawn, pasted or picked: as wide as the card (one whole, several two to a
 * row, cut to 16:9), full size on click. At least 13rem wide, so a card that hugs its content
 * (a reply) does not shrink them to stamps.
 */
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
      <ul className={cn('grid w-full min-w-52 gap-1.5', images.length > 1 && 'grid-cols-2')}>
        {images.map((image, index) => (
          <li key={image.id}>
            <button
              type="button"
              onClick={() => setOpenId(image.id)}
              aria-label={`${name(index)} vergrößern`}
              title="Vergrößern"
              className="relative z-(--z-raised) block w-full rounded-control-sm hover:opacity-90"
            >
              <img
                src={image.url}
                alt={name(index)}
                loading="lazy"
                className={cn(
                  'block w-full rounded-control-sm bg-glass-solid ring-hairline-strong',
                  images.length > 1 ? 'aspect-video object-cover' : 'max-h-80 object-contain',
                )}
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
