import { MAX_COMMENT_IMAGES } from '@slider/shared';
import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { imagesFromClipboard, imageToPng } from '../lib/image-file';

export interface ImageAttachment {
  /** PNG, ready to send. */
  blob: Blob;
  /** Object URL for the preview. */
  url: string;
}

/** The attachments as the uploads `useCreateMediaComment` sends, in their order. */
export const asUploads = (attachments: readonly ImageAttachment[]) =>
  attachments.map(
    ({ blob }) =>
      () =>
        Promise.resolve(blob),
  );

const tooMany = `Höchstens ${MAX_COMMENT_IMAGES} Bilder pro Kommentar.`;

/**
 * The images of a comment being written (BER-174): pasted into the text (`onPaste`) or picked as
 * files (`attach`), several at once, each turned into a PNG and shown as a small preview until
 * it is sent or removed. Up to `MAX_COMMENT_IMAGES` – `room` tells how many more fit (a drawn
 * sketch takes one).
 */
export function useImageAttachments(reserved = 0) {
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  // Images still turning into PNGs: they count against the limit already, and while any
  // converts the field is busy (nothing is sent without them).
  const [converting, setConverting] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<ImageAttachment[]>([]);
  const inflight = useRef(0);
  // Bumped by `clear` and on unmount: conversions started before are dropped when they finish.
  const generation = useRef(0);

  const update = useCallback((next: ImageAttachment[]) => {
    for (const old of current.current) if (!next.includes(old)) URL.revokeObjectURL(old.url);
    current.current = next;
    setAttachments(next);
  }, []);

  // The previews' URLs live as long as the field.
  useEffect(
    () => () => {
      generation.current += 1;
      update([]);
    },
    [update],
  );

  const room = Math.max(0, MAX_COMMENT_IMAGES - reserved - attachments.length - converting);

  const attach = useCallback(
    async (files: readonly Blob[]) => {
      if (files.length === 0) return;
      setError(null);
      const free = MAX_COMMENT_IMAGES - reserved - current.current.length - inflight.current;
      if (files.length > free) setError(tooMany);
      const taken = files.slice(0, Math.max(0, free));
      if (taken.length === 0) return;
      const started = generation.current;
      inflight.current += taken.length;
      setConverting(inflight.current);
      try {
        const blobs = await Promise.all(taken.map((file) => imageToPng(file)));
        if (generation.current !== started) return;
        // Another paste may have filled up meanwhile.
        const fits = blobs.slice(
          0,
          Math.max(0, MAX_COMMENT_IMAGES - reserved - current.current.length),
        );
        if (fits.length < blobs.length) setError(tooMany);
        update([
          ...current.current,
          ...fits.map((blob) => ({ blob, url: URL.createObjectURL(blob) })),
        ]);
      } catch (reason) {
        if (generation.current !== started) return;
        setError(
          reason instanceof Error ? reason.message : 'Das Bild konnte nicht angehängt werden.',
        );
      } finally {
        if (generation.current === started) {
          inflight.current -= taken.length;
          setConverting(inflight.current);
        }
      }
    },
    [reserved, update],
  );

  const remove = useCallback(
    (attachment: ImageAttachment) => {
      setError(null);
      update(current.current.filter((other) => other !== attachment));
    },
    [update],
  );

  const clear = useCallback(() => {
    generation.current += 1;
    inflight.current = 0;
    setConverting(0);
    setError(null);
    update([]);
  }, [update]);

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      const files = imagesFromClipboard(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      void attach(files);
    },
    [attach],
  );

  return { attachments, room, busy: converting > 0, error, attach, remove, clear, onPaste };
}

export type ImageAttachments = ReturnType<typeof useImageAttachments>;
