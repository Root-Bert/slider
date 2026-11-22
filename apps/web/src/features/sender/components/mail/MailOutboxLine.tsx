import { useEffect, useState } from 'react';
import type { MailOutbox } from '@slider/shared';
import { Icon } from '@/ui';
import { whenItGoes } from '../../lib/mail-address';

/** Now, anew each second while `on` – for a countdown. */
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [on]);
  return now;
}

const LINK =
  'rounded-chip px-1.5 py-0.5 font-semibold text-primary hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary';

/**
 * A mail written here that is not out yet, under its sender: waiting („Im Postausgang · geht in
 * 8 Sek. raus · Rückgängig“), on its way, or refused („Nicht gesendet: … · Erneut senden ·
 * Bearbeiten“). Taken back, its words come back into the field.
 */
export function MailOutboxLine({
  outbox,
  onTakeBack,
  onSendAgain,
}: {
  outbox: MailOutbox;
  onTakeBack: () => void;
  onSendAgain: () => void;
}) {
  const now = useNow(outbox.state === 'queued');
  if (outbox.state === 'failed') {
    return (
      <p
        role="alert"
        className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-danger"
      >
        <Icon name="error" size={16} className="shrink-0" />
        <span className="min-w-0">Nicht gesendet{outbox.error ? `: ${outbox.error}` : ''}</span>
        <button type="button" className={LINK} onClick={onSendAgain}>
          Erneut senden
        </button>
        <button type="button" className={LINK} onClick={onTakeBack}>
          Bearbeiten
        </button>
      </p>
    );
  }
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-fg-muted">
      <Icon name="schedule" size={16} className="shrink-0 text-fg-subtle" />
      {outbox.state === 'sending' ? (
        <span>Wird gesendet …</span>
      ) : (
        <>
          <span className="tabular-nums">
            Im Postausgang · geht {whenItGoes(outbox.at, now)} raus
          </span>
          <button type="button" className={LINK} onClick={onTakeBack}>
            Rückgängig
          </button>
        </>
      )}
    </p>
  );
}
