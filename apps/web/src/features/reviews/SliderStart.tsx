import { Navigate } from 'react-router';
import { routes } from '@/lib/routes';
import { useStartWorkspace } from '@/features/workspaces';

/** `/slider` – the presentations of the workspace last open; where the installed Slider starts. */
export function Component() {
  const workspace = useStartWorkspace();
  return <Navigate to={workspace ? routes.workspace(workspace.id) : routes.home()} replace />;
}
