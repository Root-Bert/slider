import { Navigate } from 'react-router';
import { routes } from '@/lib/routes';
import { useStartWorkspace } from '@/features/workspaces';

/** `/sender` – where the installed Sender starts: the messages of the workspace last open. */
export function Component() {
  const workspace = useStartWorkspace();
  return <Navigate to={workspace ? routes.messages(workspace.id) : routes.home()} replace />;
}
