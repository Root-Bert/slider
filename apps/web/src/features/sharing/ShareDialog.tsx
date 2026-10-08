import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Author, Deck, Workspace } from '@slider/shared';
import { routes } from '@/app/routes';
import { useMe } from '@/lib/queries';
import { Avatar, Button, Dialog, Icon, Toggle, type IconName } from '@/ui';
import { Select, type SelectOption } from '@/ui';
import { slidesLabel } from '@/features/reviews/lib/deck-labels';
import { seatsLine } from '@/features/workspaces/lib/plan';
import { canManageMembers } from '@/features/workspaces/lib/roles';
import { OriginalUntouchedNote } from './components/OriginalUntouchedNote';
import { ShareLinkField } from './components/ShareLinkField';
import { useShareLink } from './hooks/useShareLink';

interface ShareDialogProps {
  deck: Deck;
  open: boolean;
  onClose: () => void;
}

/**
 * C1 "Review teilen" (BER-102). Since BER-130 collaboration happens inside the organisation:
 * the primary action invites members, the guest link is view-only.
 */
export function ShareDialog({ deck, open, onClose }: ShareDialogProps) {
  const share = useShareLink(deck.id, open);
  const { data: me } = useMe();
  const workspace = me?.workspaces?.find((candidate) => candidate.id === deck.workspaceId) ?? null;
  const viewLinkId = useId();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Review teilen"
      description={`${deck.title} · ${slidesLabel(deck.slideCount)}`}
      footer={
        <>
          <OriginalUntouchedNote className="mr-auto" />
          <Button size="sm" onClick={onClose}>
            Fertig
          </Button>
        </>
      }
    >
      {workspace && <InviteMembers workspace={workspace} onNavigate={onClose} />}

      <section aria-labelledby={viewLinkId} className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 id={viewLinkId} className="flex items-center gap-2 text-sm font-medium text-fg">
            <Icon name="visibility" size={18} className="text-fg-subtle" />
            Link zum Ansehen
          </h3>
          <p className="text-xs text-fg-subtle">
            Ansehen ohne Konto – kommentieren können nur Mitglieder der Organisation.
          </p>
        </div>
        <ShareLinkField
          link={share.activeLink}
          loading={share.loading}
          onCreate={share.createNew}
        />
      </section>

      <div className="flex flex-col gap-3.5">
        <SettingRow icon="schedule">
          <ExpirySetting
            value={share.settings.expiresInDays}
            disabled={!share.activeLink || share.busy}
            onChange={(expiresInDays) => share.update({ expiresInDays })}
          />
        </SettingRow>
        <SettingRow icon="key" title="Folgt bald">
          <Toggle
            label="Passwort"
            description="Folgt bald"
            checked={false}
            disabled
            onChange={() => undefined}
          />
        </SettingRow>
        <SettingRow icon="visibilityOff" title="Folgt mit Versionen">
          <Toggle
            label="Gelöschte Folien für Gäste ausblenden"
            description="Folgt mit Versionen"
            checked={false}
            disabled
            onChange={() => undefined}
          />
        </SettingRow>
        <p className="pl-8 text-xs text-fg-subtle">
          Änderungen erzeugen einen neuen Link – der bisherige funktioniert dann nicht mehr.
        </p>
      </div>

      {share.error && (
        <p role="alert" className="text-[13px] text-danger">
          {share.error.message}
        </p>
      )}

      <div className="h-px bg-hairline" />
      <People owner={deck.owner} participants={deck.participants} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-xs text-fg-subtle">
          {share.activeLink
            ? 'Widerrufen sperrt den Link sofort für alle, die nur ansehen.'
            : 'Kein aktiver Link – ohne Konto kann den Review gerade niemand öffnen.'}
        </p>
        <Button
          variant="danger"
          size="sm"
          icon="close"
          disabled={!share.activeLink}
          loading={share.revoking}
          onClick={share.revoke}
        >
          Link widerrufen
        </Button>
      </div>
    </Dialog>
  );
}

