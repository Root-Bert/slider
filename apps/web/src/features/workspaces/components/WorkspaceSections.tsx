import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  WORKSPACE_LOGO_MAX_BYTES,
  WORKSPACE_LOGO_TYPES,
  workspaceNameSchema,
  type Workspace,
} from '@slider/shared';
import { routes } from '@/lib/routes';
import {
  useDeleteWorkspace,
  useMembers,
  useRemoveMember,
  useRenameWorkspace,
  useWorkspaceLogo,
} from '@/lib/api';
import { Badge, Button, ConfirmDialog, Section, Select, TextField, type ShowToast } from '@/ui';
import { canRenameWorkspace, isLastAdmin, ROLE_HINTS, ROLE_LABELS } from '../lib/roles';
import { WorkspaceMark } from './WorkspaceMark';

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
    <Section
      title="Allgemein"
      description={
        editable
          ? 'Name und Logo sehen alle Mitglieder.'
          : 'Nur Admins können Name und Logo ändern.'
      }
    >
      <LogoRow workspace={workspace} editable={editable} onNotify={onNotify} />
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
            size="field"
            className="sm:mt-[22px]"
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
    </Section>
  );
}

/** Logo: PNG, JPEG or WebP up to 1 MB, shown square in the header and the switcher. */
function LogoRow({
  workspace,
  editable,
  onNotify,
}: {
  workspace: Workspace;
  editable: boolean;
  onNotify: ShowToast;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const logo = useWorkspaceLogo(workspace.id);
  const save = (file: File | null) =>
    logo.mutate(file, {
      onSuccess: () => onNotify(file ? 'Logo gespeichert' : 'Logo entfernt'),
      onError: (error) => onNotify(error.message, 'danger'),
    });

  return (
    <div className="flex items-center gap-4">
      <WorkspaceMark name={workspace.name} logoUrl={workspace.logoUrl} size={64} />
      {editable ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon="upload"
              loading={logo.isPending && logo.variables !== null}
              onClick={() => inputRef.current?.click()}
            >
              {workspace.logoUrl ? 'Logo ersetzen' : 'Logo hochladen'}
            </Button>
            {workspace.logoUrl && (
              <Button
                variant="ghost"
                loading={logo.isPending && logo.variables === null}
                onClick={() => save(null)}
              >
                Entfernen
              </Button>
            )}
          </div>
          <p className="text-xs text-fg-subtle">PNG, JPEG oder WebP, quadratisch, bis 1 MB.</p>
          <input
            ref={inputRef}
            type="file"
            accept={WORKSPACE_LOGO_TYPES.join(',')}
            className="hidden"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Same file twice in a row must fire `change` again.
              event.target.value = '';
              if (!file) return;
              if (file.size > WORKSPACE_LOGO_MAX_BYTES)
                return onNotify('Das Logo ist zu groß (maximal 1 MB).', 'danger');
              save(file);
            }}
          />
        </div>
      ) : (
        <p className="text-body text-fg-subtle">
          {workspace.logoUrl ? 'Logo der Organisation' : 'Noch kein Logo'}
        </p>
      )}
    </div>
  );
}

/**
 * Leaving. The last admin hands the organisation to another member first – picked right in the
 * dialog, they become admin in the same step. Alone in it, only deleting is left.
 */
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
  const members = useMembers(workspace.id);
  const navigate = useNavigate();
  const list = members.data ?? [];
  // Viewers only look – they cannot take the organisation over (the API refuses too).
  const others = list.filter((member) => member.userId !== userId && member.role !== 'viewer');
  const mustHandOver = isLastAdmin(
    workspace.role,
    list.filter((member) => member.role === 'admin').length,
  );
  const [picked, setPicked] = useState<string | null>(null);
  const successor = others.find((member) => member.userId === picked) ?? others[0];
  const alone = mustHandOver && members.isSuccess && others.length === 0;

  return (
    <Section
      title="Organisation verlassen"
      description={
        alone
          ? 'Du bist allein in dieser Organisation. Lade jemanden ein und übergib sie, oder lösche sie.'
          : mustHandOver
            ? 'Du verlierst den Zugriff auf die Präsentationen dieser Organisation. Als einziger Admin übergibst du sie beim Verlassen an ein anderes Mitglied – danach kannst du eine neue eigene gründen.'
            : 'Du verlierst den Zugriff auf die Präsentationen dieser Organisation. Deine Präsentationen und Kommentare bleiben hier.'
      }
      aside={
        <Button
          variant="secondary"
          icon="logout"
          disabled={alone || (mustHandOver && !members.isSuccess)}
          onClick={() => setConfirming(true)}
        >
          Verlassen
        </Button>
      }
    >
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`„${workspace.name}“ verlassen?`}
        description={
          mustHandOver && successor
            ? `${successor.name} wird Admin und verwaltet die Organisation weiter. Zurück kommst du nur mit einer neuen Einladung.`
            : 'Zurück kommst du nur mit einer neuen Einladung.'
        }
        confirmLabel={mustHandOver ? 'Übergeben & verlassen' : 'Verlassen'}
        pending={leave.isPending}
        onConfirm={() =>
          leave.mutate(
            { userId, successor: mustHandOver ? successor?.userId : undefined },
            {
              onSuccess: () => void navigate(routes.reviews(), { replace: true }),
              onError: (error) => {
                setConfirming(false);
                onNotify(error.message, 'danger');
              },
            },
          )
        }
      >
        {mustHandOver && successor && (
          <label className="flex flex-col gap-1.5 text-body text-fg-muted">
            Neuer Admin
            <Select<string>
              value={successor.userId}
              onChange={setPicked}
              options={others.map((member) => ({
                value: member.userId,
                label: `${member.name} · ${ROLE_LABELS[member.role]}`,
              }))}
            />
          </label>
        )}
      </ConfirmDialog>
    </Section>
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
    <Section
      tone="danger"
      title="Organisation löschen"
      description="Löscht die Organisation mit allen Präsentationen, Kommentaren, Aufnahmen und Einladungen. Das lässt sich nicht rückgängig machen."
      aside={
        <Button variant="danger" icon="delete" onClick={() => setConfirming(true)}>
          Löschen
        </Button>
      }
    >
      <ConfirmDialog
        open={confirming}
        onClose={close}
        title={`„${workspace.name}“ endgültig löschen?`}
        description={
          <>
            Alle Präsentationen, Kommentare und Mitgliedschaften gehen verloren. Tippe zur
            Bestätigung den Namen der Organisation ein.
          </>
        }
        confirmLabel="Endgültig löschen"
        confirmIcon="delete"
        confirmDisabled={typed.trim() !== workspace.name}
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => void navigate(routes.reviews(), { replace: true }),
            onError: (error) => {
              close();
              onNotify(error.message, 'danger');
            },
          })
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
      </ConfirmDialog>
    </Section>
  );
}
