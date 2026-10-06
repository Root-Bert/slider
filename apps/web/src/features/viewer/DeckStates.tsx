import { Link } from 'react-router';
import { CenteredMessage } from '@/app/RouteError';
import { routes } from '@/app/routes';
import { ApiError } from '@/lib/api-client';
import { Button, Spinner } from '@/ui';

/** Full-page states of the deck route besides the viewer itself. */

export function DeckError({ error }: { error: Error }) {
  const status = error instanceof ApiError ? error.status : 0;
  const isFinal = status >= 400 && status < 500;
  const [title, message] =
    status === 404
      ? ['Review nicht gefunden', 'Dieses Review gibt es nicht (mehr) oder der Link ist falsch.']
      : status === 401 || status === 403
        ? [
            'Kein Zugriff',
            'Du hast keinen Zugriff auf dieses Review. Bitte den Besitzer um einen neuen Link.',
          ]
        : ['Das hat nicht geklappt', error.message];

  return (
    <CenteredMessage title={title} message={message}>
      {!isFinal && (
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Erneut versuchen
        </Button>
      )}
      <Link
        to={routes.reviews()}
        className="text-sm text-fg-muted underline underline-offset-4 hover:text-fg"
      >
        Zu meinen Reviews
      </Link>
    </CenteredMessage>
  );
}

export function DeckLoading() {
  return (
    <main className="dot-grid flex h-dvh items-center justify-center" aria-busy>
      <Spinner size={28} className="text-fg-subtle" />
    </main>
  );
}

export function SessionEnded() {
  return (
    <CenteredMessage
      title="Danke für dein Feedback"
      message="Deine Kommentare sind gespeichert. Du kannst dieses Fenster jetzt schließen."
    />
  );
}
