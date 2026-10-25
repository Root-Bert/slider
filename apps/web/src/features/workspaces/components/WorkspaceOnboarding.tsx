import { useState, type ReactNode } from 'react';
import type { DomainWorkspace, PendingInvite } from '@slider/shared';
import { useNavigate } from 'react-router';
import { routes } from '@/lib/routes';
import { AppHeader } from '@/shell/AppHeader';
import {
  Badge,
  Button,
  cn,
  Divider,
  Icon,
  IconTile,
  PageHeader,
  Section,
  Toast,
  useToast,
  type ShowToast,
} from '@/ui';
import { useAccount } from '@/features/auth';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';
import { CreateWorkspaceForm } from './CreateWorkspaceForm';
import { useAcceptPendingInvite, useJoinDomainWorkspace } from '../hooks/useJoinActions';
import { inviteDetails, memberCountLabel } from '../lib/join-labels';
import { ROLE_LABELS } from '../lib/roles';
import { FeaturedJoinCard } from './FeaturedJoinCard';
import { JoinByCodeForm } from './JoinByCodeForm';
import { JoinCard } from './JoinCard';
import { SpaceBackdrop } from './SpaceBackdrop';
import { WorkspaceMark } from './WorkspaceMark';

/**
 * Without a workspace (BER-130): join the company workspace of one's domain (BER-148), or
 * found one, or join one by invitation – a pending e-mail invite, or a pasted link or code.
 * Signing up without either founds one right away, so this is mostly seen by people whose
 * company is already in Slider, or who were invited: then those workspaces are the page –
 * wide cards, no frame – and founding one's own is a quiet link above them.
 */
export function WorkspaceOnboarding() {
  const { user, pendingInvites, domainWorkspace, canCreateWorkspace } = useAccount();
  const navigate = useNavigate();
  const [toast, showToast] = useToast();
  const [creating, setCreating] = useState(false);
  const firstName = user.name.split(/\s+/)[0] ?? user.name;
  const invited = pendingInvites.length > 0;
  const available = invited || domainWorkspace !== null;

  const byCode = (
    <Section
      density="compact"
      icon="link"
      title="Mit Einladungslink beitreten"
      description="Füge den Einladungslink oder -code ein, den du bekommen hast."
    >
      <JoinByCodeForm onJoin={(token) => void navigate(routes.join(token))} />
    </Section>
  );

  if (available) {
    return (
      <Page>
        <PageHeader
          align="center"
          title={`Willkommen an Bord, ${firstName}`}
          subtitle={
            domainWorkspace
              ? `${domainWorkspace.name} ist schon unterwegs. Steig ein und bring eure Visionen gemeinsam auf die Folie.`
              : 'Deine Crew wartet schon. Steig ein und bring eure Visionen gemeinsam auf die Folie.'
          }
        />
        {canCreateWorkspace && (
          <div className="-mt-2 flex justify-center">
            <Button variant="ghost" size="sm" icon="add" onClick={() => setCreating(true)}>
              Eigenen Workspace erstellen
            </Button>
          </div>
        )}
        <ul aria-label="Workspaces zum Beitreten" className="flex flex-col gap-3">
          {domainWorkspace && <CompanyCard workspace={domainWorkspace} onError={showToast} />}
          {pendingInvites.map((invite) => (
            <InviteCard key={invite.id} invite={invite} onError={showToast} />
          ))}
        </ul>
        <Divider label="oder" />
        {byCode}
        <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
        <Toast toast={toast} />
      </Page>
    );
  }

  return (
    <Page narrow>
      <PageHeader
        align="center"
        title={`Willkommen an Bord, ${firstName}`}
        subtitle="Starte deinen eigenen Workspace und bring deine Visionen mit deinem Team auf die Folie. Eingeladen? Dann steig unten mit dem Link ein."
      />
      <Section
        density="compact"
        icon="add"
        title="Workspace erstellen"
        description={
          canCreateWorkspace
            ? 'Du bist Admin und kannst danach dein Team einladen. Neue Workspaces starten im Free-Plan.'
            : 'Du hast bereits einen eigenen Workspace. Übergib ihn an jemand anderen, um einen neuen zu gründen – weiteren trittst du per Einladung bei.'
        }
      >
        {canCreateWorkspace && (
          <CreateWorkspaceForm
            autoFocus
            onCreated={(workspace) => void navigate(routes.workspace(workspace.id))}
          />
        )}
      </Section>
      <Divider label="oder" />
      {byCode}
      <Toast toast={toast} />
    </Page>
  );
}

/** The company workspace of the viewer's domain: "Einsteigen" without an invitation. */
function CompanyCard({ workspace, onError }: { workspace: DomainWorkspace; onError: ShowToast }) {
  const { pending, join } = useJoinDomainWorkspace(workspace, { onError });
  return (
    <FeaturedJoinCard
      leading={<WorkspaceMark name={workspace.name} logoUrl={workspace.logoUrl} size={64} />}
      title={workspace.name}
      subtitle={`@${workspace.domain} | ${memberCountLabel(workspace.memberCount)} an Bord`}
      action={
        <Button size="lg" glow className="min-w-48" loading={pending} onClick={join}>
          Einsteigen
        </Button>
      }
    />
  );
}

/** An e-mail invitation to join. */
function InviteCard({ invite, onError }: { invite: PendingInvite; onError: ShowToast }) {
  const { pending, join } = useAcceptPendingInvite(invite, { onError });
  return (
    <JoinCard
      leading={
        <IconTile size={40}>
          <Icon name="personAdd" size={20} />
        </IconTile>
      }
      title={invite.workspaceName}
      badge={<Badge>{ROLE_LABELS[invite.role]}</Badge>}
      subtitle={inviteDetails(invite)}
      action={
        <Button size="md" loading={pending} onClick={join}>
          Beitreten
        </Button>
      }
    />
  );
}

/**
 * The welcome page's frame: the dot grid under a starry sky with an orbit in the corner – the
 * website's space theme, as people come on board. `narrow` when founding is all there is.
 */
function Page({ narrow = false, children }: { narrow?: boolean; children: ReactNode }) {
  return (
    <div className="dot-grid relative flex min-h-full flex-col">
      <title>Willkommen | Slider</title>
      <SpaceBackdrop />
      <AppHeader />
      <main className="relative flex flex-1 justify-center px-4 pt-[clamp(8px,6vh,72px)] pb-16">
        <div
          className={cn('flex w-full flex-col gap-6', narrow ? 'max-w-[456px]' : 'max-w-[600px]')}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
