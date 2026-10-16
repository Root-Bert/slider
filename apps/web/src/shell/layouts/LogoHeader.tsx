import type { ReactNode } from 'react';
import { Link, type To } from 'react-router';
import { Logo } from '@/ui';

/**
 * The 88px header of pages outside the app shell (login, join, setup): the logo, optionally a
 * link home, and something at the right end (the account menu).
 */
export function LogoHeader({
  logoLink,
  end,
}: {
  /** Makes the logo a link, e.g. `{ to: routes.reviews(), label: 'Slider' }`. */
  logoLink?: { to: To; label: string };
  end?: ReactNode;
}) {
  return (
    <header className="flex h-[88px] shrink-0 items-center justify-between px-6 md:px-14">
      {logoLink ? (
        <Link
          to={logoLink.to}
          aria-label={logoLink.label}
          className="transition-opacity hover:opacity-80"
        >
          <Logo />
        </Link>
      ) : (
        <Logo />
      )}
      {end}
    </header>
  );
}
