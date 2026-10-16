import { useState, type MouseEvent, type ReactNode } from 'react';
import { Link, matchPath, useLocation } from 'react-router';
import { routes } from '@/lib/routes';
import { AccountMenu, WorkspaceSwitcher } from '@/features/workspaces';
import { cn, Logo, ToolbarDivider } from '@/ui';

interface AppHeaderProps {
  /** Next to the workspace switcher, e.g. the page's primary action. */
  leading?: ReactNode;
  /** Centred on the page, independent of how wide the two sides are. */
  center?: ReactNode;
  actions?: ReactNode;
}

/**
 * Top bar of the member area (G1, A1, A3): logo and workspace switcher left, page actions
 * right, account menu behind the avatar.
 */
export function AppHeader({ leading, center, actions }: AppHeaderProps) {
  const location = useLocation();
  const [hopping, setHopping] = useState(false);

  // Already home – `/` itself or the workspace overview it redirects to: don't reload the
  // page (it flickers), let the logo hop instead.
  const atHome =
    location.pathname === routes.reviews() ||
    !!matchPath(routes.workspace(':workspaceId'), location.pathname);
  function onLogoClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!atHome || location.search) return;
    event.preventDefault();
    setHopping(true);
  }

  return (
    <header className="relative z-(--z-raised) grid h-[88px] shrink-0 grid-cols-[minmax(max-content,1fr)_minmax(0,312px)_minmax(max-content,1fr)] items-center gap-6 px-6 md:px-14">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <Link
          to={routes.reviews()}
          aria-label="Slider – Reviews"
          onClick={onLogoClick}
          className="shrink-0 transition-opacity hover:opacity-80"
        >
          <Logo
            className={cn('max-sm:[&>span]:hidden', hopping && 'motion-safe:animate-hop')}
            onAnimationEnd={() => setHopping(false)}
          />
        </Link>
        <ToolbarDivider spacing="none" className="max-sm:hidden" />
        <WorkspaceSwitcher />
        {leading && <span className="ml-1 flex shrink-0 items-center">{leading}</span>}
      </div>
      <div className="flex min-w-0 justify-center">{center}</div>
      <div className="flex items-center justify-end gap-3">
        {actions}
        <AccountMenu />
      </div>
    </header>
  );
}
