import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useMe } from '@/lib/queries';
import { Avatar, Logo } from '@/ui';
import { routes } from './routes';

/** Top bar of the owner area (G1, A1, A3): logo left, page actions right, account avatar. */
export function AppHeader({ center, actions }: { center?: ReactNode; actions?: ReactNode }) {
  const { data: me } = useMe();

  return (
    <header className="relative z-10 flex h-[88px] shrink-0 items-center gap-6 px-6 md:px-14">
      <Link to={routes.reviews()} aria-label="Slider – Meine Reviews" className="shrink-0">
        <Logo />
      </Link>
      <div className="flex min-w-0 flex-1 justify-center">{center}</div>
      <div className="flex shrink-0 items-center gap-3">
        {actions}
        {me && <Avatar author={me.viewer.author} size={32} />}
      </div>
    </header>
  );
}
