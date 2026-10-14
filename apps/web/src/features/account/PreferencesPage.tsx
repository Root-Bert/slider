import { Link } from 'react-router';
import { AppHeader } from '@/app/AppHeader';
import { routes } from '@/app/routes';
import { useAccount } from '@/features/auth/useAccount';
import { Icon, Toast, useToast } from '@/ui';
import { SettingsSection } from '@/features/workspaces/components/SettingsSection';
import { ColorPicker, WorkSection } from './components/PreferenceSections';

/**
 * `/einstellungen` – "Einstellungen": your colour and how decks open. Kept apart from
 * "Konto & Anmeldung" (`/konto`), which is only about who you are and how you sign in.
 */
export function Component() {
  const { user } = useAccount();
  const [toast, showToast] = useToast();

  return (
    <div className="dot-grid min-h-full">
      <title>Einstellungen · Slider</title>
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
              <Icon name="settings" size={32} className="text-fg-muted" />
              <h1 className="min-w-0 truncate text-[28px] leading-tight font-semibold tracking-tight text-fg">
                Einstellungen
              </h1>
            </div>
          </div>

          <SettingsSection title="Darstellung" description="Gilt für alle deine Reviews.">
            <ColorPicker color={user.color} onNotify={showToast} />
          </SettingsSection>

          <WorkSection />
        </div>
      </main>
      <Toast toast={toast} />
    </div>
  );
}
