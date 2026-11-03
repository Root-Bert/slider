import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, matchPath, useLocation } from 'react-router';
import { routes } from '@/lib/routes';
import {
  AccountMenu,
  OnlineMembers,
  IntegrationsButton,
  WorkspaceSwitcher,
} from '@/features/workspaces';
import { Logo, LOGO_ANIMATIONS, ToolbarDivider, type LogoAnimation } from '@/ui';

interface AppHeaderProps {
  /** Next to the workspace switcher, e.g. the page's primary action. */
  leading?: ReactNode;
  /** Centred on the page, independent of how wide the two sides are. */
  center?: ReactNode;
  actions?: ReactNode;
  /** Where the logo leads; the reviews by default. */
  logoLink?: { to: string; label: string };
}

/**
 * Top bar of the member area (G1, A1, A3): logo, workspace switcher and its AI left, page actions
 * right, who else of the workspace is online next to the avatar, account menu behind it.
 */
export function AppHeader({
  leading,
  center,
  actions,
  logoLink = { to: routes.reviews(), label: 'Slider – Präsentationen' },
}: AppHeaderProps) {
  const location = useLocation();
  // `run` remounts the logo, so a click mid-animation starts the next one from scratch.
  const [logoAnimation, setLogoAnimation] = useState<{ name?: LogoAnimation; run: number }>({
    run: 0,
  });
  const lastLogoAnimation = useRef<LogoAnimation>(undefined);

  // Already where the logo leads – home: `/` itself, the workspace overview it redirects to, or its other
  // view, the Bibliothek (whatever its `?filter=`): don't reload the page (it flickers), let the logo do a
  // little trick instead – a different one each time.
  const toReviews = logoLink.to === routes.reviews();
  const atLibrary =
    toReviews && !!matchPath(routes.workspaceMaterial(':workspaceId'), location.pathname);
  const atHome =
    atLibrary ||
    ((location.pathname === logoLink.to ||
      (toReviews && !!matchPath(routes.workspace(':workspaceId'), location.pathname))) &&
      !location.search);
  function onLogoClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!atHome) return;
    event.preventDefault();
    const others = LOGO_ANIMATIONS.filter((name) => name !== lastLogoAnimation.current);
    const name = others[Math.floor(Math.random() * others.length)];
    lastLogoAnimation.current = name;
    setLogoAnimation(({ run }) => ({ name, run: run + 1 }));
  }

  return (
    <header
      data-app-header
      className="relative z-(--z-raised) grid h-[88px] shrink-0 grid-cols-[minmax(max-content,1fr)_minmax(0,312px)_minmax(max-content,1fr)] items-center gap-6 px-6 md:px-14"
    >
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <Link
          to={logoLink.to}
          aria-label={logoLink.label}
          onClick={onLogoClick}
          className="shrink-0 transition-opacity hover:opacity-80"
        >
          <Logo
            key={logoAnimation.run}
            tone="mono"
            className="max-sm:[&>span]:hidden"
            animation={logoAnimation.name}
            onAnimationEnd={() => setLogoAnimation(({ run }) => ({ run }))}
          />
        </Link>
        <ToolbarDivider spacing="none" className="max-sm:hidden" />
        <WorkspaceSwitcher />
        <IntegrationsButton />
        {leading && <span className="ml-1 flex shrink-0 items-center">{leading}</span>}
      </div>
      <div className="flex min-w-0 justify-center">{center}</div>
      <div className="flex items-center justify-end gap-3">
        {actions}
        <OnlineMembers />
        <AccountMenu />
      </div>
    </header>
  );
}
