import { useEffect, useEffectEvent } from 'react';

/**
 * Back from another site (a login provider, Stripe, Google's picker) with the browser's back
 * button, the page may come out of the back-forward cache exactly as it was left – with a button
 * still busy "until the browser has left". `reset` then.
 */
export function useOnPageRestore(reset: () => void) {
  const onPageShow = useEffectEvent((event: PageTransitionEvent) => {
    if (event.persisted) reset();
  });
  useEffect(() => {
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);
}
