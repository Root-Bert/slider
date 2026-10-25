import { CenteredMessage } from '@/shell/CenteredMessage';
import { routes } from '@/lib/routes';
import { ApiError } from '@/lib/api-client';
import { Button, LoadingState, TextLink } from '@/ui';

/** Full-page states of the deck route besides the viewer itself. */

export function DeckError({ error }: { error: Error }) {
  const status = error instanceof ApiError ? error.status : 0;
  const isFinal = status >= 400 && status < 500;
  const [title, message] =
    status === 404
      ? ['Review nicht gefunden', 'Diese Review gibt es nicht (mehr) oder der Link ist falsch.']
      : status === 401 || status === 403
        ? [
            'Kein Zugriff',
            'Du hast keinen Zugriff auf diese Review. Bitte eine Admin-Person des Workspace, dich einzuladen.',
          ]
        : ['Das hat nicht geklappt', error.message];

  return (
    <CenteredMessage title={title} message={message}>
      {!isFinal && (
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Erneut versuchen
        </Button>
      )}
      <TextLink to={routes.reviews()} variant="underline" size="sm">
        Zu meinen Reviews
      </TextLink>
    </CenteredMessage>
  );
}

export function DeckLoading() {
  return <LoadingState fullPage height="screen" />;
}
