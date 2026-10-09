import { Link, useSearchParams } from 'react-router';
import { AppHeader } from '@/app/AppHeader';
import { routes } from '@/app/routes';
import { LoginErrorBanner } from '@/features/auth/components/LoginBits';
import { isLoginError } from '@/features/auth/lib/return-to';
import { useAccount } from '@/features/auth/useAccount';
import { Avatar, Icon, TextField, Toast, useToast } from '@/ui';
import { SettingsSection } from '@/features/workspaces/components/SettingsSection';
import { LoginsSection, PasskeysSection } from './components/AccountSections';
import { AvatarPicker } from './components/AvatarPicker';

/**
 * `/konto` – "Konto & Anmeldung": who you are, how you sign in (Microsoft, Google, SSO, e-mail)
 * and your passkeys. `?linkError=` after a failed "Verbinden".
 */
export function Component() {
  const { user, viewer } = useAccount();
  const [toast, showToast] = useToast();
  const [searchParams] = useSearchParams();
  const linkError = searchParams.get('linkError');

  return (
    <div className="dot-grid min-h-full">
      <title>Konto & Anmeldung · Slider</title>
      <AppHeader />
      <main className="flex justify-center px-4 pt-2 pb-16">
        <div className="flex w-full max-w-[720px] flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Link
              to={routes.reviews()}
              className="inline-flex w-fit items-center gap-1 text-[13px] text-fg-subtle hover:text-fg"
            >
              <Icon name="arrowBack" size={16} />
              Zurück zu den Reviews
            </Link>
            <div className="flex items-center gap-3">
              <Avatar author={{ ...viewer.author, avatarUrl: user.avatarUrl }} size={32} />
              <div className="flex min-w-0 flex-col">
                <h1 className="truncate text-[28px] leading-tight font-semibold tracking-tight text-fg">
                  Konto & Anmeldung
                </h1>
                <p className="truncate text-[13px] text-fg-subtle">{user.email}</p>
              </div>
            </div>
          </div>

          {isLoginError(linkError) && <LoginErrorBanner code={linkError} />}

          <SettingsSection
            title="Profil"
            description="Name und Adresse kommen von deiner ersten Anmeldung."
          >
            <AvatarPicker
              author={viewer.author}
              seeded={Boolean(user.avatarSeed)}
              onNotify={showToast}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Name" value={user.name} readOnly />
              <TextField label="E-Mail" value={user.email} readOnly />
            </div>
          </SettingsSection>

          <LoginsSection microsoftConnected={user.microsoftConnected} />
          <PasskeysSection onNotify={showToast} />

          {user.isInstanceAdmin && (
            <SettingsSection
              title="Diese Slider-Instanz"
              description="Du bist Admin: Anmeldewege, E-Mail-Versand und Registrierung für alle."
              aside={
                <Link
                  to={routes.setup()}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control-sm px-3 text-[13px] text-fg glass hover:bg-white/15"
                >
                  Einrichtung
                  <Icon name="arrowForward" size={16} />
                </Link>
              }
            >
              {null}
            </SettingsSection>
          )}
        </div>
      </main>
      <Toast toast={toast} />
    </div>
  );
}
