import { useId, useState } from 'react';
import type { AuthProviders, LoginProvider } from '@slider/shared';
import { ApiError } from '@/lib/api-client';
import { useStartEmailLogin } from '@/lib/workspace-queries';
import { Button, Icon, TextField } from '@/ui';
import { providerLoginUrl } from '../lib/return-to';
import { MicrosoftMark } from './MicrosoftMark';

/** Provider buttons and the magic-link form – or why there is nothing to sign in with. */
export function LoginOptions({ config, returnTo }: { config: AuthProviders; returnTo: string }) {
  const providers = config.providers.toSorted(
    (a, b) => Number(b.id === 'microsoft') - Number(a.id === 'microsoft'),
  );

  if (providers.length === 0 && !config.magicLink) {
    return (
      <div className="flex flex-col gap-2 rounded-control bg-white/5 px-4 py-3 text-left">
        <p className="flex items-center gap-2 text-sm font-medium text-fg">
          <Icon name="warning" size={18} className="text-warning" />
          Anmeldung nicht eingerichtet
        </p>
        <p className="text-[13px] leading-5 text-fg-subtle">
          Für diese Slider-Instanz ist noch keine Anmeldung konfiguriert. Wer Slider betreibt, muss
          Microsoft, einen SSO-Anbieter oder E-Mail einrichten – beschrieben in{' '}
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
      {config.magicLink && (
        <>
          {providers.length > 0 && (
            <p className="my-1 flex items-center gap-3 text-xs text-fg-subtle">
              <span aria-hidden className="h-px flex-1 bg-hairline" />
              oder per E-Mail
              <span aria-hidden className="h-px flex-1 bg-hairline" />
            </p>
          )}
          <MagicLinkForm returnTo={returnTo} />
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
        (provider.id === 'microsoft' ? <MicrosoftMark size={16} /> : <Icon name="key" size={18} />)}
      {provider.label}
    </Button>
  );
}

function MagicLinkForm({ returnTo }: { returnTo: string }) {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const start = useStartEmailLogin();
  const statusId = useId();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const error =
    start.error instanceof ApiError && start.error.status === 404
      ? 'Die Anmeldung per E-Mail ist auf diesem Server nicht eingerichtet.'
      : (start.error?.message ?? null);

  if (sentTo) {
    return (
      <div
        id={statusId}
        role="status"
        className="flex flex-col items-center gap-3 rounded-control bg-white/5 px-4 py-4"
      >
        <Icon name="send" size={22} className="text-fg-muted" />
        <p className="text-[13px] leading-5 text-fg-muted">
          Wir haben dir einen Link an <span className="font-medium text-fg">{sentTo}</span>{' '}
          geschickt, falls zu dieser Adresse ein Konto oder eine Einladung gehört. Der Link ist kurz
          gültig und funktioniert einmal.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSentTo(null);
            start.reset();
          }}
        >
          Andere Adresse verwenden
        </Button>
      </div>
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
        aria-label="E-Mail-Adresse"
        icon="at"
        size="lg"
        autoComplete="email"
        placeholder="name@firma.de"
        value={email}
        error={error}
        onChange={(event) => {
          setEmail(event.target.value);
          if (start.error) start.reset();
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
        Anmeldelink senden
      </Button>
    </form>
  );
}
