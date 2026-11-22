import { Navigate } from 'react-router';
import { routes } from '@/lib/routes';
import { useStartWorkspace } from '@/features/workspaces';

/** `/cloud` – where the installed Cloud starts: the files of the workspace last open. */
export function Component() {
  const workspace = useStartWorkspace();
  return <Navigate to={workspace ? routes.cloud(workspace.id) : routes.home()} replace />;
}
