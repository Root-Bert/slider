import { Navigate } from 'react-router';
import { routes } from '@/lib/routes';
import { useStartWorkspace } from '@/features/workspaces';

/** `/writer` – where the installed Writer starts: the documents of the workspace last open. */
export function Component() {
  const workspace = useStartWorkspace();
  return <Navigate to={workspace ? routes.documents(workspace.id) : routes.home()} replace />;
}
