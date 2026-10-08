import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { AppHeader } from '@/app/AppHeader';
import { routes } from '@/app/routes';
import { Button, cn, Icon, TextField, Toast, useToast } from '@/ui';
import { useAccount } from '../../auth/useAccount';
import { parseInviteToken } from '../lib/plan';
import { CreateWorkspaceForm } from './CreateWorkspaceForm';
import { PendingInvites } from './PendingInvites';

/**
 * After the first login, without an organisation (BER-130): found one or join one by
 * invitation – a pending e-mail invite, or a pasted link or code. There is no search: joining
 * always needs an invitation.
 */
export function Onboarding() {
  const { user, pendingInvites, canCreateWorkspace } = useAccount();
  const navigate = useNavigate();
  const [toast, showToast] = useToast();
  const createId = useId();
  const joinId = useId();
  const firstName = user.name.split(/\s+/)[0] ?? user.name;
  const invited = pendingInvites.length > 0;

  return (
    <div className="dot-grid flex min-h-full flex-col">
      <title>Willkommen · Slider</title>
      <AppHeader />
      <main className="flex flex-1 justify-center px-4 pt-[clamp(8px,6vh,72px)] pb-16">
        <div className="flex w-full max-w-[456px] flex-col gap-6">
          <hgroup className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-fg">
              Willkommen, {firstName}
            </h1>
            <p className="text-sm text-fg-subtle">
              In Slider liegt alles in Organisationen. Erstelle deine eigene oder tritt einer bei,
              in die du eingeladen wurdest.
            </p>
          </hgroup>

          {/* Invited people see "beitreten" first, everyone else "erstellen". */}
          <div className="flex flex-col gap-6">
            <section
              aria-labelledby={joinId}
              className={cn(
                'glass flex flex-col gap-4 rounded-panel p-6',
                invited ? 'order-1' : 'order-3',
              )}
            >
              <div className="flex flex-col gap-1">
                <h2 id={joinId} className="flex items-center gap-2 text-base font-semibold text-fg">
                  <Icon name="personAdd" size={20} className="text-fg-muted" />
                  Organisation beitreten
                </h2>
                <p className="text-[13px] text-fg-subtle">
                  {invited
                    ? 'Du wurdest eingeladen. Oder füge einen Einladungslink ein.'
                    : 'Füge den Einladungslink oder -code ein, den du bekommen hast.'}
                </p>
              </div>
              {invited && (
                <div className="-mx-2">
                  <PendingInvites invites={pendingInvites} onError={showToast} />
                </div>
              )}
              <JoinByCodeForm onJoin={(token) => void navigate(routes.join(token))} />
            </section>

            <p className="order-2 flex items-center gap-3 text-xs text-fg-subtle">
              <span aria-hidden className="h-px flex-1 bg-hairline" />
              oder
              <span aria-hidden className="h-px flex-1 bg-hairline" />
            </p>

            <section
              aria-labelledby={createId}
              className={cn(
                'glass flex flex-col gap-4 rounded-panel p-6',
                invited ? 'order-3' : 'order-1',
              )}
            >
              <div className="flex flex-col gap-1">
                <h2
                  id={createId}
                  className="flex items-center gap-2 text-base font-semibold text-fg"
                >
                  <Icon name="add" size={20} className="text-fg-muted" />
                  Organisation erstellen
                </h2>
                <p className="text-[13px] text-fg-subtle">
                  {canCreateWorkspace
                    ? 'Du bist Owner und kannst danach dein Team einladen. Neue Organisationen starten im Free-Plan.'
                    : 'Du hast bereits eine eigene Organisation. Jedes Konto kann eine Organisation gründen – weiteren trittst du per Einladung bei.'}
                </p>
              </div>
              {canCreateWorkspace && (
                <CreateWorkspaceForm
                  autoFocus={!invited}
                  onCreated={(workspace) => void navigate(routes.workspace(workspace.id))}
                />
              )}
            </section>
          </div>
        </div>
      </main>
      <Toast toast={toast} />
    </div>
  );
}

/** Paste an invite link or code → the `/join/:token` page with its preview and "Beitreten". */
function JoinByCodeForm({ onJoin }: { onJoin: (token: string) => void }) {
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const token = parseInviteToken(value);
  const error =
    touched && value.trim() !== '' && !token
      ? 'Das ist kein Einladungslink. Er sieht so aus: …/join/abc123…'
      : null;

  return (
    <form
      noValidate
      className="flex flex-col gap-2 sm:flex-row sm:items-start"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (token) onJoin(token);
      }}
    >
      <TextField
        aria-label="Einladungslink oder Code"
        icon="link"
        size="lg"
        placeholder="Einladungslink oder Code"
        autoComplete="off"
        value={value}
        error={error}
        onChange={(event) => setValue(event.target.value)}
        className="min-w-0 flex-1"
      />
      <Button type="submit" size="lg" variant="secondary" disabled={value.trim() === ''}>
        Beitreten
      </Button>
    </form>
  );
}
