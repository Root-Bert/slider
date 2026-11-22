import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import { AppLogo } from '@/features/cloud';
import { appStart, showAppManifest, useCurrentApp, type AppId } from '@/lib/apps';
import { EmptyState } from '@/ui';

/**
 * Full-page message on the dot grid: the logo of the app one is in (back to its start), title,
 * text, actions.
 */
export function CenteredMessage({
  app: given,
  title,
  message,
  children,
}: {
  /** The app it wears; the one one is in by default. */
  app?: AppId;
  title: string;
  message: string;
  children?: ReactNode;
}) {
  const current = useCurrentApp();
  const app = given ?? current;
  const home = appStart(app);
  // The tab wears the app too (`AppHeader` does so on the app's pages).
  useEffect(() => showAppManifest(app), [app]);
  return (
    <main className="dot-grid flex min-h-full flex-col items-center justify-center p-6">
      <EmptyState
        size="lg"
        illustration={
          <Link
            to={home.to}
            aria-label={home.label}
            className="transition-opacity hover:opacity-80"
          >
            <AppLogo app={app} />
          </Link>
        }
        title={title}
        message={message}
        action={children}
      />
    </main>
  );
}
