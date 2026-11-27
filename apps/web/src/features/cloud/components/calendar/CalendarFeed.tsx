import { useState } from 'react';
import { useCalendarFeed, useRenewCalendarFeed } from '@/lib/api';
import { Button, ConfirmDialog, Icon, ListRow, Menu, RowList, useCopyToClipboard } from '@/ui';
import { useCloud } from '../../hooks/useCloud';

const COPY_LABELS = { idle: 'Link kopieren', copied: 'Kopiert', failed: 'Nicht kopiert' } as const;

/**
 * „Kalender abonnieren“ under „Konten“: one's private calendar and one's areas' as one calendar in
 * Apple's or Google's – added once (iCloud carries it to every device), there only to look at.
 * „Abonnieren“ hands it to the calendar app of this device; the link goes into others („Per URL“).
 * A new link ends the old one.
 */
export function CalendarFeed() {
  const ui = useCloud();
  const feed = useCalendarFeed(ui.workspace.id).data;
  const renew = useRenewCalendarFeed(ui.workspace.id);
  const { state, copy } = useCopyToClipboard();
  const [renewing, setRenewing] = useState(false);
  const description = 'Privat und deine Bereiche in Apple- oder Google-Kalender, dort zum Ansehen.';
  return (
    <>
      <RowList variant="hover" aria-label="Kalender abonnieren">
        <ListRow
          variant="hover"
          padding="wide"
          leading={
            <span className="flex size-8 items-center justify-center rounded-chip bg-surface-2 text-fg-muted">
              <Icon name="sync" size={18} />
            </span>
          }
          title="Kalender abonnieren"
          subtitle={description}
          subtitleTitle={description}
          trailing={
            <div className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                disabled={!feed}
                onClick={() => {
                  if (feed) window.location.href = feed.url.replace(/^https?:/, 'webcal:');
                }}
              >
                Abonnieren
              </Button>
              <Button
                variant="ghost"
                size="sm"
                // On a phone the icon alone – a tick once copied – so the name keeps its room.
                icon={state === 'copied' ? 'check' : 'contentCopy'}
                disabled={!feed}
                onClick={() => feed && void copy(feed.url)}
              >
                <span className="max-sm:sr-only">{COPY_LABELS[state]}</span>
              </Button>
              <Menu
                label="Aktionen für das Abo"
                actions={[
                  { label: 'Neuer Link', icon: 'refresh', onSelect: () => setRenewing(true) },
                ]}
              />
            </div>
          }
        />
      </RowList>
      <p role="status" className="sr-only">
        {state === 'copied' ? 'Link kopiert' : state === 'failed' ? 'Kopieren fehlgeschlagen' : ''}
      </p>
      {renewing && (
        <ConfirmDialog
          onClose={() => setRenewing(false)}
          title="Neuen Link erstellen?"
          description="Wo der bisherige Link abonniert ist, kommen dann keine Termine mehr an."
          confirmLabel="Neuer Link"
          confirmIcon="refresh"
          pending={renew.isPending}
          onConfirm={() =>
            renew.mutate(undefined, {
              onSuccess: () => {
                setRenewing(false);
                ui.notify('Neuer Link erstellt – der bisherige geht nicht mehr');
              },
              onError: (error) => ui.notify(error.message, 'danger'),
            })
          }
        />
      )}
    </>
  );
}
