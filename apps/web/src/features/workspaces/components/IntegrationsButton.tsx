import { Link, matchPath, useLocation } from 'react-router';
import { routes } from '@/lib/routes';
import { Icon } from '@/ui';
import { canManageIntegrations } from '../lib/roles';
import { useActiveWorkspace } from '../hooks/useWorkspace';

/**
 * Header, beside the workspace switcher: straight to „Integrationen“ of the workspace's settings
 * – AI models, speech to text, photos. Only for its admins: the tab holds nothing for others.
 */
export function IntegrationsButton() {
  const workspace = useActiveWorkspace();
  const { pathname } = useLocation();
  if (!workspace || !canManageIntegrations(workspace.role)) return null;
  const to = routes.workspaceIntegrations(workspace.id);

  return (
    <Link
      to={to}
      aria-current={matchPath(to, pathname) ? 'page' : undefined}
      aria-label={`Integrationen von ${workspace.name}`}
      className="flex h-9 shrink-0 items-center gap-1.5 rounded-control px-2 text-sm font-medium text-fg transition-colors hover:bg-hover aria-[current=page]:bg-hover"
    >
      <Icon name="link" size={18} />
      <span className="max-sm:hidden">Integrationen</span>
    </Link>
  );
}
