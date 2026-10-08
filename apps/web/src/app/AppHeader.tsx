import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { AccountMenu } from '@/features/workspaces/components/AccountMenu';
import { WorkspaceSwitcher } from '@/features/workspaces/components/WorkspaceSwitcher';
import { Logo } from '@/ui';
import { routes } from './routes';

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
  return (
    <header className="relative z-10 grid h-[88px] shrink-0 grid-cols-[minmax(max-content,1fr)_minmax(0,312px)_minmax(max-content,1fr)] items-center gap-6 px-6 md:px-14">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <Link
          to={routes.reviews()}
          aria-label="Slider – Meine Reviews"
          className="shrink-0 transition-opacity hover:opacity-80"
        >
          <Logo className="max-sm:[&>span]:hidden" />
        </Link>
        <span aria-hidden className="h-5 w-px shrink-0 bg-hairline-strong max-sm:hidden" />
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
