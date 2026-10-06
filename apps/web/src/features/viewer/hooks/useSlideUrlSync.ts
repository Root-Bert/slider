import { useEffect } from 'react';
import { useSearchParams } from 'react-router';

export const SLIDE_PARAM = 'slide';

/** Mirrors the active slide into `?slide=<stable id>` without adding history entries (BER-95). */
export function useSlideUrlSync(activeSlideId: string | null) {
  const [searchParams, setSearchParams] = useSearchParams();
  const current = searchParams.get(SLIDE_PARAM);

  useEffect(() => {
    if (!activeSlideId || activeSlideId === current) return;
    setSearchParams(
      (params) => {
        params.set(SLIDE_PARAM, activeSlideId);
        return params;
      },
      { replace: true, preventScrollReset: true },
    );
  }, [activeSlideId, current, setSearchParams]);
}
