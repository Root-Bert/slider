import { useState } from 'react';
import { useParams } from 'react-router';
import { confirmEmailLogin } from '@/lib/api';
import { Icon } from '@/ui';
import { APP_NAMES, useCurrentApp } from '@/lib/apps';
import { ConfirmLinkCard } from './components/ConfirmLinkCard';
import { EmailWelcome } from './components/EmailWelcome';
import { loadPage } from './lib/load-page';

/**
 * `/anmelden/:token` – the link of the login mail (BER-168). Signs in by button, never on opening
 * (mail scanners open links). A new account then gets its name and a passkey for next time –
 * both can wait ("Später"): the next login link works as well.
 */
export function Component() {
  const { token = '' } = useParams();
  const [welcome, setWelcome] = useState<string | null>(null);
  // Opened from the mail, mostly in a new tab: the app one was in there, else Cloud.
  const app = useCurrentApp();

  if (welcome) return <EmailWelcome redirectTo={welcome} />;
  return (
    <ConfirmLinkCard
      docTitle="Anmelden | Slider"
      icon={<Icon name="send" size={28} />}
      title={`Bei ${APP_NAMES[app]} anmelden`}
      message="Deine Adresse ist bestätigt. Ein Klick noch, dann bist du drin."
      label="Anmelden"
      confirm={async () => {
        const result = await confirmEmailLogin(token);
        if (result.newAccount) setWelcome(result.redirectTo);
        else loadPage(result.redirectTo);
      }}
    />
  );
}
