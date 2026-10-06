import { useId, type ReactNode } from 'react';
import type { Author, Deck } from '@slider/shared';
import { Avatar, Button, Dialog, Icon, Toggle, type IconName } from '@/ui';
import { Select, type SelectOption } from '@/ui';
import { slidesLabel } from '@/features/reviews/lib/deck-labels';
import { OriginalUntouchedNote } from './components/OriginalUntouchedNote';
import { ShareLinkField } from './components/ShareLinkField';
import { useShareLink } from './hooks/useShareLink';

interface ShareDialogProps {
  deck: Deck;
  open: boolean;
  onClose: () => void;
}

/** C1 "Review teilen" (BER-102): one guest link per deck, role and expiry, people with access. */
export function ShareDialog({ deck, open, onClose }: ShareDialogProps) {
  const share = useShareLink(deck.id, open);

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
      <ShareLinkField link={share.activeLink} loading={share.loading} onCreate={share.createNew} />

      <div className="flex flex-col gap-3.5">
        <SettingRow icon="person">
          <Toggle
            label="Gäste ohne Account dürfen kommentieren"
            description="Gäste geben beim Öffnen nur ihren Namen an"
            checked={share.settings.role === 'comment'}
            disabled={!share.activeLink || share.busy}
            onChange={(checked) => share.update({ role: checked ? 'comment' : 'view' })}
          />
        </SettingRow>
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
            ? 'Widerrufen sperrt den Link sofort für alle Gäste.'
            : 'Kein aktiver Link – Gäste können den Review gerade nicht öffnen.'}
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
          <PersonRow key={person.id} person={person} role="Kann kommentieren" />
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
