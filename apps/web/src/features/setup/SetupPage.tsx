import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { SETUP_TOKEN_HEADER, type SetupStatus } from '@slider/shared';
import { apiRequest } from '@/lib/api-client';
import { routes } from '@/lib/routes';
import { SettingsLayout } from '@/shell/layouts/SettingsLayout';
import { Button, ButtonLink, Notice, Spinner, useToast } from '@/ui';
import { NotAuthorized } from './components/NotAuthorized';
import { SetupForm, type SetupTab } from './components/SetupForm';
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
  const [tab, setTab] = useState<SetupTab>('settings');
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
      subtitle={status.data?.settings ? SUBTITLES[tab] : SUBTITLES.settings}
      back={{ to: routes.reviews() }}
      // The instance admin is in the instance's own pages: home is its dashboard.
      logoLink={
        status.data?.claimed && status.data.authorized
          ? { to: routes.instance(), label: 'Instanz-Dashboard' }
          : undefined
      }
      actions={
        status.data?.claimed &&
        status.data.authorized && (
          <ButtonLink
            to={routes.instance()}
            variant="secondary"
            size="sm"
            icon="manageAccounts"
            iconSize={16}
          >
            Instanz-Dashboard
          </ButtonLink>
        )
      }
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
            tab={tab}
            onTabChange={setTab}
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

/** Under the title: what the open tab holds. */
const SUBTITLES: Record<SetupTab, string> = {
  settings: 'Anmeldung, E-Mail-Versand, wer ein Konto anlegen darf, Impressum und Datenschutz.',
  env: 'Was die .env des Servers festlegt – nur dort änderbar, danach Slider neu starten.',
};
