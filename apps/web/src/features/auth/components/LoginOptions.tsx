import { useState } from 'react';
import type { AuthProviders, LoginProvider } from '@slider/shared';
import { Button, GoogleMark, Icon, MicrosoftMark, PasskeyMark } from '@/ui';
import {
  isPasskeyCancel,
  passkeyErrorMessage,
  passkeysSupported,
  signInWithPasskey,
} from '@/lib/passkeys';
import { providerLoginUrl } from '../lib/return-to';

const PROVIDER_ORDER: LoginProvider['id'][] = ['microsoft', 'google', 'oidc'];

/** Full page load: the session cookie is set, everything cached belongs to "signed out". */
const go = (path: string) => window.location.assign(path);

/**
 * Provider buttons and passkey – or why there is nothing to sign in with.
 */
export function LoginOptions({ config, returnTo }: { config: AuthProviders; returnTo: string }) {
  const providers = config.providers.toSorted(
    (a, b) => PROVIDER_ORDER.indexOf(a.id) - PROVIDER_ORDER.indexOf(b.id),
  );
  // Passkeys only sign into existing accounts, which need one of the other logins first.
  const [passkeys] = useState(passkeysSupported);

  if (providers.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-control bg-white/5 px-4 py-3 text-left">
        <p className="flex items-center gap-2 text-sm font-medium text-fg">
          <Icon name="warning" size={18} className="text-warning" />
          Anmeldung nicht eingerichtet
        </p>
        <p className="text-[13px] leading-5 text-fg-subtle">
          Für diese Slider-Instanz ist noch keine Anmeldung konfiguriert. Wer Slider betreibt,
          findet im Server-Log einen Einrichtungslink (
          <code className="rounded-badge bg-white/8 px-1 py-0.5 text-xs text-fg-muted">
            /einrichtung#token=…
          </code>
          ) und richtet dort Microsoft, Google oder SSO ein.
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {providers.map((provider, index) => (
        <ProviderButton
          key={provider.id}
          provider={provider}
          returnTo={returnTo}
          primary={index === 0}
        />
      ))}
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
  return (
    <Button
      size="lg"
      variant={primary ? 'primary' : 'secondary'}
      loading={leaving}
      className="w-full gap-2.5"
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
        ) : (
          <Icon name="key" size={18} />
        ))}
      {provider.label}
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
            go((await signInWithPasskey(returnTo)).redirectTo);
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
        <p role="alert" className="text-left text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
