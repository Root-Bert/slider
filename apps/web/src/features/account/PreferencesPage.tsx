import { routes } from '@/lib/routes';
import { SettingsLayout } from '@/shell/layouts/SettingsLayout';
import { useAccount } from '@/features/auth';
import { ButtonLink, Icon, Section, useToast } from '@/ui';
import { ColorPicker, WorkSection } from './components/PreferenceSections';

/**
 * `/einstellungen` – "Einstellungen": your colour, how decks open and, for the instance admin,
 * the way to `/instanz` (numbers, workspaces, accounts) and from there to `/einrichtung`
 * (logins, mail, sign-up, imprint and privacy policy). Kept apart from
 * "Konto & Anmeldung" (`/konto`), which is only about who you are and how you sign in.
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

      {user.isInstanceAdmin && (
        <Section
          title="Instanz"
          description="Du bist Admin: Zahlen, Workspaces und Personen, Anmeldewege, E-Mail-Versand, Impressum und Datenschutz."
          aside={
            <ButtonLink
              to={routes.instance()}
              variant="secondary"
              size="sm"
              weight="normal"
              trailingIcon="arrowForward"
              iconSize={16}
            >
              Verwalten
            </ButtonLink>
          }
        >
          {null}
        </Section>
      )}
    </SettingsLayout>
  );
}
