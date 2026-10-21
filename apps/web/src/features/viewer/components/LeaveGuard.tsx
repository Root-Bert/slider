import { useEffect, useSyncExternalStore } from 'react';
import { useBlocker } from 'react-router';
import { ConfirmDialog } from '@/ui';
import { replyDrafts } from '../comments/lib/reply-drafts';
import { unsavedWork } from '../lib/unsaved-work';

/**
 * Keeps unsent work from being lost unasked. Leaving the review in the app (✕, Back, a link)
 * while a comment, recording, sketch or upload is open asks first ("Entwurf verwerfen?").
 * Closing or reloading the tab gets the browser's own question – then also for typed replies,
 * which survive leaving within the app (`reply-drafts`) but not a reload.
 */
export function LeaveGuard() {
  const unsent = useSyncExternalStore(unsavedWork.subscribe, unsavedWork.has);
  const replies = useSyncExternalStore(replyDrafts.subscribe, replyDrafts.hasAny);
  const unload = unsent || replies;

  useEffect(() => {
    if (!unload) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers ask only with a return value.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unload]);

  // Moving between slides only changes the query (`?slide=`): that never asks.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      unsent && currentLocation.pathname !== nextLocation.pathname,
  );
  if (blocker.state !== 'blocked') return null;
  return (
    <ConfirmDialog
      title="Entwurf verwerfen?"
      description="Dein Kommentar ist noch nicht gesendet. Wenn du die Review jetzt verlässt, gehen Text, Aufnahme oder Zeichnung verloren – ein laufender Upload bricht ab."
      confirmLabel="Verwerfen und verlassen"
      cancelLabel="Weiterschreiben"
      onConfirm={() => blocker.proceed()}
      onClose={() => blocker.reset()}
    />
  );
}
