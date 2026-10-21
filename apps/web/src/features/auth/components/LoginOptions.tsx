import { useState } from 'react';
import type { AuthProviders, LoginProvider } from '@slider/shared';
import {
  Button,
  cn,
  Divider,
  ErrorText,
  GoogleMark,
  Icon,
  MicrosoftMark,
  NextcloudMark,
  Notice,
  PasskeyMark,
} from '@/ui';
import {
  isPasskeyCancel,
  passkeyErrorMessage,
  passkeysSupported,
  signInWithPasskey,
} from '@/lib/passkeys';
import { useOnPageRestore } from '@/lib/page-restore';
import { BESIDE } from '../lib/beside';
import { loadPage } from '../lib/load-page';
import { providerLoginUrl } from '../lib/return-to';
import { EmailSignIn } from './EmailSignIn';
import { NextcloudSignIn } from './NextcloudSignIn';

const PROVIDER_ORDER: LoginProvider['id'][] = ['microsoft', 'google', 'nextcloud', 'oidc'];

const rank = (id: LoginProvider['id']) => PROVIDER_ORDER.indexOf(id);

/** "Weiter mit Microsoft" → "Microsoft", for buttons next to each other. */
const providerName = (label: string) => label.replace(/^Weiter mit\s+/, '');

/**
 * Provider buttons and passkey – or why there is nothing to sign in with. Any Nextcloud
 * (`nextcloudAnyServer`) takes the Nextcloud button's place, or – next to the organisation's
 * Nextcloud button – a quiet "other Nextcloud" below the buttons.
 */
export function LoginOptions({ config, returnTo }: { config: AuthProviders; returnTo: string }) {
  const providers = config.providers.toSorted((a, b) => rank(a.id) - rank(b.id));
  // Passkeys only sign into existing accounts, which need one of the other logins first.
  const [passkeys] = useState(passkeysSupported);
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);
  const nextcloudOAuth = providers.some((provider) => provider.id === 'nextcloud');
  const anyNextcloud = config.nextcloudAnyServer;
  // Where the any-Nextcloud button goes among the others, in PROVIDER_ORDER.
  const after = providers.findIndex((provider) => rank(provider.id) > rank('nextcloud'));
  const nextcloudAt =
    anyNextcloud && !nextcloudOAuth ? (after === -1 ? providers.length : after) : -1;
  // The glowing button only when there is one way in – next to each other, all look alike.
  const single = providers.length + (nextcloudAt === -1 ? 0 : 1) === 1;
  const hasButtons = providers.length > 0 || anyNextcloud;

  if (confirmEmail) {
    return (
      <div className="flex w-full animate-pop-in flex-col gap-3">
        <Notice tone="success" title="Schau in dein Postfach">
          Wir haben einen Link an <strong className="text-fg">{confirmEmail}</strong> geschickt.
          Klick ihn an, dann ist dein Konto da. Er gilt eine Stunde.
        </Notice>
        <Button variant="ghost" size="sm" className="mx-auto" onClick={() => setConfirmEmail(null)}>
          Zurück
        </Button>
      </div>
    );
  }

  const nextcloudSignIn = (other: boolean, primary: boolean) => (
    <NextcloudSignIn
      key="nextcloud-any"
      returnTo={returnTo}
      other={other}
      primary={primary}
      beside={!single}
      onConfirm={setConfirmEmail}
    />
  );

  // One address field for login links and company logins: always there with links, else it
  // opens from "Mit Firmen-Login anmelden" right under the buttons.
  const email = (config.sso || config.emailLogin) && (
    <EmailSignIn returnTo={returnTo} sso={config.sso} links={config.emailLogin} />
  );

  if (!hasButtons && !email) {
    // Passkeys keep working without any provider: an admin who switched every login off on the
    // setup page signs in with one and turns a provider back on.
    return (
      <div className="flex w-full flex-col gap-3">
        <Notice tone="warning" variant="plain" title="Anmeldung nicht eingerichtet">
          Für diese Slider-Instanz ist keine Anmeldung über Microsoft, Google, Nextcloud oder SSO
          eingerichtet. Wer Slider betreibt, richtet sie unter{' '}
          <code className="rounded-badge bg-surface-2 px-1 py-0.5 text-xs text-fg-muted">
            /einrichtung
          </code>{' '}
          ein – solange es keinen Admin gibt, mit dem Setup-Token aus dem Server-Log.
        </Notice>
        {passkeys && <PasskeyButton returnTo={returnTo} />}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {hasButtons && (
        // Side by side, wrapping when a third one gets too narrow.
        <div className="flex flex-wrap gap-3">
          {providers.map((provider, index) => [
            index === nextcloudAt && nextcloudSignIn(false, false),
            <ProviderButton
              key={provider.id}
              provider={provider}
              returnTo={returnTo}
              primary={single}
            />,
          ])}
          {nextcloudAt === providers.length && nextcloudSignIn(false, single)}
        </div>
      )}
      {anyNextcloud && nextcloudOAuth && nextcloudSignIn(true, false)}
      {!config.emailLogin && email}
      {hasButtons && (config.emailLogin || passkeys) && <Divider label="oder" className="my-1" />}
      {config.emailLogin && email}
      {passkeys && <PasskeyButton returnTo={returnTo} />}
    </div>
  );
}

function ProviderButton({
  provider,
  returnTo,
  primary,
}: {
  provider: LoginProvider;
  returnTo: string;
  primary: boolean;
}) {
  const [leaving, setLeaving] = useState(false);
  // Back from the identity provider (the browser's Back button, a common way to cancel): clickable
  // again.
  useOnPageRestore(() => setLeaving(false));
  return (
    <Button
      size="lg"
      variant={primary ? 'primary' : 'secondary'}
      glow={primary}
      loading={leaving}
      // The only way in glows softly, like the button in Slider's mails. Next to others it
      // names just the provider; the full label stays for screen readers.
      aria-label={primary ? undefined : provider.label}
      className={cn('gap-2.5', primary ? 'w-full' : BESIDE)}
      onClick={() => {
        setLeaving(true);
        window.location.assign(providerLoginUrl(provider.loginUrl, returnTo));
      }}
    >
      {!leaving &&
        (provider.id === 'microsoft' ? (
          <MicrosoftMark size={16} />
        ) : provider.id === 'google' ? (
          <GoogleMark size={16} />
        ) : provider.id === 'nextcloud' ? (
          <NextcloudMark size={18} />
        ) : (
          <Icon name="key" size={18} />
        ))}
      {primary ? provider.label : providerName(provider.label)}
    </Button>
  );
}

function PasskeyButton({ returnTo }: { returnTo: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        size="lg"
        variant="secondary"
        loading={busy}
        className="w-full gap-2.5"
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            loadPage((await signInWithPasskey(returnTo)).redirectTo);
          } catch (caught) {
            if (!isPasskeyCancel(caught)) setError(passkeyErrorMessage(caught));
            setBusy(false);
          }
        }}
      >
        {!busy && <PasskeyMark size={18} />}
        Mit Passkey anmelden
      </Button>
      {error && (
        <ErrorText role="alert" size="xs" className="text-left">
          {error}
        </ErrorText>
      )}
    </div>
  );
}
