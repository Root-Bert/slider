import { Navigate, Outlet, useLocation } from 'react-router';
import { routes } from '@/lib/routes';
import { CenteredMessage } from '@/shell/CenteredMessage';
import { useMe } from '@/lib/api';
import { Button, Spinner } from '@/ui';
import { accountGate } from './lib/gate';

/** Layout route of the member area: renders its pages only for signed-in accounts. */
export function Component() {
  const me = useMe();
  const location = useLocation();
  const state = accountGate(me);

  if (state === 'login') {
    return (
      <Navigate to={routes.login(location.pathname + location.search + location.hash)} replace />
    );
  }
  if (state === 'error') {
    return (
      <CenteredMessage title="Das hat nicht geklappt" message={me.error?.message ?? ''}>
        <Button variant="secondary" onClick={() => void me.refetch()}>
          Erneut versuchen
        </Button>
      </CenteredMessage>
    );
  }
  if (state === 'loading') return <FullPageSpinner />;
  return <Outlet />;
}

export function FullPageSpinner() {
  return (
    <main className="dot-grid flex min-h-full items-center justify-center" aria-busy>
      <Spinner size={28} className="text-fg-subtle" />
    </main>
  );
}
