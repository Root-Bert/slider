import { useSearchParams } from 'react-router';
import { routes } from '@/lib/routes';
import { SettingsLayout } from '@/shell/layouts/SettingsLayout';
import { isLoginError, LoginErrorBanner, useAccount } from '@/features/auth';
import { Avatar, ButtonLink, Section, TextField, useToast } from '@/ui';
import { LoginsSection, PasskeysSection } from './components/AccountSections';

/**
 * `/konto` – "Konto & Anmeldung": who you are, how you sign in (Microsoft, Google, SSO, e-mail)
 * and your passkeys. `?linkError=` after a failed "Verbinden". Your colour and how decks open
 * live on `/einstellungen`.
 */
export function Component() {
  const { user, viewer } = useAccount();
  const [toast, showToast] = useToast();
  const [searchParams] = useSearchParams();
  const linkError = searchParams.get('linkError');

  return (
    <SettingsLayout
      docTitle="Konto & Anmeldung · Slider"
      title="Konto & Anmeldung"
      leading={<Avatar author={viewer.author} size={32} />}
      back={{ to: routes.reviews() }}
      toast={toast}
    >
      {isLoginError(linkError) && <LoginErrorBanner code={linkError} />}

      <Section title="Profil" description="Name und Adresse kommen von deiner ersten Anmeldung.">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Name" value={user.name} readOnly />
          <TextField label="E-Mail" value={user.email} readOnly />
        </div>
      </Section>

      <LoginsSection microsoftConnected={user.microsoftConnected} onNotify={showToast} />
      <PasskeysSection onNotify={showToast} />

      {user.isInstanceAdmin && (
        <Section
          title="Diese Slider-Instanz"
          description="Du bist Admin: Anmeldewege, E-Mail-Versand und Registrierung für alle."
          aside={
            <ButtonLink
              to={routes.setup()}
              variant="secondary"
              size="sm"
              weight="normal"
              trailingIcon="arrowForward"
              iconSize={16}
            >
              Einrichtung
            </ButtonLink>
          }
        >
          {null}
        </Section>
      )}
    </SettingsLayout>
  );
}
