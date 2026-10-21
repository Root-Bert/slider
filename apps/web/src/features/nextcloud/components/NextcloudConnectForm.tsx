import { useState, type FormEvent } from 'react';
import type { NextcloudConnection } from '@slider/shared';
import { useNextcloudSettings } from '@/lib/api';
import { Button, cn, NextcloudMark, Notice, Spinner, TextField } from '@/ui';
import { useNextcloudConnect } from '../hooks/useNextcloudConnect';
import { nextcloudHost } from '../lib/host';

/**
 * Connects a Nextcloud account: the address (unless the organisation's Nextcloud is fixed on
 * `/einrichtung`), then Nextcloud's login in a popup. Says plainly what an app password can do.
 */
export function NextcloudConnectForm({
  initialServer = '',
  onConnected,
  label = 'Mit Nextcloud verbinden',
  className,
}: {
  initialServer?: string;
  onConnected: (connection: NextcloudConnection) => void;
  label?: string;
  className?: string;
}) {
  const settings = useNextcloudSettings();
  const fixed = settings.data?.server ?? null;
  const [server, setServer] = useState(initialServer);
  const { state, connect, cancel } = useNextcloudConnect(onConnected);
  const waiting = state.status === 'waiting';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void connect(fixed ? undefined : server);
  };

  return (
    <form onSubmit={submit} className={cn('flex flex-col gap-3', className)}>
      {!fixed && (
        <TextField
          label="Adresse deiner Nextcloud"
          placeholder="cloud.firma.de"
          inputMode="url"
          autoComplete="url"
          value={server}
          onChange={(event) => setServer(event.target.value)}
          disabled={waiting}
          error={state.status === 'error' ? state.message : null}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={waiting || (!fixed && !server.trim())}>
          {waiting ? <Spinner size={16} /> : <NextcloudMark size={16} />}
          {fixed ? `${label} (${nextcloudHost(fixed)})` : label}
        </Button>
        {waiting && (
          <>
            <span className="text-body text-fg-subtle">Melde dich im neuen Fenster an …</span>
            <Button variant="ghost" size="sm" onClick={cancel}>
              Abbrechen
            </Button>
          </>
        )}
      </div>
      {fixed && state.status === 'error' && <p className="text-sm text-danger">{state.message}</p>}
      <Notice tone="neutral" variant="inline" icon="lock">
        Nextcloud erlaubt keine Nur-Lese-Freigabe. Slider liest nur Präsentationen und ändert
        nichts. Du kannst den Zugriff jederzeit in Nextcloud unter Einstellungen → Sicherheit
        („Slider“) widerrufen.
      </Notice>
    </form>
  );
}
