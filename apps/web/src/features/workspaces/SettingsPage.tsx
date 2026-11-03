import { useEffect } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { routes } from '@/lib/routes';
import { SettingsLayout } from '@/shell/layouts/SettingsLayout';
import { GlassPanel, SegmentedControl, useToast, type IconName } from '@/ui';
import { useAccount } from '@/features/auth';
import { IntegrationsPanel, WORKSPACE_INTEGRATIONS_NAV } from '@/features/integrations';
import { MembersSection } from './components/MembersSection';
import { SsoSection } from './components/SsoSection';
import { UsageSection } from './components/PlanUsage';
import {
  DeleteSection,
  DomainSection,
  GeneralSection,
  LeaveSection,
} from './components/WorkspaceSections';
import { Part } from './components/SettingsPart';
import { WorkspaceMark } from './components/WorkspaceMark';
import { canDeleteWorkspace, canManageIntegrations } from './lib/roles';
import { useWorkspace } from './hooks/useWorkspace';

/** The page's sections, in order – each wrapped by `Part`, listed in the nav at the side. */
const SECTIONS = {
  usage: { id: 'nutzung', title: 'Plan & Nutzung', icon: 'cloud' },
  general: { id: 'allgemein', title: 'Allgemein', icon: 'settings' },
  domain: { id: 'domain', title: 'Beitritt per Domain', icon: 'link' },
  sso: { id: 'firmen-login', title: 'Firmen-Login', icon: 'key' },
  members: { id: 'mitglieder', title: 'Mitglieder', icon: 'manageAccounts' },
  leave: { id: 'verlassen', title: 'Verlassen', icon: 'logout' },
  delete: { id: 'loeschen', title: 'Löschen', icon: 'delete' },
} as const satisfies Record<string, { id: string; title: string; icon: IconName }>;
const NAV = Object.values(SECTIONS);
/**
 * The page's tabs: the workspace itself, and its integrations – AI models, speech to text,
 * photos (`/einstellungen/integrationen`, admins only).
 */
type SettingsTab = 'workspace' | 'integrationen';
const TABS = [
  { value: 'workspace', label: 'Workspace', icon: 'settings' },
  { value: 'integrationen', label: 'Integrationen', icon: 'link' },
] as const satisfies readonly { value: SettingsTab; label: string; icon: IconName }[];

/**
 * `/w/:workspaceId/einstellungen` – plan usage (BER-130), name, joining by domain (BER-148),
 * company login (BER-162), members, invitations, leave and delete (BER-129). `#einladen` scrolls to the members card with the invite row.
 * Admins get a second tab, „Integrationen“ (`/einstellungen/integrationen`, also the header's
 * „Integrationen“ button): the services the workspace works with, within what the instance allows.
 */
export function Component() {
  const workspace = useWorkspace();
  const { user, domainJoin } = useAccount();
  const [toast, showToast] = useToast();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const { tab: tabParam } = useParams();
  const integrations = canManageIntegrations(workspace.role);
  const tab: SettingsTab = tabParam === 'integrationen' ? 'integrationen' : 'workspace';

  // `#einladen` from the share dialog: React Router doesn't scroll to anchors by itself.
  useEffect(() => {
    if (!hash) return;
    try {
      document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
    } catch {
      // A malformed `#%…` from a hand-edited link: nothing to scroll to, not a crashed page.
    }
  }, [hash]);

  // An unknown tab, or the integrations for a member who isn't admin: the workspace tab.
  if (
    (tabParam !== undefined && tabParam !== 'integrationen') ||
    (tab === 'integrationen' && !integrations)
  )
    return <Navigate to={routes.workspaceSettings(workspace.id)} replace />;

  return (
    <SettingsLayout
      docTitle={`${tab === 'integrationen' ? 'Integrationen' : 'Einstellungen'} | ${workspace.name} | Slider`}
      title={workspace.name}
      leading={<WorkspaceMark name={workspace.name} logoUrl={workspace.logoUrl} size={40} />}
      back={{ to: routes.workspace(workspace.id) }}
      header="none"
      nav={tab === 'workspace' ? NAV : WORKSPACE_INTEGRATIONS_NAV}
      toast={toast}
    >
      {integrations && (
        <GlassPanel className="flex items-center self-start p-1">
          <SegmentedControl<SettingsTab>
            label="Workspace oder Integrationen"
            mode="tabs"
            value={tab}
            onChange={(next) =>
              void navigate(
                next === 'integrationen'
                  ? routes.workspaceIntegrations(workspace.id)
                  : routes.workspaceSettings(workspace.id),
              )
            }
            segments={TABS}
          />
        </GlassPanel>
      )}
      {tab === 'integrationen' ? (
        <IntegrationsPanel workspaceId={workspace.id} onNotify={showToast} />
      ) : (
        <>
          <Part section={SECTIONS.usage}>
            <UsageSection workspace={workspace} />
          </Part>
          <Part section={SECTIONS.general}>
            <GeneralSection key={workspace.id} workspace={workspace} onNotify={showToast} />
          </Part>
          <Part section={SECTIONS.domain}>
            <DomainSection
              workspace={workspace}
              email={user.email}
              enabled={domainJoin}
              onNotify={showToast}
            />
          </Part>
          <Part section={SECTIONS.sso}>
            <SsoSection workspace={workspace} enabled={domainJoin} onNotify={showToast} />
          </Part>
          <Part section={SECTIONS.members}>
            <MembersSection workspace={workspace} userId={user.id} onNotify={showToast} />
          </Part>
          <Part section={SECTIONS.leave}>
            <LeaveSection workspace={workspace} userId={user.id} />
          </Part>
          {canDeleteWorkspace(workspace.role) && (
            <Part section={SECTIONS.delete}>
              <DeleteSection workspace={workspace} />
            </Part>
          )}
        </>
      )}
    </SettingsLayout>
  );
}
