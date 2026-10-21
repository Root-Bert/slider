import type { ReactNode } from 'react';
import type { To } from 'react-router';
import { cn, PageHeader, Toast, type ToastMessage } from '@/ui';
import { LegalLinks } from '@/features/legal';
import { AppHeader } from '../AppHeader';
import { LogoHeader } from './LogoHeader';

export interface SettingsLayoutProps {
  /** Document title (`<title>`), e.g. "Einstellungen | Slider". */
  docTitle: string;
  /** The page's `<h1>`. */
  title: ReactNode;
  subtitle?: ReactNode;
  /** Left of the title: avatar, workspace mark, icon. */
  leading?: ReactNode;
  /** "← Zurück zu den Reviews" above the title. */
  back?: { to: To; label?: string };
  /** Right end of the title row, e.g. a link to related settings. */
  actions?: ReactNode;
  /** `wide`: a 1280px column with the reviews page's gutters (dashboards); else 720px. */
  width?: 'default' | 'wide';
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
 * Shell of the settings-style pages (account, preferences, workspace settings, setup, the instance
 * dashboard): dot grid, header, a centred column (720px, or 1280px `wide`) with the page header
 * and the sections.
 */
export function SettingsLayout({
  docTitle,
  title,
  subtitle,
  leading,
  back,
  actions,
  width = 'default',
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
        className={cn(
          'flex justify-center px-4 pt-2 pb-16',
          logoOnly && 'flex-1',
          width === 'wide' && 'md:px-14',
        )}
      >
        <div
          className={cn(
            'flex w-full flex-col gap-6',
            width === 'wide' ? 'max-w-[1280px]' : 'max-w-[720px]',
          )}
        >
          <PageHeader
            title={title}
            subtitle={subtitle}
            leading={leading}
            back={back}
            actions={actions}
            truncate={truncate}
          />
          {children}
          <LegalLinks className="pt-4" />
        </div>
      </main>
      {toast !== undefined && <Toast toast={toast} />}
    </div>
  );
}
