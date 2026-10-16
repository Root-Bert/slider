import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { SETUP_TOKEN_HEADER, type SetupStatus } from '@slider/shared';
import { apiRequest } from '@/lib/api-client';
import { SettingsLayout } from '@/shell/layouts/SettingsLayout';
import { Button, Notice, Spinner } from '@/ui';
import { NotAuthorized, SetupForm } from './components/SetupForm';
import { takeSetupToken } from './lib/setup-form';

/**
 * `/einrichtung` – logins, mail and sign-up of a self-hosted Slider, set in the browser. Before
 * the first account exists it opens with the link from the server log (`#token=…`); afterwards
 * only the instance admin gets in. Saving restarts the server; the page waits for it.
 */
export function Component() {
  const [token] = useState(takeSetupToken);
  const headers: Record<string, string> = token ? { [SETUP_TOKEN_HEADER]: token } : {};
  const status = useQuery({
    queryKey: ['setup'],
    queryFn: () => apiRequest<SetupStatus>('/setup', { headers }),
    // Back from the Entra or Google console tab: keep the form as typed.
    refetchOnWindowFocus: false,
  });
  const retry = (
    <Button size="sm" variant="secondary" icon="refresh" onClick={() => void status.refetch()}>
      Erneut versuchen
    </Button>
  );

  return (
    <SettingsLayout
      header="logo"
      docTitle="Einrichtung · Slider"
      title="Slider einrichten"
      subtitle="Anmeldung, E-Mail-Versand und wer ein Konto anlegen darf."
      truncate={false}
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
          <SetupForm status={status.data} settings={status.data.settings} headers={headers} />
        </div>
      ) : status.isError ? (
        <Notice tone="danger" footer={retry}>
          {status.error.message}
        </Notice>
      ) : (
        <NotAuthorized status={status.data} />
      )}
    </SettingsLayout>
  );
}
