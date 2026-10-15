import type { CommentImage } from '@slider/shared';
import { useState } from 'react';
import { Dialog } from '@/ui';

/** A comment's drawn image: a thumbnail in the card, full size on click. */
export function CommentImageView({ image, author }: { image: CommentImage; author: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Bild von ${author} vergrößern`}
        title="Vergrößern"
        className="relative z-10 block w-full overflow-hidden rounded-control shadow-[inset_0_0_0_1px_var(--color-hairline-strong)] hover:opacity-90"
      >
        <img
          src={image.url}
          alt={`Bild von ${author}`}
          loading="lazy"
          className="block aspect-[4/3] w-full bg-[#141414] object-contain"
        />
      </button>
      {open && (
        <Dialog
          open
          onClose={() => setOpen(false)}
          title={`Bild von ${author}`}
          className="w-[min(960px,calc(100vw-32px))] max-w-none"
        >
          <img
            src={image.url}
            alt={`Bild von ${author}`}
            className="block w-full rounded-control bg-[#141414] object-contain"
          />
        </Dialog>
      )}
    </>
  );
}
