import type { MailSyncMinutes } from '@slider/shared';
import { AppTag } from '@/features/cloud';
import { useMailSync, useSetMailSync } from '@/lib/api';
import { Section, SegmentedControl } from '@/ui';
import {
  useMailListLook,
  type MailDelay,
  type MailPictures,
  type MailPreview,
  type MailSpacing,
} from '../../hooks/useMailListLook';

const SPACING_SEGMENTS = [
  { value: 'compact', label: 'Kompakt' },
  { value: 'normal', label: 'Normal' },
  { value: 'airy', label: 'Luftig' },
] as const satisfies readonly { value: MailSpacing; label: string }[];

const PREVIEW_SEGMENTS = [
  { value: '0', label: 'Keine' },
  { value: '1', label: '1 Zeile' },
  { value: '2', label: '2 Zeilen' },
  { value: '3', label: '3 Zeilen' },
] as const;

const PICTURE_SEGMENTS = [
  { value: 'ask', label: 'Nachfragen' },
  { value: 'always', label: 'Immer laden' },
] as const satisfies readonly { value: MailPictures; label: string }[];

const DELAY_SEGMENTS = [
  { value: '0', label: 'Sofort' },
  { value: '10', label: '10 Sek.' },
  { value: '30', label: '30 Sek.' },
  { value: '60', label: '1 Min.' },
  { value: '300', label: '5 Min.' },
] as const satisfies readonly { value: `${MailDelay}`; label: string }[];

const SYNC_SEGMENTS = [
  { value: '1', label: 'Jede Min.' },
  { value: '5', label: '5 Min.' },
  { value: '15', label: '15 Min.' },
  { value: '60', label: '1 Std.' },
  { value: '0', label: 'Von Hand' },
] as const satisfies readonly { value: `${MailSyncMinutes}`; label: string }[];

/**
 * Sender's part of `/einstellungen`, marked as Sender's: how the list of mails looks – room
 * between them, how many lines under the sender – and whether an open mail's pictures from outside
 * load at once. Shows at once in every mail list (Sender, Cloud,
 * beside an open mail), kept in this browser.
 */
export function MailPreferences() {
  const [look, setLook] = useMailListLook();
  const sync = useMailSync().data;
  const setSync = useSetMailSync();
  const syncValue = sync ? (String(sync.minutes) as `${MailSyncMinutes}`) : null;
  return (
    <Section
      id="mail"
      title="Post"
      aside={<AppTag app="sender" />}
      description="So zeigen sich Mails und ihre Liste, in Sender und in Cloud. Gilt für diesen Browser."
    >
      <div className="flex flex-col divide-y divide-hairline">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
          <span className="text-sm text-fg">
            Abstand
            <span className="block text-xs text-fg-subtle">Zwischen den Mails in der Liste</span>
          </span>
          <SegmentedControl
            label="Abstand"
            size="sm"
            track="soft"
            segments={SPACING_SEGMENTS}
            value={look.spacing}
            onChange={(spacing) => setLook({ spacing })}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 py-3">
          <span className="text-sm text-fg">
            Vorschau
            <span className="block text-xs text-fg-subtle">
              Zeilen unter dem Absender – Betreff und Anfang der Mail
            </span>
          </span>
          <SegmentedControl
            label="Vorschau"
            size="sm"
            track="soft"
            segments={PREVIEW_SEGMENTS}
            value={String(look.preview) as `${MailPreview}`}
            onChange={(preview) => setLook({ preview: Number(preview) as MailPreview })}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 py-3">
          <span className="text-sm text-fg">
            Bilder von außen
            <span className="block text-xs text-fg-subtle">
              Laden verrät dem Absender, dass du die Mail geöffnet hast
            </span>
          </span>
          <SegmentedControl
            label="Bilder von außen"
            size="sm"
            track="soft"
            segments={PICTURE_SEGMENTS}
            value={look.pictures}
            onChange={(pictures) => setLook({ pictures })}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
          <span className="text-sm text-fg">
            Senden verzögern
            <span className="block text-xs text-fg-subtle">
              So lange liegt eine Mail im Postausgang – bis dahin holst du sie zurück
            </span>
          </span>
          <SegmentedControl
            label="Senden verzögern"
            size="sm"
            track="soft"
            segments={DELAY_SEGMENTS}
            value={String(look.delay) as `${MailDelay}`}
            onChange={(delay) => setLook({ delay: Number(delay) as MailDelay })}
          />
        </div>
        {syncValue && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
            <span className="text-sm text-fg">
              Abrufen
              <span className="block text-xs text-fg-subtle">
                So oft holt Slider neue Mails – „Abrufen“ über der Liste holt sie jederzeit. Gilt
                für alle deine Postfächer
              </span>
            </span>
            <SegmentedControl
              label="Abrufen"
              size="sm"
              track="soft"
              segments={SYNC_SEGMENTS}
              value={syncValue}
              onChange={(minutes) => setSync.mutate(Number(minutes) as MailSyncMinutes)}
            />
          </div>
        )}
      </div>
    </Section>
  );
}
