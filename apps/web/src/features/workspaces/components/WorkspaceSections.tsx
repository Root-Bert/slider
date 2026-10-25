import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  emailDomain,
  isCompanyDomain,
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
  useSetWorkspaceDomain,
  useWorkspaceLogo,
} from '@/lib/api';
import {
  Badge,
  Button,
  ConfirmDialog,
  Section,
  Select,
  TextField,
  TextLink,
  Toggle,
  type ShowToast,
} from '@/ui';
import { subscriptionRenews } from '../lib/plan';
import { canRenameWorkspace, isLastAdmin, ROLE_HINTS, ROLE_LABELS } from '../lib/roles';
import { DepartureDecks } from './DepartureDecks';
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

/**
 * Company workspace (BER-148): everyone with an address at the admin's domain finds it and
 * joins as member. Admins only; mail provider domains can't be opened, only closed again.
 */
export function DomainSection({
  workspace,
  email,
  enabled,
  onNotify,
}: {
  workspace: Workspace;
  email: string;
  /** Joining by domain is on for the instance (`SIGNUP` is not `invite`). */
  enabled: boolean;
  onNotify: ShowToast;
}) {
  const setDomain = useSetWorkspaceDomain(workspace.id);
  const own = emailDomain(email);
  const domain = workspace.joinDomain ?? own;
  if (!enabled || workspace.role !== 'admin') return null;
  if (!workspace.joinDomain && !isCompanyDomain(own)) return null;

  return (
    <Section
      title="Beitritt per Domain"
      description="Wie bei Slack: Wer sich mit einer Adresse eurer Firma anmeldet, sieht den Workspace und kann ohne Einladung beitreten."
    >
      <Toggle
        checked={workspace.joinDomain !== null}
        disabled={setDomain.isPending}
        label={`Alle mit @${domain} können beitreten`}
        icon="personAdd"
        description="Sie treten als Mitglied bei. Rollen änderst du danach unter Mitglieder."
        onChange={(enabled) =>
          setDomain.mutate(enabled, {
            onSuccess: () => onNotify(enabled ? `Offen für @${own}` : 'Nur noch mit Einladung'),
            onError: (error) => onNotify(error.message, 'danger'),
          })
        }
      />
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
          {workspace.logoUrl ? 'Logo des Workspace' : 'Noch kein Logo'}
        </p>
      )}
    </div>
  );
}

/**
 * Leaving. The last admin hands the workspace to another member first – picked right in the
 * dialog, they become admin in the same step. Alone in it, only deleting is left. Whoever pays
 * for a running subscription hands over paying first (BER-154).
 */
