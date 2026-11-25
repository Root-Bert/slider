import { useEffect, useRef, useState } from 'react';

/** Tries after the first failed load, a little later each time. */
const RETRIES = 2;
const RETRY_MS = 1500;

/**
 * A small picture's address that is asked for again when it fails to load – the server may just
 * have restarted or still be drawing it – before `failed` says to show the file's symbol. A new
 * address (another version) starts over.
 */
export function usePictureRetry(src: string): {
  src: string;
  failed: boolean;
  onError: () => void;
} {
  const [state, setState] = useState({ src, tries: 0, failed: false });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const now = state.src === src ? state : { src, tries: 0, failed: false };
  return {
    src: now.tries ? `${src}${src.includes('?') ? '&' : '?'}try=${now.tries}` : src,
    failed: now.failed,
    onError: () => {
      clearTimeout(timer.current);
      if (now.tries >= RETRIES) {
        setState({ ...now, failed: true });
        return;
      }
      timer.current = setTimeout(
        () => setState({ src, tries: now.tries + 1, failed: false }),
        RETRY_MS * (now.tries + 1),
      );
    },
  };
}
