import { useParams } from 'react-router';
import { confirmNextcloudSignUp } from '@/lib/api';
import { NextcloudMark } from '@/ui';
import { ConfirmLinkCard } from './components/ConfirmLinkCard';
import { loadPage } from './lib/load-page';

/**
 * Whether the link confirms a browser for an account that exists (`k` in the signed token) rather
 * than creating one – only how the card reads; the server checks the token.
 */
function confirmsBrowser(token: string): boolean {
  try {
    const body = (token.split('.')[0] ?? '').replace(/-/g, '+').replace(/_/g, '/');
    return (JSON.parse(atob(body)) as { k?: unknown }).k === 1;
  } catch {
    return false;
  }
}

/**
 * `/konto-bestaetigen/:token` – the link of the confirmation mail for a new account through any
 * Nextcloud, or for an account's first sign-in through one in a browser. Done by button, never on
 * opening (mail scanners open links); then signed in.
 */
export function Component() {
  const { token = '' } = useParams();
  const known = confirmsBrowser(token);
  return (
    <ConfirmLinkCard
      docTitle={known ? 'Anmeldung bestätigen | Slider' : 'Konto bestätigen | Slider'}
      icon={<NextcloudMark size={28} />}
      title={known ? 'Anmeldung bestätigen' : 'Fast geschafft'}
      message={
        known
          ? 'Du meldest dich in diesem Browser zum ersten Mal mit deiner Nextcloud an. Bestätige, dass du das bist.'
          : 'Deine Adresse ist bestätigt. Erstelle jetzt dein Konto, angemeldet wirst du mit deiner Nextcloud.'
      }
      label={known ? 'Anmelden' : 'Konto erstellen'}
      confirm={async () => loadPage((await confirmNextcloudSignUp(token)).redirectTo)}
    />
  );
}
