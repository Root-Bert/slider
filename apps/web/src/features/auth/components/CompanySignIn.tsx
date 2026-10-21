import { useEffect, useState, type FormEvent } from 'react';
import { discoverSso } from '@/lib/api';
import { Button, Icon, TextField } from '@/ui';
import { providerLoginUrl } from '../lib/return-to';

/**
 * "Mit Firmen-Login anmelden" (BER-162): some organisation on this instance has its own company
 * login. The address typed finds it, then the browser goes to the company's provider.
 */
export function CompanySignIn({ returnTo }: { returnTo: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Like the provider buttons: back from the provider via the back-forward cache, the form would
  // still be busy.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="mx-auto" onClick={() => setOpen(true)}>
        <Icon name="key" size={16} />
        Mit Firmen-Login anmelden
      </Button>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { loginUrl } = await discoverSso(email.trim());
      window.location.assign(providerLoginUrl(loginUrl, returnTo));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Das hat nicht geklappt.');
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex animate-pop-in flex-col gap-3 rounded-panel p-3 text-left glass-control"
    >
      <TextField
        label="Deine Firmen-Adresse"
        type="email"
        placeholder="name@firma.de"
        autoComplete="email"
        autoFocus
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        disabled={busy}
        error={error}
      />
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