export function LeaveSection({ workspace, userId }: { workspace: Workspace; userId: string }) {
  const [confirming, setConfirming] = useState(false);
  const leave = useRemoveMember(workspace.id);
  const members = useMembers(workspace.id);
  const navigate = useNavigate();
  const list = members.data ?? [];
  // Viewers (guests) take the workspace over only when nobody else is left (the API too).
  const rest = list.filter((member) => member.userId !== userId);
  const nonViewers = rest.filter((member) => member.role !== 'viewer');
  const others = nonViewers.length > 0 ? nonViewers : rest;
  const mustHandOver = isLastAdmin(
    workspace.role,
    list.filter((member) => member.role === 'admin').length,
  );
  const [picked, setPicked] = useState<string | null>(null);
  const successor = others.find((member) => member.userId === picked) ?? others[0];
  // No one to hand over to: really alone.
  const noSuccessor = mustHandOver && members.isSuccess && others.length === 0;
  // Paying for a running subscription: hand over paying first (BER-154). Alone, deleting is left.
  const paying = workspace.billing.isOwner && subscriptionRenews(workspace) && !noSuccessor;
  // Paying can only go to another admin – with none yet, someone becomes admin first.
  const noOtherAdmin = members.isSuccess && !rest.some((member) => member.role === 'admin');
  const usageLink = (
    <TextLink to={routes.usage(workspace.id)} variant="inline" weight="medium">
      „Nutzung“
    </TextLink>
  );
  const descriptionId = useId();

  return (
    <Section
      title="Workspace verlassen"
      description={
        // The id ties the reason to the disabled button.
        <span id={descriptionId}>
          {noSuccessor ? (
            'Du bist allein in diesem Workspace. Lade jemanden ein und übergib ihn, oder lösche ihn.'
          ) : paying && noOtherAdmin ? (
            <>
              Du bezahlst für diesen Workspace. Mach zuerst jemanden zum Admin und übergib dann die
              Zahlung (unter {usageLink}), dann kannst du ihn verlassen.
            </>
          ) : paying ? (
            <>
              Du bezahlst für diesen Workspace. Übergib zuerst die Zahlung an einen anderen Admin
              (unter {usageLink}), dann kannst du ihn verlassen.
            </>
          ) : mustHandOver ? (
            'Du verlierst den Zugriff auf die Reviews dieses Workspace. Als einziger Admin übergibst du ihn beim Verlassen an ein anderes Mitglied – danach kannst du einen neuen eigenen gründen.'
          ) : (
            'Du verlierst den Zugriff auf die Reviews dieses Workspace. Deine Kommentare bleiben hier; was mit deinen Reviews passiert, zeigt der nächste Schritt.'
          )}
        </span>
      }
      aside={
        <Button
          variant="secondary"
          icon="logout"
          disabled={noSuccessor || paying || (mustHandOver && !members.isSuccess)}
          aria-describedby={noSuccessor || paying ? descriptionId : undefined}
          onClick={() => setConfirming(true)}
        >
          Verlassen
        </Button>
      }
    >
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          leave.reset();
        }}
        title={`„${workspace.name}“ verlassen?`}
        description={
          mustHandOver && successor
            ? `${successor.name} wird Admin. Zurück kommst du nur mit einer neuen Einladung.`
            : 'Zurück kommst du nur mit einer neuen Einladung.'
        }
        confirmLabel={mustHandOver ? 'Übergeben & verlassen' : 'Verlassen'}
        pending={leave.isPending}
        // In the dialog: a toast would sit behind its backdrop.
        error={leave.error?.message}
        onConfirm={() =>
          leave.mutate(
            { userId, successor: mustHandOver ? successor?.userId : undefined },
            { onSuccess: () => void navigate(routes.reviews(), { replace: true }) },
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
                label: `${member.name} | ${ROLE_LABELS[member.role]}`,
              }))}
            />
          </label>
        )}
        {confirming && (
          <DepartureDecks
            workspaceId={workspace.id}
            userId={userId}
            successor={mustHandOver ? successor?.userId : undefined}
            self
            viewerId={userId}
          />
        )}
      </ConfirmDialog>
    </Section>
  );
}

/**
 * Deleting, admins only. While a subscription runs only the admin paying for it may – deleting
 * ends it (BER-154); the others see who can.
 */
export function DeleteSection({ workspace }: { workspace: Workspace }) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const remove = useDeleteWorkspace(workspace.id);
  const navigate = useNavigate();
  const paid = subscriptionRenews(workspace);
  const blocked = paid && !workspace.billing.isOwner;
  const payer = workspace.billing.owner?.name ?? 'die Person, die das Abo bezahlt,';
  const descriptionId = useId();
  const close = () => {
    setConfirming(false);
    setTyped('');
    remove.reset();
  };

  return (
    <Section
      tone="danger"
      title="Workspace löschen"
      description={
        // The id ties the reason to the disabled button.
        <span id={descriptionId}>
          {blocked
            ? `Solange das Abo läuft, kann nur ${payer} den Workspace löschen – dabei wird das Abo gekündigt.`
            : 'Löscht den Workspace mit allen Reviews, Kommentaren, Aufnahmen und Einladungen. Das lässt sich nicht rückgängig machen.'}
        </span>
      }
      aside={
        <Button
          variant="danger"
          icon="delete"
          disabled={blocked}
          aria-describedby={blocked ? descriptionId : undefined}
          onClick={() => setConfirming(true)}
        >
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
            Alle Reviews, Kommentare und Mitgliedschaften gehen verloren.
            {paid && ' Das laufende Abo wird dabei gekündigt.'} Tippe zur Bestätigung den Namen des
            Workspace ein.
          </>
        }
        confirmLabel="Endgültig löschen"
        confirmIcon="delete"
        confirmDisabled={typed.trim() !== workspace.name}
        pending={remove.isPending}
        // In the dialog: a toast would sit behind its backdrop.
        error={remove.error?.message}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => void navigate(routes.reviews(), { replace: true }),
          })
        }
      >
        {confirming && (
          <TextField
            aria-label="Name des Workspace"
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
