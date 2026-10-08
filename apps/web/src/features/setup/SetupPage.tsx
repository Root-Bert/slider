import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { SETUP_TOKEN_HEADER, type SetupStatus } from '@slider/shared';
import { apiRequest } from '@/lib/api-client';
import { Logo, Spinner } from '@/ui';
import { NotAuthorized, Notice, SetupForm } from './components/SetupForm';
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
    <div className="dot-grid flex min-h-full flex-col">
      <title>Einrichtung · Slider</title>
      <header className="flex h-[88px] shrink-0 items-center px-6 md:px-14">
        <Logo />
      </header>
      <main className="flex flex-1 justify-center px-4 pt-2 pb-16">
        <div className="flex w-full max-w-[720px] flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-fg">
              Slider einrichten
            </h1>
            <p className="text-sm text-fg-subtle">
              Anmeldung, E-Mail-Versand und wer ein Konto anlegen darf.
            </p>
          </div>
          {status.isPending ? (
            <Spinner size={24} className="text-fg-subtle" />
          ) : status.isError ? (
            <Notice tone="danger">{status.error.message}</Notice>
          ) : status.data.settings ? (
            <SetupForm status={status.data} settings={status.data.settings} headers={headers} />
          ) : (
            <NotAuthorized status={status.data} />
          )}
        </div>
      </main>
    </div>
  );
}
