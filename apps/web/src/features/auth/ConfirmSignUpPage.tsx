import { useParams } from 'react-router';
import { confirmNextcloudSignUp } from '@/lib/api';
import { NextcloudMark } from '@/ui';
import { ConfirmLinkCard } from './components/ConfirmLinkCard';
import { loadPage } from './lib/load-page';

/**
 * `/konto-bestaetigen/:token` – the link of the confirmation mail for a new account through any
 * Nextcloud. Created by button, never on opening (mail scanners open links); then signed in.
 */
export function Component() {
  const { token = '' } = useParams();
  return (
    <ConfirmLinkCard
      docTitle="Konto bestätigen | Slider"
      icon={<NextcloudMark size={28} />}
      title="Fast geschafft"
      message="Deine Adresse ist bestätigt. Erstelle jetzt dein Konto, angemeldet wirst du mit deiner Nextcloud."
      label="Konto erstellen"
      confirm={async () => loadPage((await confirmNextcloudSignUp(token)).redirectTo)}
    />
  );
}
