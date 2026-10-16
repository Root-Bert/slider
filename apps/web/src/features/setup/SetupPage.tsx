import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { SETUP_TOKEN_HEADER, type SetupStatus } from '@slider/shared';
import { apiRequest } from '@/lib/api-client';
import { SettingsLayout } from '@/shell/layouts/SettingsLayout';
import { Notice, Spinner } from '@/ui';
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
  });

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
      ) : status.isError ? (
        <Notice tone="danger">{status.error.message}</Notice>
      ) : status.data.settings ? (
        <SetupForm status={status.data} settings={status.data.settings} headers={headers} />
      ) : (
        <NotAuthorized status={status.data} />
      )}
    </SettingsLayout>
  );
}
