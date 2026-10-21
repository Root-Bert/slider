import { useState, type FormEvent } from 'react';
import { discoverSso, startEmailLogin } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { useOnPageRestore } from '@/lib/page-restore';
import { Button, ErrorText, Icon, Notice, TextField } from '@/ui';
import { providerLoginUrl } from '../lib/return-to';

/**
 * The address field of the login page. With login links (`links`, BER-168) it is always there –
 * "Mit E-Mail fortfahren", an account by mail, no password. With only company logins (`sso`,
 * BER-162) it opens from "Mit Firmen-Login anmelden". With company logins on the instance it
 * first looks for the address's and goes there; any other address gets the link – or, without
 * links, the reason there is none.
 */
export function EmailSignIn({
  returnTo,
  sso,
  links,
}: {
  returnTo: string;
  sso: boolean;
  links: boolean;
}) {
  const [open, setOpen] = useState(links);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  // Back from the company's provider with the browser's back button: not busy any more.
  useOnPageRestore(() => setBusy(false));

  /** `discover`: look for a company login first – not again for an address that had none. */
  const send = async (address: string, discover = sso) => {
    setBusy(true);
    setError(null);
    try {
      if (discover) {
        try {
          const { loginUrl } = await discoverSso(address);
          window.location.assign(providerLoginUrl(loginUrl, returnTo));
          return;
        } catch (caught) {
          // No company login for the address: the link it is, where there are links.
          if (!links || !(caught instanceof ApiError && caught.status === 404)) throw caught;
        }
      }
      await startEmailLogin({ email: address, returnTo });
      setSent(address);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Das hat nicht geklappt.');
    }
    setBusy(false);
  };

  if (sent) {
    return (
      <div className="flex w-full animate-pop-in flex-col gap-3">
        <Notice tone="success" title="Schau in dein Postfach">
          Wir haben eine Mail an <strong className="text-fg">{sent}</strong> geschickt. Öffne den
          Link darin in diesem Browser, er gilt 15 Minuten.
        </Notice>
        <div className="flex items-center justify-center gap-2">
          <Button variant="ghost" size="sm" loading={busy} onClick={() => void send(sent, false)}>
            Nicht angekommen? Erneut senden
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSent(null)}>
            Andere Adresse
          </Button>
        </div>
        {error && (
          <ErrorText role="alert" size="xs">
            {error}
          </ErrorText>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="mx-auto" onClick={() => setOpen(true)}>
        <Icon name="key" size={16} />
        Mit Firmen-Login anmelden
      </Button>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(email.trim());
  };

  const field = (
    <TextField
      label={links ? 'E-Mail-Adresse' : 'Deine Firmen-Adresse'}
      type="email"
      placeholder="name@firma.de"
      autoComplete="email"
      autoFocus={!links}
      value={email}
      onChange={(event) => setEmail(event.target.value)}
      disabled={busy}
      error={error}
    />
  );

  if (links) {
    return (
      <form onSubmit={submit} className="flex flex-col gap-3 text-left">
        {field}
        <Button
          type="submit"
          size="lg"
          variant="secondary"
          className="w-full"
          loading={busy}
          disabled={!email.includes('@')}
        >
          Mit E-Mail fortfahren
        </Button>
      </form>
    );
  }
  return (
    <form
      onSubmit={submit}
      className="flex animate-pop-in flex-col gap-3 rounded-panel p-3 text-left glass-control"
    >
      {field}
      <div className="flex items-center gap-2">
        <Button type="submit" className="flex-1" loading={busy} disabled={!email.includes('@')}>
          Weiter
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Abbrechen
        </Button>
      </div>
    </form>
  );
}
