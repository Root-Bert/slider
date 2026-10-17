import { useNavigate } from 'react-router';
import { routes } from '@/lib/routes';
import { AppHeader } from '@/shell/AppHeader';
import { Divider, PageHeader, Section, Toast, useToast } from '@/ui';
import { useAccount } from '@/features/auth';
import { CreateWorkspaceForm } from './CreateWorkspaceForm';
import { JoinByCodeForm } from './JoinByCodeForm';
import { PendingInvites } from './PendingInvites';

/**
 * After the first login, without an organisation (BER-130): found one or join one by
 * invitation – a pending e-mail invite, or a pasted link or code. There is no search: joining
 * always needs an invitation.
 */
export function WorkspaceOnboarding() {
  const { user, pendingInvites, canCreateWorkspace } = useAccount();
  const navigate = useNavigate();
  const [toast, showToast] = useToast();
  const firstName = user.name.split(/\s+/)[0] ?? user.name;
  const invited = pendingInvites.length > 0;

  const join = (
    <Section
      key="join"
      density="compact"
      icon="personAdd"
      title="Organisation beitreten"
      description={
        invited
          ? 'Du wurdest eingeladen. Oder füge einen Einladungslink ein.'
          : 'Füge den Einladungslink oder -code ein, den du bekommen hast.'
      }
    >
      {invited && (
        <div className="-mx-2">
          <PendingInvites invites={pendingInvites} onError={showToast} />
        </div>
      )}
      <JoinByCodeForm onJoin={(token) => void navigate(routes.join(token))} />
    </Section>
  );

  const create = (
    <Section
      key="create"
      density="compact"
      icon="add"
      title="Organisation erstellen"
      description={
        canCreateWorkspace
          ? 'Du bist Admin und kannst danach dein Team einladen. Neue Organisationen starten im Free-Plan.'
          : 'Du hast bereits eine eigene Organisation. Übergib sie an jemand anderen, um eine neue zu gründen – weiteren trittst du per Einladung bei.'
      }
    >
      {canCreateWorkspace && (
        <CreateWorkspaceForm
          autoFocus={!invited}
          onCreated={(workspace) => void navigate(routes.workspace(workspace.id))}
        />
      )}
    </Section>
  );

  return (
    <div className="dot-grid flex min-h-full flex-col">
      <title>Willkommen · Slider</title>
      <AppHeader />
      <main className="flex flex-1 justify-center px-4 pt-[clamp(8px,6vh,72px)] pb-16">
        <div className="flex w-full max-w-[456px] flex-col gap-6">
          <PageHeader
            align="center"
            title={`Willkommen, ${firstName}`}
            subtitle="In Slider liegt alles in Organisationen. Erstelle deine eigene oder tritt einer bei, in die du eingeladen wurdest."
          />

          {/* Invited people see "beitreten" first, everyone else "erstellen" – in the DOM, not
              just visually, so focus and screen readers follow the same order. */}
          <div className="flex flex-col gap-6">
            {invited ? join : create}
            <Divider label="oder" />
            {invited ? create : join}
          </div>
        </div>
      </main>
      <Toast toast={toast} />
    </div>
  );
}
