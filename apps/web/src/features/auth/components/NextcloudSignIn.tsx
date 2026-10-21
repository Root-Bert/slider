import { useState, type FormEvent } from 'react';
import type { NextcloudSignInPoll } from '@slider/shared';
import { useNextcloudFlow } from '@/features/nextcloud';
import { pollNextcloudSignIn, startNextcloudSignIn } from '@/lib/api';
import { Button, cn, Icon, NextcloudMark, Spinner, TextField, TextLink } from '@/ui';
import { BESIDE } from '../lib/beside';
import { NextcloudSafetyDialog } from './NextcloudSafetyDialog';

/** Full page load: the session cookie is set, everything cached belongs to "signed out". */
const go = (path: string) => window.location.assign(path);

/**
 * "Weiter mit Nextcloud" for any Nextcloud: the button opens a field for the address, then
 * Nextcloud's login in a popup (Login Flow v2). A known account is signed in right away; a new
 * one gets a confirmation link by mail first (`onConfirm`).
 *
 * `other`: the organisation's Nextcloud has its own button already – this is the quieter way
 * for every other one. `intent: 'connect'` (/konto) adds it as a login of the signed-in account;
 * the form is open from the start there and `onCancel` closes it. `beside`: next to other
 * login buttons – just "Nextcloud" on the button, the open form takes the whole row.
 */
export function NextcloudSignIn({
  returnTo,
  primary = false,
  other = false,
  beside = false,
  intent = 'login',
  onConfirm,
  onCancel,
}: {
  returnTo: string;
  primary?: boolean;
  other?: boolean;
  beside?: boolean;
  intent?: 'login' | 'connect';
  onConfirm?: (email: string) => void;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(intent === 'connect');
  const [explaining, setExplaining] = useState(false);
  const [server, setServer] = useState('');
  const { state, connect, cancel } = useNextcloudFlow(
    (typed) => startNextcloudSignIn({ server: typed ?? '', returnTo, intent }),
    pollNextcloudSignIn,
    (result: Exclude<NextcloudSignInPoll, { status: 'pending' | 'expired' }>) => {
      if (result.status === 'confirm') onConfirm?.(result.email);
      else go(result.redirectTo);
    },
  );
  const waiting = state.status === 'waiting';

  if (!open) {
    return other ? (
      <Button variant="ghost" size="sm" className="mx-auto" onClick={() => setOpen(true)}>
        Mit einer anderen Nextcloud anmelden
      </Button>
    ) : (
      <Button
        size="lg"
        variant={primary ? 'primary' : 'secondary'}
        aria-label={beside ? 'Weiter mit Nextcloud' : undefined}
        className={cn('gap-2.5', beside ? BESIDE : 'w-full')}
        onClick={() => setOpen(true)}
      >
        <NextcloudMark size={18} />
        {beside ? 'Nextcloud' : 'Weiter mit Nextcloud'}
      </Button>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void connect(server);
  };

  return (
    <>
      <form
        onSubmit={submit}
        className="flex basis-full animate-pop-in flex-col gap-3 rounded-panel p-3 text-left glass-control"
      >
        <TextField
          label="Adresse deiner Nextcloud"
          placeholder="cloud.firma.de"
          inputMode="url"
          autoComplete="url"
          autoFocus
          value={server}
          onChange={(event) => setServer(event.target.value)}
          disabled={waiting}
          error={state.status === 'error' ? state.message : null}
        />
        <div className="flex items-center gap-2">
          <Button type="submit" className="flex-1" disabled={waiting || !server.trim()}>
            {waiting ? <Spinner size={16} /> : <NextcloudMark size={16} />}
            {waiting ? 'Warte auf Nextcloud …' : 'Weiter'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              cancel();
              setOpen(false);
              onCancel?.();
            }}
          >
            Abbrechen
          </Button>
        </div>
        {state.status === 'waiting' && state.code ? (
          <div
            role="status"
            className="flex animate-pop-in flex-col items-center gap-2 rounded-control bg-warning/10 px-4 py-4 text-center"
          >
            <p className="text-body text-fg-muted">Nextcloud zeigt dir jetzt diesen Code:</p>
            <p className="font-mono text-display leading-9 font-semibold tracking-[0.3em] text-fg">
              {state.code}
            </p>
            <p className="text-xs leading-4.5 text-fg-subtle">
              Bestätige nur, wenn bei „Slider ({window.location.host})“ genau dieser Code steht.
            </p>
          </div>
        ) : null}
        {/* Login Flow v2 can't tell who confirms: a forwarded grant link signs its sender in. */}
        <p className="flex items-start gap-2 text-xs leading-4.5 text-fg-subtle">
          <Icon name="warning" size={16} className="shrink-0 text-warning" />
          <span>
            Nur bestätigen, wenn du die Anmeldung hier selbst gestartet hast.{' '}
            <TextLink onClick={() => setExplaining(true)} tone="muted">
              Mehr erfahren
            </TextLink>
          </span>
        </p>
      </form>
      <NextcloudSafetyDialog
        open={explaining}
        onClose={() => setExplaining(false)}
        linking={intent === 'connect'}
      />
    </>
  );
}
