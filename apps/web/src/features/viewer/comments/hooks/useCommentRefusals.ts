import { useEffect } from 'react';
import { commentOutbox } from '@/lib/api/comment-outbox';
import type { ShowToast } from '@/ui';

/**
 * A comment change refused by the server once nobody waited for it any more – written offline and
 * sent later, or after a reload (its slide gone meanwhile, the rights taken away): said once, it
 * leaves the slide again. Refused while its field still waited, the field says so itself.
 */
export function useCommentRefusals(showToast: ShowToast): void {
  useEffect(
    () =>
      commentOutbox().onRefused((error, action) => {
        const what = action.type === 'create' ? 'Kommentar nicht gesendet' : 'Nicht gespeichert';
        const why = error instanceof Error && error.message ? `: ${error.message}` : '';
        showToast(`${what}${why}`, 'danger');
      }),
    [showToast],
  );
}
