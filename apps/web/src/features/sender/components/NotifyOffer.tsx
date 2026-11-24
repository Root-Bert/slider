import { AppTag } from '@/features/cloud';
import { askToNotify, useNotifyPrefs } from '@/lib/notify-prefs';
import { Button, Icon, Section, Toggle } from '@/ui';

const ABOUT = 'Sender meldet sich, wenn dir jemand schreibt, dich erwähnt oder anruft.';

/**
 * In the app's header beside the AI, in every app, while the browser was not asked yet:
 * notifications only come once one allows them, and browsers ask only at a click. „Später“
 * hides it in this browser – `/einstellungen` › Benachrichtigungen brings it back.
 */
export function NotifyOffer() {
  const { state, later, setLater } = useNotifyPrefs();
  if (state !== 'ask' || later) return null;
  return (
    <div
      title={ABOUT}
      className="glass flex h-9 shrink-0 items-center gap-1.5 rounded-control pr-1 pl-2.5 max-md:hidden"
    >
      <Icon name="notifications" size={16} className="text-fg-muted" />
      <span className="text-sm font-medium whitespace-nowrap text-fg">Nichts verpassen</span>
      <Button size="xs" variant="primary" className="ml-1" onClick={() => void askToNotify()}>
        Einschalten
      </Button>
      <Button size="xs" variant="ghost" onClick={() => setLater(true)}>
        Später
      </Button>
    </div>
  );
}

/**
 * Sender's notifications in `/einstellungen`: allow them (browsers ask only at a click), silence
 * them here once allowed, or bring back the offer in the header. A block in the browser is the
 * browser's to lift – it says where.
 */
export function NotifyPreferences() {
  const { state, later, muted, setLater, setMuted } = useNotifyPrefs();
  return (
    <Section
      id="benachrichtigungen"
      title="Benachrichtigungen"
      aside={<AppTag app="sender" />}
      description={`${ABOUT} Gilt für diesen Browser.`}
    >
      <div className="flex flex-col divide-y divide-hairline">
        {state === 'on' && (
          <Toggle
            className="pb-3"
            label="Am Computer melden"
            description="Nachrichten aus anderen Chats als dem offenen, Erwähnungen und Anrufe; Nachrichten auch, wenn Sender geschlossen ist"
            checked={!muted}
            onChange={(on) => setMuted(!on)}
          />
        )}
        {state === 'ask' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
              <span className="text-sm text-fg">
                Am Computer melden
                <span className="block text-xs text-fg-subtle">
                  Noch nicht erlaubt – der Browser fragt nach einem Klick
                </span>
              </span>
              <Button size="sm" variant="primary" onClick={() => void askToNotify()}>
                Einschalten
              </Button>
            </div>
            <Toggle
              className="pt-3"
              label="Oben anbieten"
              description="„Nichts verpassen“ im Kopf, bis du es einschaltest"
              checked={!later}
              onChange={(on) => setLater(!on)}
            />
          </>
        )}
        {state === 'off' && (
          <p className="text-sm text-fg">
            Im Browser blockiert
            <span className="block text-xs text-fg-subtle">
              Erlaube sie über das Symbol links in der Adressleiste (Website-Einstellungen).
            </span>
          </p>
        )}
        {state === 'none' && (
          <p className="text-sm text-fg-subtle">Dieser Browser zeigt keine Benachrichtigungen.</p>
        )}
      </div>
    </Section>
  );
}
