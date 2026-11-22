import { Navigate } from 'react-router';
import { routes } from '@/lib/routes';
import { useStartWorkspace } from '@/features/workspaces';

/** `/reader` – where the installed Reader starts: the PDFs of the workspace last open. */
export function Component() {
  const workspace = useStartWorkspace();
  return <Navigate to={workspace ? routes.pdfs(workspace.id) : routes.home()} replace />;
}
