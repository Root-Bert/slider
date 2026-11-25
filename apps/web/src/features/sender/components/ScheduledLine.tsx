import { useEffect, useState } from 'react';
import type { SenderScheduled } from '@slider/shared';
import { ConfirmDialog, Icon } from '@/ui';
import { whenPlanned } from '../lib/later';
import { markupPlain } from '../lib/markup';

const LINK =
  'shrink-0 rounded-chip px-1.5 py-0.5 font-semibold text-primary hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary';

/** Now, anew each minute – „heute“ turns into „morgen“ while the page stands. */
function useMinute() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * One's planned messages of a conversation, above its field („Später senden“) – seen by oneself
 * alone: when each goes and what it says, „Jetzt senden“, „Bearbeiten“ (back into the field),
 * „Löschen“. Refused when due: „Nicht gesendet: …“ with „Erneut senden“ (as `MailOutboxLine`).
 */
export function ScheduledLines({
  planned,
  onSendNow,
  onEdit,
  onDelete,
}: {
  planned: readonly SenderScheduled[];
  onSendNow: (one: SenderScheduled) => void;
  onEdit: (one: SenderScheduled) => void;
  onDelete: (one: SenderScheduled) => void;
}) {
  const now = useMinute();
  // „Löschen“ asks first, as a draft's: what was written is gone then.
  const [deleting, setDeleting] = useState<SenderScheduled | null>(null);
  if (planned.length === 0) return null;
  return (
    <>
      {deleting && (
        <ConfirmDialog
          onClose={() => setDeleting(null)}
          title="Geplante Nachricht löschen?"
          description="Sie wird nicht gesendet – was du geschrieben hast, ist dann weg."
          confirmLabel="Löschen"
          confirmIcon="delete"
          onConfirm={() => {
            onDelete(deleting);
            setDeleting(null);
          }}
        />
      )}
      <ul aria-label="Geplante Nachrichten" className="flex flex-col gap-0.5 px-1">
        {planned.map((one) => {
          const what = markupPlain(one.text) || one.attachments.map((file) => file.name).join(', ');
          const failed = one.state === 'failed';
          // An agent's goes in its name, words only: sent again or deleted, not typed on.
          const own = !one.agent;
          return (
            <li
              key={one.id}
              role={failed ? 'alert' : undefined}
              className={
                failed
                  ? 'flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-danger'
                  : 'flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-fg-muted'
              }
            >
              <span className="flex max-w-full min-w-0 items-center gap-1">
                <Icon
                  name={failed ? 'error' : 'schedule'}
                  size={16}
                  className={failed ? 'shrink-0' : 'shrink-0 text-fg-subtle'}
                />
                <span className="shrink-0 tabular-nums">
                  {failed
                    ? `Nicht gesendet${one.error ? `: ${one.error}` : ''}`
                    : one.state === 'sending'
                      ? 'Wird gesendet …'
                      : `${one.agent ? `${one.agent.title} sendet` : 'Geht'} ${whenPlanned(one.sendAt, now)}`}
                </span>
                <span className="max-w-80 min-w-0 truncate text-fg-subtle" title={what}>
                  {' | '}
                  {what}
                </span>
              </span>
              {one.state !== 'sending' && (
                <span className="flex shrink-0 items-center">
                  <button type="button" className={LINK} onClick={() => onSendNow(one)}>
                    {failed ? 'Erneut senden' : 'Jetzt senden'}
                  </button>
                  {own && (
                    <button type="button" className={LINK} onClick={() => onEdit(one)}>
                      Bearbeiten
                    </button>
                  )}
                  <button type="button" className={LINK} onClick={() => setDeleting(one)}>
                    Löschen
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
