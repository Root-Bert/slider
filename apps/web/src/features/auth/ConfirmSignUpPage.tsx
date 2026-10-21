import { useState } from 'react';
import { useParams } from 'react-router';
import { confirmNextcloudSignUp } from '@/lib/api';
import { routes } from '@/lib/routes';
import { CenteredCard, CenteredLayout } from '@/shell/layouts/CenteredLayout';
import { Button, ErrorText, NextcloudMark, TextLink } from '@/ui';

/**
 * `/konto-bestaetigen/:token` – the link of the confirmation mail for a new account through any
 * Nextcloud. Created by button, never on opening (mail scanners open links); then signed in.
 */
export function Component() {
  const { token = '' } = useParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      // Full page load: the session cookie is set now.
      window.location.assign((await confirmNextcloudSignUp(token)).redirectTo);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Das hat nicht geklappt.');
      setBusy(false);
    }
  };

  return (
    <CenteredLayout docTitle="Konto bestätigen | Slider">
      <CenteredCard
        icon={<NextcloudMark size={28} />}
        title="Fast geschafft"
        message="Deine Adresse ist bestätigt. Erstelle jetzt dein Konto, angemeldet wirst du mit deiner Nextcloud."
      >
        <div className="flex w-full flex-col gap-3">
          <Button
            size="lg"
            loading={busy}
            className="w-full shadow-glow transition-[background-color,box-shadow] hover:shadow-glow-hover"
            onClick={() => void confirm()}
          >
            Konto erstellen
          </Button>
          {error && (
            <ErrorText role="alert" size="xs">
              {error}{' '}
              <TextLink to={routes.login()} tone="muted">
                Zur Anmeldung
              </TextLink>
            </ErrorText>
          )}
        </div>
      </CenteredCard>
    </CenteredLayout>
  );
}
