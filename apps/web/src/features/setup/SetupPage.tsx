import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { SETUP_TOKEN_HEADER, type SetupStatus } from '@slider/shared';
import { apiRequest } from '@/lib/api-client';
import { routes } from '@/lib/routes';
import { SettingsLayout } from '@/shell/layouts/SettingsLayout';
import { Button, Notice, Spinner, useToast } from '@/ui';
import { NotAuthorized } from './components/NotAuthorized';
import { SetupForm } from './components/SetupForm';
import { storedSetupToken, storeSetupToken } from './lib/setup-form';

/**
 * `/einrichtung` – logins, mail, sign-up and legal texts of a self-hosted Slider, set in the
 * browser. Until the instance has an admin, the setup token from the server log is typed in here:
 * signed out it opens the settings, signed in it makes the account instance admin. Afterwards
 * only that admin gets in. Saving restarts the server; the page waits for it. Imprint and privacy
 * policy save on their own, without a restart.
 */
export function Component() {
  const [token, setToken] = useState(storedSetupToken);
  const [toast, showToast] = useToast();
  // The query function reads the token from here, so a newly typed one is sent on the refetch.
  const tokenRef = useRef(token);
  const headers: Record<string, string> = token ? { [SETUP_TOKEN_HEADER]: token } : {};
  const status = useQuery({
    queryKey: ['setup'],
    queryFn: () =>
      apiRequest<SetupStatus>('/setup', {
        headers: tokenRef.current ? { [SETUP_TOKEN_HEADER]: tokenRef.current } : {},
      }),
    // Back from the Entra or Google console tab: keep the form as typed.
    refetchOnWindowFocus: false,
  });
  const retry = (
    <Button size="sm" variant="secondary" icon="refresh" onClick={() => void status.refetch()}>
      Erneut versuchen
    </Button>
  );

  const openWith = (next: string) => {
    tokenRef.current = next;
    setToken(next);
    storeSetupToken(next);
    void status.refetch();
  };
  // A token was sent and didn't open the page – unless it is kept for claiming (signed in).
  const rejected = token !== null && status.data !== undefined && !status.data.authorized;

  return (
    <SettingsLayout
      header="logo"
      docTitle="Einrichtung | Slider"
      title="Slider einrichten"
      subtitle="Anmeldung, E-Mail-Versand, wer ein Konto anlegen darf, Impressum und Datenschutz."
      back={{ to: routes.preferences(), label: 'Zurück zu den Einstellungen' }}
      truncate={false}
      toast={toast}
    >
      {status.isPending ? (
        <Spinner size="2xl" className="text-fg-subtle" />
      ) : status.data?.settings ? (
        // A failed refetch (the server still restarting) keeps the data: the form stays, with
        // what was typed, and says so above it.
        <div className="flex flex-col gap-6">
          {status.isError && (
            <Notice tone="danger" title="Nicht neu geladen" footer={retry}>
              {status.error.message}
            </Notice>
          )}
          <SetupForm
            status={status.data}
            settings={status.data.settings}
            headers={headers}
            onNotify={showToast}
          />
        </div>
      ) : status.isError ? (
        <Notice tone="danger" footer={retry}>
          {status.error.message}
        </Notice>
      ) : (
        <NotAuthorized
          status={status.data}
          rejected={rejected && !status.data.claimable}
          initialToken={token}
          onToken={openWith}
        />
      )}
    </SettingsLayout>
  );
}
