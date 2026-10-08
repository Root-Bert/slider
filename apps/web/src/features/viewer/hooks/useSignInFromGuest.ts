import { useState } from 'react';
import { routes } from '@/app/routes';
import { api } from '@/lib/api-client';

export const GUEST_COMMENT_HINT = 'Zum Kommentieren brauchst du ein Konto in dieser Organisation.';

/**
 * Guests only look (BER-130). Signing in first ends the guest session – its cookie would
 * otherwise win over the login – and comes back to this deck.
 */
export function useSignInFromGuest(deckId: string) {
  const [leaving, setLeaving] = useState(false);
  const signIn = () => {
    setLeaving(true);
    const target = routes.login(routes.deck(deckId));
    void api
      .post<void>('/session/leave')
      .catch(() => undefined)
      .finally(() => window.location.assign(target));
  };
  return { leaving, signIn };
}
