import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useMe } from '@/lib/queries';
import { Avatar, Logo } from '@/ui';
import { routes } from './routes';

interface AppHeaderProps {
  /** Next to the logo, e.g. the page's primary action. */
  leading?: ReactNode;
  /** Centred on the page, independent of how wide the two sides are. */
  center?: ReactNode;
  actions?: ReactNode;
}

/** Top bar of the owner area (G1, A1, A3): logo left, page actions right, account avatar. */
export function AppHeader({ leading, center, actions }: AppHeaderProps) {
  const { data: me } = useMe();

  return (
    <header className="relative z-10 grid h-[88px] shrink-0 grid-cols-[minmax(max-content,1fr)_minmax(0,312px)_minmax(max-content,1fr)] items-center gap-6 px-6 md:px-14">
      <div className="flex min-w-0 items-center gap-4">
        <Link to={routes.reviews()} aria-label="Slider – Meine Reviews" className="shrink-0">
          <Logo />
        </Link>
        {leading}
      </div>
      <div className="flex min-w-0 justify-center">{center}</div>
      <div className="flex items-center justify-end gap-3">
        {actions}
        {me && <Avatar author={me.viewer.author} size={32} />}
      </div>
    </header>
  );
}
