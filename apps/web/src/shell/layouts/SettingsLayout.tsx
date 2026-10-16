import type { ReactNode } from 'react';
import type { To } from 'react-router';
import { PageHeader, Toast, type ToastMessage } from '@/ui';
import { AppHeader } from '../AppHeader';
import { LogoHeader } from './LogoHeader';

export interface SettingsLayoutProps {
  /** Document title (`<title>`), e.g. "Einstellungen · Slider". */
  docTitle: string;
  /** The page's `<h1>`. */
  title: ReactNode;
  subtitle?: ReactNode;
  /** Left of the title: avatar, workspace mark, icon. */
  leading?: ReactNode;
  /** "← Zurück zu den Reviews" above the title. */
  back?: { to: To; label?: string };
  /** Cuts a long title off with an ellipsis (default on: names can be long). */
  truncate?: boolean;
  /** `app`: the member area's `AppHeader`. `logo`: only the logo (setup, before any login). */
  header?: 'app' | 'logo';
  /** The page's toast (from `useToast`), rendered at the bottom. */
  toast?: ToastMessage | null;
  /** The sections, stacked with 24px gaps in a 720px column. */
  children: ReactNode;
}

/**
 * Shell of the settings-style pages (account, preferences, workspace settings, setup): dot grid,
 * header, a centred 720px column with the page header and the sections.
 */
export function SettingsLayout({
  docTitle,
  title,
  subtitle,
  leading,
  back,
  truncate = true,
  header = 'app',
  toast,
  children,
}: SettingsLayoutProps) {
  const logoOnly = header === 'logo';
  return (
    <div className={logoOnly ? 'dot-grid flex min-h-full flex-col' : 'dot-grid min-h-full'}>
      <title>{docTitle}</title>
      {logoOnly ? <LogoHeader /> : <AppHeader />}
      <main
        className={
          logoOnly
            ? 'flex flex-1 justify-center px-4 pt-2 pb-16'
            : 'flex justify-center px-4 pt-2 pb-16'
        }
      >
        <div className="flex w-full max-w-[720px] flex-col gap-6">
          <PageHeader
            title={title}
            subtitle={subtitle}
            leading={leading}
            back={back}
            truncate={truncate}
          />
          {children}
        </div>
      </main>
      {toast !== undefined && <Toast toast={toast} />}
    </div>
  );
}
