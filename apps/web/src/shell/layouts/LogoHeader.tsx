import { useEffect, type ReactNode } from 'react';
import { Link, type To } from 'react-router';
import { AppLogo } from '@/features/cloud';
import { showAppManifest, type AppId } from '@/lib/apps';

/**
 * The 88px header of pages outside the app shell (login, join, setup): the logo of the app the
 * page wears – the tab's icon and manifest follow it –, optionally a link home, and something at
 * the right end (the account menu).
 */
export function LogoHeader({
  app,
  logoLink,
  end,
}: {
  app: AppId;
  /** Makes the logo a link, e.g. `{ to: routes.reviews(), label: 'Slider' }`. */
  logoLink?: { to: To; label: string };
  end?: ReactNode;
}) {
  useEffect(() => showAppManifest(app), [app]);
  return (
    <header className="flex h-[88px] shrink-0 items-center justify-between px-6 md:px-8">
      {logoLink ? (
        <Link
          to={logoLink.to}
          aria-label={logoLink.label}
          className="transition-opacity hover:opacity-80"
        >
          <AppLogo app={app} />
        </Link>
      ) : (
        <AppLogo app={app} />
      )}
      {end}
    </header>
  );
}
