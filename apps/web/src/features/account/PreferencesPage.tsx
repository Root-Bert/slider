import { SettingsLayout } from '@/shell/layouts/SettingsLayout';
import { useAccount } from '@/features/auth';
import { CalendarPreferences, canPlaceApps, FilesPreferences } from '@/features/cloud';
import { MailPreferences, NotifyPreferences } from '@/features/sender';
import { loadedVersion, useNewerVersion } from '@/lib/app-version';
import { Button, Icon, Section, useToast, type IconName } from '@/ui';
import { CallVoiceSection } from './components/CallVoiceSection';
import {
  AppsSection,
  ColorPicker,
  ViewDefaultChoice,
  WorkSection,
} from './components/PreferenceSections';

/** The page's sections, in order, for the nav at the side. */
const NAV = [
  { id: 'darstellung', title: 'Darstellung', icon: 'palette' },
  { id: 'anrufe', title: 'Anrufe', icon: 'call' },
  { id: 'benachrichtigungen', title: 'Benachrichtigungen', icon: 'notifications' },
  // Cloud's app only: where each app's pages open.
  ...(canPlaceApps() ? ([{ id: 'apps', title: 'Apps', icon: 'apps' }] as const) : []),
  { id: 'dateien', title: 'Dateien', icon: 'folder' },
  { id: 'kalender', title: 'Kalender', icon: 'calendar' },
  { id: 'arbeiten', title: 'Präsentationen', icon: 'slideshow' },
  { id: 'mail', title: 'Post', icon: 'mail' },
  { id: 'version', title: 'Version', icon: 'info' },
] as const satisfies readonly { id: string; title: string; icon: IconName }[];

/**
 * `/einstellungen` – "Einstellungen": one page for all your own, whichever app you came from –
 * your colour first (every app), the voice agents speak with in your calls, then each app's part,
 * marked with its sign: how the files open (Cloud), how presentations open (Slider), how the mail list looks (Sender). Kept apart from "Konto & Anmeldung" (`/konto`), which
 * is only about who you are and how you sign in, and from the instance's own pages (`/instanz`,
 * `/einrichtung`), reached by the account menu.
 */
export function Component() {
  const { user, version } = useAccount();
  // The release this page runs – `/me` already names the server's, newer once one came out.
  const running = loadedVersion() ?? version;
  const newer = useNewerVersion();
  const [toast, showToast] = useToast();

  return (
    <SettingsLayout
      docTitle="Einstellungen | Slider"
      title="Einstellungen"
      leading={<Icon name="settings" size={32} className="text-fg-muted" />}
      back="app"
      nav={NAV}
      toast={toast}
    >
      <Section id="darstellung" title="Darstellung" description="Gilt überall, in jeder App.">
        <div className="flex flex-col divide-y divide-hairline">
          <div className="pb-3">
            <ColorPicker color={user.color} onNotify={showToast} />
          </div>
          <ViewDefaultChoice />
        </div>
      </Section>
      <CallVoiceSection onNotify={showToast} />
      <NotifyPreferences />
      <AppsSection />
      <FilesPreferences onNotify={showToast} />
      <CalendarPreferences onNotify={showToast} />
      <WorkSection />
      <MailPreferences />
      <Section id="version" title="Version">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-sm text-fg">
            {running ? `Version ${running}` : 'Entwicklungsversion'}
            {newer && <span className="text-fg-muted"> | Version {newer} ist da</span>}
          </p>
          {newer && (
            <Button size="sm" icon="refresh" onClick={() => window.location.reload()}>
              Neu laden
            </Button>
          )}
        </div>
      </Section>
    </SettingsLayout>
  );
}
