import { WebAuthnAbortService } from '@simplewebauthn/browser';
import { useEffect, useId, useRef, useState } from 'react';
import { LOGIN_CODE_LENGTH, type AuthProviders, type LoginProvider } from '@slider/shared';
import { ApiError } from '@/lib/api-client';
import { useStartEmailLogin, useVerifyEmailCode } from '@/lib/workspace-queries';
import { Button, Icon, TextField } from '@/ui';
import {
  isPasskeyCancel,
  passkeyAutofillSupported,
  passkeyErrorMessage,
  passkeysSupported,
  signInWithPasskey,
} from '../lib/passkeys';
import { providerLoginUrl } from '../lib/return-to';
import { GoogleMark } from './GoogleMark';
import { MicrosoftMark } from './MicrosoftMark';
import { PasskeyMark } from './PasskeyMark';

const PROVIDER_ORDER: LoginProvider['id'][] = ['microsoft', 'google', 'oidc'];

/** Full page load: the session cookie is set, everything cached belongs to "signed out". */
const go = (path: string) => window.location.assign(path);

/**
 * Provider buttons, passkey and e-mail (link + code) – or why there is nothing to sign in with.
 */
export function LoginOptions({ config, returnTo }: { config: AuthProviders; returnTo: string }) {
  const providers = config.providers.toSorted(
    (a, b) => PROVIDER_ORDER.indexOf(a.id) - PROVIDER_ORDER.indexOf(b.id),
  );
  // Passkeys only sign into existing accounts, which need one of the other logins first.
  const [passkeys] = useState(passkeysSupported);

  if (providers.length === 0 && !config.magicLink) {
    return (
      <div className="flex flex-col gap-2 rounded-control bg-white/5 px-4 py-3 text-left">
        <p className="flex items-center gap-2 text-sm font-medium text-fg">
          <Icon name="warning" size={18} className="text-warning" />
          Anmeldung nicht eingerichtet
        </p>
        <p className="text-[13px] leading-5 text-fg-subtle">
          Für diese Slider-Instanz ist noch keine Anmeldung konfiguriert. Wer Slider betreibt, muss
          Microsoft, Google, einen SSO-Anbieter oder E-Mail einrichten – beschrieben in{' '}
          <code className="rounded-badge bg-white/8 px-1 py-0.5 text-xs text-fg-muted">
            docs/self-hosting.md
          </code>
          , Abschnitt „Login einrichten“.
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
      {passkeys && (
        <PasskeyButton returnTo={returnTo} primary={providers.length === 0 && !config.magicLink} />
      )}
      {config.magicLink && (
        <>
          <p className="my-1 flex items-center gap-3 text-xs text-fg-subtle">
            <span aria-hidden className="h-px flex-1 bg-hairline" />
            oder per E-Mail
            <span aria-hidden className="h-px flex-1 bg-hairline" />
          </p>
          <EmailLogin returnTo={returnTo} passkeyAutofill={passkeys} />
        </>
      )}
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

function PasskeyButton({ returnTo, primary }: { returnTo: string; primary: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        size="lg"
        variant={primary ? 'primary' : 'secondary'}
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

/** Address → mail with link and code → code entry (or the link from the mail). */
function EmailLogin({ returnTo, passkeyAutofill }: { returnTo: string; passkeyAutofill: boolean }) {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [autofillError, setAutofillError] = useState<string | null>(null);
  const start = useStartEmailLogin();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const error =
    start.error instanceof ApiError && start.error.status === 404
      ? 'Die Anmeldung per E-Mail ist auf diesem Server nicht eingerichtet.'
      : (start.error?.message ?? autofillError);

  // Conditional UI: saved passkeys appear among the e-mail field's suggestions.
  useEffect(() => {
    if (!passkeyAutofill || sentTo) return;
    let active = true;
    void passkeyAutofillSupported().then((supported) => {
      if (!supported || !active) return;
      signInWithPasskey(returnTo, { autofill: true }).then(
        (result) => go(result.redirectTo),
        (caught: unknown) => {
          // Runs in the background: only a passkey the server refused is worth a message.
          if (active && caught instanceof ApiError) setAutofillError(passkeyErrorMessage(caught));
        },
      );
    });
    return () => {
      active = false;
      WebAuthnAbortService.cancelCeremony();
    };
  }, [passkeyAutofill, returnTo, sentTo]);

  if (sentTo) {
    return (
      <CodeStep
        email={sentTo}
        onBack={() => {
          setSentTo(null);
          start.reset();
        }}
      />
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-3 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        const address = email.trim();
        start.mutate({ email: address, returnTo }, { onSuccess: () => setSentTo(address) });
      }}
    >
      <TextField
        type="email"
        name="email"
        aria-label="E-Mail-Adresse"
        icon="at"
        size="lg"
        autoComplete={passkeyAutofill ? 'username webauthn' : 'email'}
        placeholder="name@firma.de"
        value={email}
        error={error}
        onChange={(event) => {
          setEmail(event.target.value);
          if (start.error) start.reset();
          setAutofillError(null);
        }}
      />
      <Button
        type="submit"
        size="lg"
        variant="secondary"
        className="w-full"
        disabled={!valid}
        loading={start.isPending}
      >
        Weiter mit E-Mail
      </Button>
    </form>
  );
}

/** "Code eingeben": one numeric field – takes pasted codes with spaces, submits at 6 digits. */
function CodeStep({ email, onBack }: { email: string; onBack: () => void }) {
  const [code, setCode] = useState('');
  const verify = useVerifyEmailCode();
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const complete = code.length === LOGIN_CODE_LENGTH;

  const submit = (value: string) => {
    if (value.length !== LOGIN_CODE_LENGTH || verify.isPending) return;
    verify.mutate(
      { email, code: value },
      {
        onSuccess: (result) => go(result.redirectTo),
        onError: () => {
          setCode('');
          inputRef.current?.focus();
        },
      },
    );
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-4 rounded-control bg-white/5 px-4 py-5 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        submit(code);
      }}
    >
      <div className="flex flex-col gap-1">
        <p className="flex items-center gap-2 text-sm font-medium text-fg">
          <Icon name="send" size={18} className="text-fg-muted" />
          Code eingeben
        </p>
        <p id={hintId} className="text-[13px] leading-5 text-fg-muted">
          Wir haben eine Mail an <span className="font-medium text-fg">{email}</span> geschickt,
          falls zu dieser Adresse ein Konto oder eine Einladung gehört. Gib den 6-stelligen Code
          daraus ein.
        </p>
      </div>
      <label className="sr-only" htmlFor={`${hintId}-code`}>
        6-stelliger Code
      </label>
      <input
        ref={inputRef}
        id={`${hintId}-code`}
        // Autofocus: the person comes here to type the code.
        autoFocus
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={LOGIN_CODE_LENGTH + 2}
        aria-describedby={hintId}
        aria-invalid={verify.isError || undefined}
        placeholder="000000"
        value={code}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '').slice(0, LOGIN_CODE_LENGTH);
          setCode(digits);
          if (verify.error) verify.reset();
          if (digits.length === LOGIN_CODE_LENGTH) submit(digits);
        }}
        className={`glass h-14 w-full rounded-control text-center font-mono text-[26px] font-semibold tracking-[0.45em] text-fg outline-none placeholder:text-fg-subtle/40 focus:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.35)] ${
          verify.isError ? 'shadow-[inset_0_0_0_1px_var(--color-danger)]' : ''
        }`}
      />
      {verify.error && (
        <p role="alert" className="-mt-2 text-xs text-danger">
          {verify.error.message}
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={!complete}
        loading={verify.isPending}
      >
        Anmelden
      </Button>
      <p className="text-center text-[13px] leading-5 text-fg-subtle">
        Oder klicke auf den Link in der Mail.
      </p>
      <Button variant="ghost" size="sm" className="self-center" onClick={onBack}>
        Andere Adresse verwenden
      </Button>
    </form>
  );
}
