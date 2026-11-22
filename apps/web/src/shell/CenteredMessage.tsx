import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CloudLogo, SenderLogo, ReaderLogo, WriterLogo } from '@/features/cloud';
import { appStart, useCurrentApp } from '@/lib/apps';
import { EmptyState, Logo } from '@/ui';

/**
 * Full-page message on the dot grid: the logo of the app one is in (back to its start), title,
 * text, actions.
 */
export function CenteredMessage({
  title,
  message,
  children,
}: {
  title: string;
  message: string;
  children?: ReactNode;
}) {
  const app = useCurrentApp();
  const home = {
    ...appStart(app),
    logo:
      app === 'cloud' ? (
        <CloudLogo />
      ) : app === 'reader' ? (
        <ReaderLogo />
      ) : app === 'writer' ? (
        <WriterLogo />
      ) : app === 'sender' ? (
        <SenderLogo />
      ) : (
        <Logo tone="brand" />
      ),
  };
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
            {home.logo}
          </Link>
        }
        title={title}
        message={message}
        action={children}
      />
    </main>
  );
}
