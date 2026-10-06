import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Button, Logo } from '@/ui';
import { routes } from './routes';

export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? error.statusText
    : 'Ein unerwarteter Fehler ist aufgetreten.';

  return (
    <CenteredMessage title="Das hat nicht geklappt" message={message}>
      <Button onClick={() => window.location.reload()}>Neu laden</Button>
    </CenteredMessage>
  );
}

export function CenteredMessage({
  title,
  message,
  children,
}: {
  title: string;
  message: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="dot-grid flex min-h-full flex-col items-center justify-center gap-6 p-6 text-center">
      <Link to={routes.reviews()} aria-label="Zur Übersicht">
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
