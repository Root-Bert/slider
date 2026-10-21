import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SETUP_TOKEN_HEADER, type ClaimSetupResult, type SetupStatus } from '@slider/shared';
import { routes } from '@/lib/routes';
import { apiRequest } from '@/lib/api-client';
import { queryKeys, useLogout, useMe } from '@/lib/api';
import { Button, ErrorText, Notice, Section, TextField, TextLink } from '@/ui';
import { cleanSetupToken, SETUP_PATH, storeSetupToken } from '../lib/setup-form';
import { Code } from './Code';

/**
 * Without access to the settings. An instance admin exists: only that admin gets in. None yet:
 * the setup token from the server log – signed in it makes this account admin, signed out it
 * opens the settings (to set up the first login).
 */
export function NotAuthorized({
  status,
  rejected,
  initialToken,
  onToken,
}: {
  status: SetupStatus;
  /** The token sent along was not taken (wrong, or from before a restart). */
  rejected: boolean;
  /** Typed in earlier in this tab (before signing in): ready to claim with. */
  initialToken: string | null;
  /** Signed out: open the settings with this token. */
  onToken: (token: string) => void;
}) {
  if (status.claimed) return <AdminOnly />;
  if (status.claimable) return <ClaimInstance initialToken={initialToken} />;
  return <OpenWithToken rejected={rejected} onToken={onToken} />;
}

const TOKEN_TITLE = 'Setup-Token aus dem Server-Log eingeben';
const WHERE_TOKEN = (
  <>
    Er steht im Server-Log unter „Setup token“, mit Docker zum Beispiel per{' '}
    <Code>docker logs slider</Code>. Er gilt, bis diese Instanz einen Admin hat – nicht weitergeben.
  </>
);

function TokenField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}) {
  return (
    <TextField
      label="Setup-Token"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      error={error}
      autoComplete="off"
      spellCheck={false}
      autoFocus
    />
  );
}

/** Signed out, no admin yet: the token opens the settings, e.g. to set up the first login. */
function OpenWithToken({
  rejected,
  onToken,
}: {
  rejected: boolean;
  onToken: (token: string) => void;
}) {
  const [value, setValue] = useState('');
  const token = cleanSetupToken(value);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (token) onToken(token);
      }}
    >
      <Section title={TOKEN_TITLE} description={WHERE_TOKEN}>
        <TokenField
          value={value}
          onChange={setValue}
          error={rejected ? 'Der Setup-Token stimmt nicht. Prüf das Server-Log.' : null}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={!token}>
            Weiter
          </Button>
        </div>
      </Section>
    </form>
  );
}

/**
 * Signed in, no admin yet: the blocking claim screen. The API lets the account do nothing else
 * (`instance_unclaimed`) – `AccountGate` and the API client send it here. The token makes it
 * admin; after that nobody is asked again, and this page shows the settings.
 */
function ClaimInstance({ initialToken }: { initialToken: string | null }) {
  const queryClient = useQueryClient();
  const user = useMe().data?.user;
  const logout = useLogout();
  const [value, setValue] = useState(initialToken ?? '');
  const token = cleanSetupToken(value);
  const claim = useMutation({
    mutationFn: (given: string) =>
      apiRequest<ClaimSetupResult>('/setup/claim', {
        method: 'POST',
        headers: { [SETUP_TOKEN_HEADER]: given },
      }),
    onSuccess: async () => {
      // Used up: the server deleted it.
      storeSetupToken(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['setup'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.me }),
      ]);
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (token) claim.mutate(token);
      }}
    >
      <Section
        title="Setup-Token eingeben"
        description={
          <>
            Diese Slider-Instanz hat noch keinen Admin. Mit dem Setup-Token wirst du es
            {user ? ` – als ${user.name} (${user.email})` : ''}, danach geht es los. {WHERE_TOKEN}
          </>
        }
      >
        <TokenField
          value={value}
          onChange={setValue}
          error={claim.isError ? claim.error.message : null}
        />
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            loading={logout.isPending}
            onClick={() =>
              logout.mutate(undefined, {
                // A full page load: everything cached belongs to the account signed out.
                onSuccess: () => window.location.assign(routes.login()),
              })
            }
          >
            Abmelden
          </Button>
          <Button type="submit" disabled={!token} loading={claim.isPending}>
            Admin werden
          </Button>
        </div>
        {logout.error && (
          <ErrorText role="alert" size="xs">
            Abmelden hat nicht geklappt – bitte erneut versuchen.
          </ErrorText>
        )}
      </Section>
    </form>
  );
}

/**
 * Signed out: a link to the login. Signed in with an account that isn't the admin: the login
 * would send it straight back here, so it signs out first and then offers the login.
 */
function AdminOnly() {
  const user = useMe().data?.user;
  const logout = useLogout();
  if (!user) {
    return (
      <Notice tone="warning">
        Nur der Admin dieser Slider-Instanz kann die Einrichtung ändern.{' '}
        <TextLink to={routes.login(SETUP_PATH)} variant="inline">
          Als Admin anmelden
        </TextLink>
      </Notice>
    );
  }
  return (
    <Notice
      tone="warning"
      footer={
        <div className="flex flex-col items-start gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            loading={logout.isPending}
            onClick={() =>
              logout.mutate(undefined, {
                // A full page load: everything cached belongs to the account signed out.
                onSuccess: () => window.location.assign(routes.login(SETUP_PATH)),
              })
            }
          >
            Mit anderem Konto anmelden
          </Button>
          {logout.error && (
            <ErrorText role="alert" size="xs">
              Abmelden hat nicht geklappt – bitte erneut versuchen.
            </ErrorText>
          )}
        </div>
      }
    >
      Nur der Admin dieser Slider-Instanz kann die Einrichtung ändern. Du bist als{' '}
      {`${user.name} (${user.email})`} angemeldet.
    </Notice>
  );
}
