import { isRouteErrorResponse, useRouteError } from 'react-router';
import { CenteredMessage } from '@/shell/CenteredMessage';
import { Button } from '@/ui';

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
