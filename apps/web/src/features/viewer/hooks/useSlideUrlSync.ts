import { useEffect } from 'react';
import { useSearchParams } from 'react-router';

export const SLIDE_PARAM = 'slide';

/**
 * How long (ms) the active slide has to stay before the URL follows. A sweep across the deck
 * changes it every frame; one `replaceState` each would run into Safari's limit (100 per ~10 s,
 * after which it throws and the URL stops following) and re-render everything that reads the
 * location.
 */
export const SLIDE_URL_SETTLE_MS = 300;

/** Mirrors the active slide into `?slide=<stable id>` without adding history entries (BER-95). */
export function useSlideUrlSync(activeSlideId: string | null) {
  const [searchParams, setSearchParams] = useSearchParams();
  const current = searchParams.get(SLIDE_PARAM);

  useEffect(() => {
    if (!activeSlideId || activeSlideId === current) return;
    const timer = setTimeout(
      () =>
        setSearchParams(
          (params) => {
            params.set(SLIDE_PARAM, activeSlideId);
            return params;
          },
          { replace: true, preventScrollReset: true },
        ),
      SLIDE_URL_SETTLE_MS,
    );
    return () => clearTimeout(timer);
  }, [activeSlideId, current, setSearchParams]);
}
