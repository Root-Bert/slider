import { routes } from '@/lib/routes';
import { SettingsLayout } from '@/shell/layouts/SettingsLayout';
import { useAccount } from '@/features/auth';
import { Icon, Section, useToast } from '@/ui';
import { ColorPicker, WorkSection } from './components/PreferenceSections';

/**
 * `/einstellungen` – "Einstellungen": your colour and how decks open. Kept apart from
 * "Konto & Anmeldung" (`/konto`), which is only about who you are and how you sign in, and from
 * the instance's own pages (`/instanz`, `/einrichtung`), reached by the account menu.
 */
export function Component() {
  const { user } = useAccount();
  const [toast, showToast] = useToast();

  return (
    <SettingsLayout
      docTitle="Einstellungen | Slider"
      title="Einstellungen"
      leading={<Icon name="settings" size={32} className="text-fg-muted" />}
      back={{ to: routes.reviews() }}
      toast={toast}
    >
      <Section title="Darstellung" description="Gilt für alle deine Reviews.">
        <ColorPicker color={user.color} onNotify={showToast} />
      </Section>

      <WorkSection />
    </SettingsLayout>
  );
}
