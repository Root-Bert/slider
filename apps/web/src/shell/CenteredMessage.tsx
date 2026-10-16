import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { routes } from '@/lib/routes';
import { EmptyState, Logo } from '@/ui';

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
    <main className="dot-grid flex min-h-full flex-col items-center justify-center p-6">
      <EmptyState
        size="lg"
        illustration={
          <Link
            to={routes.reviews()}
            aria-label="Zur Übersicht"
            className="transition-opacity hover:opacity-80"
          >
            <Logo />
          </Link>
        }
        title={title}
        message={message}
        action={children}
      />
    </main>
  );
}
