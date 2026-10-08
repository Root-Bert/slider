import { useState } from 'react';
import { useNavigate } from 'react-router';
import { workspaceNameSchema, type Workspace } from '@slider/shared';
import { routes } from '@/app/routes';
import { useDeleteWorkspace, useRemoveMember, useRenameWorkspace } from '@/lib/workspace-queries';
import { Badge, Button, Dialog, TextField, type ShowToast } from '@/ui';
import { canRenameWorkspace, ROLE_HINTS, ROLE_LABELS } from '../lib/roles';
import { SettingsSection } from './SettingsSection';

export function GeneralSection({
  workspace,
  onNotify,
}: {
  workspace: Workspace;
  onNotify: ShowToast;
}) {
  const [name, setName] = useState(workspace.name);
  const rename = useRenameWorkspace(workspace.id);
  const editable = canRenameWorkspace(workspace.role);
  const parsed = workspaceNameSchema.safeParse(name);
  const changed = parsed.success && parsed.data !== workspace.name;

  return (
    <SettingsSection
      title="Allgemein"
      description={
        editable
          ? 'Den Namen sehen alle Mitglieder.'
          : 'Nur Admins und Owner können den Namen ändern.'
      }
    >
      <form
        noValidate
        className="flex flex-col gap-2 sm:flex-row sm:items-start"
        onSubmit={(event) => {
          event.preventDefault();
          if (!changed) return;
          rename.mutate(parsed.data, {
            onSuccess: () => onNotify('Name gespeichert'),
            onError: (error) => onNotify(error.message, 'danger'),
          });
        }}
      >
        <TextField
          label="Name"
          value={name}
          maxLength={80}
          readOnly={!editable}
          error={parsed.success ? null : 'Der Name darf nicht leer sein.'}
          onChange={(event) => setName(event.target.value)}
          className="min-w-0 flex-1"
        />
        {editable && (
          <Button
            type="submit"
            className="h-10 sm:mt-[22px]"
            disabled={!changed}
            loading={rename.isPending}
          >
            Speichern
          </Button>
        )}
      </form>
      <p className="flex items-center gap-2 text-xs text-fg-subtle">
        <Badge>{ROLE_LABELS[workspace.role]}</Badge>
        {ROLE_HINTS[workspace.role]}
      </p>
    </SettingsSection>
  );
}

export function LeaveSection({
  workspace,
  userId,
  onNotify,
}: {
  workspace: Workspace;
  userId: string;
  onNotify: ShowToast;
}) {
  const [confirming, setConfirming] = useState(false);
  const leave = useRemoveMember(workspace.id);
  const navigate = useNavigate();

  return (
    <SettingsSection
      title="Organisation verlassen"
      description="Du verlierst den Zugriff auf die Präsentationen dieser Organisation. Deine Präsentationen und Kommentare bleiben hier. Als einziger Owner ernenne zuerst jemand anderen."
      aside={
        <Button variant="secondary" icon="logout" onClick={() => setConfirming(true)}>
          Verlassen
        </Button>
      }
    >
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`„${workspace.name}“ verlassen?`}
        description="Zurück kommst du nur mit einer neuen Einladung."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Abbrechen
            </Button>
            <Button
              variant="danger"
              loading={leave.isPending}
              onClick={() =>
                leave.mutate(userId, {
                  onSuccess: () => void navigate(routes.reviews(), { replace: true }),
                  onError: (error) => {
                    setConfirming(false);
                    onNotify(error.message, 'danger');
                  },
                })
              }
            >
              Verlassen
            </Button>
          </>
        }
      />
    </SettingsSection>
  );
}

export function DeleteSection({
  workspace,
  onNotify,
}: {
  workspace: Workspace;
  onNotify: ShowToast;
}) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const remove = useDeleteWorkspace(workspace.id);
  const navigate = useNavigate();
  const close = () => {
    setConfirming(false);
    setTyped('');
  };

  return (
    <SettingsSection
      tone="danger"
      title="Organisation löschen"
      description="Löscht die Organisation mit allen Präsentationen, Kommentaren, Aufnahmen und Einladungen. Das lässt sich nicht rückgängig machen."
      aside={
        <Button variant="danger" icon="delete" onClick={() => setConfirming(true)}>
          Löschen
        </Button>
      }
    >
      <Dialog
        open={confirming}
        onClose={close}
        title={`„${workspace.name}“ endgültig löschen?`}
        description={
          <>
            Alle Präsentationen, Kommentare und Mitgliedschaften gehen verloren. Tippe zur
            Bestätigung den Namen der Organisation ein.
          </>
        }
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Abbrechen
            </Button>
            <Button
              variant="danger"
              icon="delete"
              disabled={typed.trim() !== workspace.name}
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(undefined, {
                  onSuccess: () => void navigate(routes.reviews(), { replace: true }),
                  onError: (error) => {
                    close();
                    onNotify(error.message, 'danger');
                  },
                })
              }
            >
              Endgültig löschen
            </Button>
          </>
        }
      >
        {confirming && (
          <TextField
            aria-label="Name der Organisation"
            placeholder={workspace.name}
            value={typed}
            autoFocus
            onChange={(event) => setTyped(event.target.value)}
          />
        )}
      </Dialog>
    </SettingsSection>
  );
}
