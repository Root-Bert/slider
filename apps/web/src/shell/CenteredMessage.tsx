import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { routes } from '@/lib/routes';
import { Logo } from '@/ui';

/** Full-page message on the dot grid: logo (back to the overview), title, text, actions. */
export function CenteredMessage({
  title,
  message,
  children,
}: {
  title: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <main className="dot-grid flex min-h-full flex-col items-center justify-center gap-6 p-6 text-center">
      <Link
        to={routes.reviews()}
        aria-label="Zur Übersicht"
        className="transition-opacity hover:opacity-80"
      >
        <Logo />
      </Link>
      <div className="flex max-w-sm flex-col gap-2">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-fg-subtle">{message}</p>
      </div>
      {children}
    </main>
  );
}
