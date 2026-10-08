import { useId } from 'react';
import { useNavigate } from 'react-router';
import { AppHeader } from '@/app/AppHeader';
import { routes } from '@/app/routes';
import { Toast, useToast } from '@/ui';
import { useAccount } from '../../auth/useAccount';
import { CreateWorkspaceForm } from './CreateWorkspaceForm';
import { PendingInvites } from './PendingInvites';

/** First run without a workspace: join a pending invitation or create a workspace. */
export function Onboarding() {
  const { user, pendingInvites } = useAccount();
  const navigate = useNavigate();
  const [toast, showToast] = useToast();
  const invitesId = useId();
  const createId = useId();
  const firstName = user.name.split(/\s+/)[0] ?? user.name;

  return (
    <div className="dot-grid flex min-h-full flex-col">
      <title>Willkommen · Slider</title>
      <AppHeader />
      <main className="flex flex-1 justify-center px-4 pt-[clamp(8px,8vh,96px)] pb-16">
        <div className="flex w-full max-w-[456px] flex-col gap-6">
          <hgroup className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-fg">
              Willkommen, {firstName}
            </h1>
            <p className="text-sm text-fg-subtle">
              {pendingInvites.length > 0
                ? 'Du wurdest eingeladen. Tritt einem Workspace bei oder leg deinen eigenen an.'
                : 'Leg einen Workspace an – dort landen deine Präsentationen und dein Team.'}
            </p>
          </hgroup>

          {pendingInvites.length > 0 && (
            <section aria-labelledby={invitesId} className="flex flex-col gap-2">
              <h2 id={invitesId} className="px-1 text-xs text-fg-subtle">
                Einladungen
              </h2>
              <div className="glass rounded-panel p-1.5">
                <PendingInvites invites={pendingInvites} onError={showToast} />
              </div>
            </section>
          )}

          {pendingInvites.length > 0 && (
            <p className="flex items-center gap-3 text-xs text-fg-subtle">
              <span aria-hidden className="h-px flex-1 bg-hairline" />
              oder
              <span aria-hidden className="h-px flex-1 bg-hairline" />
            </p>
          )}

          <section
            aria-labelledby={createId}
            className="glass flex flex-col gap-4 rounded-panel p-6"
          >
            <div className="flex flex-col gap-1">
              <h2 id={createId} className="text-base font-semibold text-fg">
                Workspace erstellen
              </h2>
              <p className="text-[13px] text-fg-subtle">
                Du bist Owner und kannst danach Kolleginnen und Kollegen einladen.
              </p>
            </div>
            <CreateWorkspaceForm
              autoFocus={pendingInvites.length === 0}
              onCreated={(workspace) => void navigate(routes.workspace(workspace.id))}
            />
          </section>
        </div>
      </main>
      <Toast toast={toast} />
    </div>
  );
}
