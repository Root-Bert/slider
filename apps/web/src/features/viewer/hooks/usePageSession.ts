import { useEffect, useState } from 'react';
import { useLeaveSession } from '@/lib/queries';

/**
 * Guests end their session from the viewer. The thank-you state shows immediately (the session
 * cookie is gone right after, so the deck queries would fail anyway); on error the viewer returns.
 */
export function useLeaveReview() {
  const leaveSession = useLeaveSession();
  const [hasLeft, setHasLeft] = useState(false);
  const leave = () => {
    setHasLeft(true);
    leaveSession.mutate(undefined, { onError: () => setHasLeft(false) });
  };
  return { hasLeft, leave };
}

export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · Slider`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