/** The primary way to share: people join the organisation and comment there. */
function InviteMembers({
  workspace,
  onNavigate,
}: {
  workspace: Workspace;
  onNavigate: () => void;
}) {
  const mayInvite = canManageMembers(workspace.role);
  const seats = seatsLine(workspace.usage);
  return (
    <section className="flex flex-col items-start gap-3 rounded-control bg-white/5 p-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-medium text-fg">Mit dem Team kommentieren</p>
        <p className="text-xs leading-[18px] text-fg-subtle">
          Alle Mitglieder von „{workspace.name}“ sehen diesen Review und können kommentieren.
          {mayInvite
            ? seats
              ? ` ${seats}`
              : ''
            : ' Neue Mitglieder lädt ein Admin der Organisation ein.'}
        </p>
      </div>
      {mayInvite && (
        <Link
          to={routes.workspaceInvites(workspace.id)}
          onClick={onNavigate}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-control bg-primary px-4 text-sm font-medium whitespace-nowrap text-on-primary transition-colors hover:bg-white"
        >
          <Icon name="personAdd" size={18} />
          Mitglieder einladen
        </Link>
      )}
    </section>
  );
}

function SettingRow({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3" title={title}>
      <Icon name={icon} size={20} className="shrink-0 text-fg-subtle" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

type ExpiryChoice = 'never' | `${number}`;

const STANDARD_EXPIRY: readonly SelectOption<ExpiryChoice>[] = [
  { value: 'never', label: 'Nie' },
  { value: '7', label: '7 Tage' },
  { value: '30', label: '30 Tage' },
];

function ExpirySetting({
  value,
  disabled,
  onChange,
}: {
  value: number | null;
  disabled: boolean;
  onChange: (days: number | null) => void;
}) {
  const id = useId();
  const choice: ExpiryChoice = value === null ? 'never' : `${value}`;
  // Links created elsewhere (API, older clients) may use another lifetime – show it instead of lying.
  const options = STANDARD_EXPIRY.some((option) => option.value === choice)
    ? STANDARD_EXPIRY
    : [...STANDARD_EXPIRY, { value: choice, label: `${value} Tage` }];

  return (
    <div className="flex items-center justify-between gap-4">
      <label htmlFor={id} className="text-sm text-fg">
        Link läuft ab
      </label>
      <Select
        id={id}
        size="sm"
        value={choice}
        options={options}
        disabled={disabled}
        onChange={(next) => onChange(next === 'never' ? null : Number(next))}
      />
    </div>
  );
}

function People({ owner, participants }: { owner: Author; participants: readonly Author[] }) {
  const headingId = useId();
  const others = participants.filter((person) => person.id !== owner.id);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-xs text-fg-subtle">
        Personen <span className="text-fg-faint">{others.length + 1}</span>
      </h3>
      <ul className="flex max-h-48 flex-col gap-3 overflow-y-auto">
        <PersonRow person={owner} suffix="(Du)" role="Besitzer" />
        {others.map((person) => (
          <PersonRow
            key={person.id}
            person={person}
            role={person.type === 'guest' ? 'Kann ansehen' : 'Kann kommentieren'}
          />
        ))}
      </ul>
    </section>
  );
}

const PERSON_KIND: Record<Author['type'], string> = {
  owner: 'Besitzer',
  guest: 'Gast ohne Account',
  external: 'Kommentar aus PowerPoint',
};

function PersonRow({ person, suffix, role }: { person: Author; suffix?: string; role: string }) {
  return (
    <li className="flex items-center gap-3">
      <Avatar author={person} size={32} showPowerPointBadge={person.type === 'external'} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-fg">
          {person.name}
          {suffix && <span className="text-fg-subtle"> {suffix}</span>}
        </span>
        <span className="truncate text-xs text-fg-subtle">{PERSON_KIND[person.type]}</span>
      </div>
      <span className="shrink-0 text-xs text-fg-subtle">{role}</span>
    </li>
  );
}
