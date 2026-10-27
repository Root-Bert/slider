import { useEffect } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { CenteredMessage } from '@/shell/CenteredMessage';
import { Button } from '@/ui';
import { isModuleLoadError, reloadForNewBuild } from './chunk-reload';

export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? error.statusText
    : 'Ein unerwarteter Fehler ist aufgetreten.';

  useEffect(() => {
    // React Router logs only render errors; a page module that failed to load would leave no trace.
    if (!isRouteErrorResponse(error)) console.error('Route error:', error);
    // A page module the browser could not load: once more with a fresh page.
    if (isModuleLoadError(error)) reloadForNewBuild();
  }, [error]);

  return (
    <CenteredMessage title="Das hat nicht geklappt" message={message}>
      <Button onClick={() => window.location.reload()}>Neu laden</Button>
    </CenteredMessage>
  );
}
