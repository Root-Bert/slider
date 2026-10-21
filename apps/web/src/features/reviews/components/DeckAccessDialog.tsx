import { useId, useMemo, useState, type ReactNode } from 'react';
import type { Deck, DeckAccess, WorkspaceMember } from '@slider/shared';
import { pluralize } from '@/lib/format';
import { useDeckAccess, useMembers, useUpdateDeckAccess } from '@/lib/api';
import { useAccount } from '@/features/auth';
import { Avatar, Badge, Button, cn, Dialog, ErrorText, Icon, LoadingState, TextField } from '@/ui';

/** Why a member can't be taken off the list – shown as the row's tooltip. */
const lockedReason = (member: WorkspaceMember, ownerId: string): string | null =>
  member.userId === ownerId
    ? 'Hat die Review angelegt'
    : member.role === 'admin'
      ? 'Admin der Organisation'
      : null;

const matches = (member: WorkspaceMember, query: string) =>
  member.name.toLowerCase().includes(query) || member.email.toLowerCase().includes(query);

/**
 * "Zugriff einschränken …" in a deck's ⋯ / right-click menu (managers only): everyone in the
 * organisation may open the review, or only the people ticked here. Whoever added the review and
 * the organisation's admins always may – their rows stay ticked and can't be changed.
 */
export function DeckAccessDialog({
  deck,
  onClose,
  onSaved,
}: {
  deck: Deck;
  onClose: () => void;
  /** After saving, with what now applies and what did before – for a toast. */
  onSaved: (access: DeckAccess, before: DeckAccess) => void;
}) {
  const { workspaces } = useAccount();
  const workspaceName =
    workspaces.find((workspace) => workspace.id === deck.workspaceId)?.name ?? 'der Organisation';
  const access = useDeckAccess(deck.id);
  const members = useMembers(deck.workspaceId);

  const loading = access.isPending || members.isPending;
  const failed = access.error ?? members.error;

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Zugriff auf „${deck.title}“`}
      description="Wer die Review angelegt hat und die Admins haben immer Zugriff."
      className="w-[min(520px,calc(100vw-32px))]"
    >
      {failed && !(access.data && members.data) ? (
        <ErrorText role="alert">{failed.message}</ErrorText>
      ) : loading || !access.data || !members.data ? (
        <LoadingState padding="sm" />
      ) : (
        <AccessForm
          deck={deck}
          workspaceName={workspaceName}
          access={access.data}
          members={members.data}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  );
}

/** The loaded form: starts from the saved access, sends the whole list on "Speichern". */
function AccessForm({
  deck,
  workspaceName,
  access,
  members,
  onClose,
  onSaved,
}: {
  deck: Deck;
  workspaceName: string;
  access: DeckAccess;
  members: WorkspaceMember[];
  onClose: () => void;
  onSaved: (access: DeckAccess, before: DeckAccess) => void;
}) {
  const { user } = useAccount();
  const update = useUpdateDeckAccess(deck.id, deck.workspaceId);
  const [restricted, setRestricted] = useState(access.restricted);
  const [selected, setSelected] = useState(() => new Set(access.userIds));
  const [query, setQuery] = useState('');
  // Opening on a restricted review starts in the search; otherwise on the ticked answer. Picking
  // "Nur ausgewählte Personen" later keeps the focus on that radio (no jump while arrowing).
  const [searchFirst, setSearchFirst] = useState(access.restricted);
  const listId = useId();
  const choiceName = useId();

  // Those who always have access first (owner, then admins), then everyone else as listed.
  const rows = useMemo(
    () =>
      members
        .map((member) => ({ member, reason: lockedReason(member, deck.owner.id) }))
        .sort(
          (a, b) =>
            Number(b.member.userId === deck.owner.id) - Number(a.member.userId === deck.owner.id) ||
            Number(b.reason !== null) - Number(a.reason !== null),
        ),
    [members, deck.owner.id],
  );
  const needle = query.trim().toLowerCase();
  const visible = needle ? rows.filter(({ member }) => matches(member, needle)) : rows;
  // Only current members count – someone who left since is dropped on saving. An admin's own
  // grant from before they became admin is kept, so it still applies should they step down.
  const chosen = rows
    .filter(({ member }) => member.userId !== deck.owner.id && selected.has(member.userId))
    .map(({ member }) => member.userId);

  const toggle = (userId: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(userId);
      else next.delete(userId);
      return next;
    });

  const choose = (next: boolean) => {
    setSearchFirst(false);
    setRestricted(next);
  };

  const save = () =>
    update.mutate(
      { restricted, userIds: chosen },
      { onSuccess: (saved) => onSaved(saved, access) },
    );

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!update.isPending) save();
      }}
    >
      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">Wer die Review öffnen darf</legend>
        <ChoiceRow
          name={choiceName}
          checked={!restricted}
          autoFocus={!access.restricted}
          onSelect={() => choose(false)}
          icon="person"
          title={`Alle in ${workspaceName}`}
          description="Jedes Mitglied der Organisation kann die Review öffnen."
        />
        <ChoiceRow
          name={choiceName}
          checked={restricted}
          onSelect={() => choose(true)}
          icon="lock"
          title="Nur ausgewählte Personen"
          description="Nur wen du unten auswählst – dazu wer sie angelegt hat und die Admins."
        />
      </fieldset>

      {restricted && (
        <div className="flex flex-col gap-3">
          <TextField
            type="search"
            aria-label="Personen suchen"
            aria-controls={listId}
            placeholder="Name oder E-Mail suchen"
            icon="search"
            autoFocus={searchFirst}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <p className="text-xs text-fg-subtle" aria-live="polite">
            {pluralize(chosen.length, 'Person', 'Personen')} ausgewählt
          </p>
          <ul
            id={listId}
            aria-label="Mitglieder"
            className="-mx-2 flex max-h-72 flex-col overflow-y-auto overscroll-contain"
          >
            {visible.map(({ member, reason }) => (
              <MemberCheckRow
                key={member.userId}
                member={member}
                self={member.userId === user.id}
                lockedReason={reason}
                checked={reason !== null || selected.has(member.userId)}
                onChange={(on) => toggle(member.userId, on)}
              />
            ))}
            {visible.length === 0 && (
              <li className="px-2 py-3 text-body text-fg-subtle">Niemand gefunden</li>
            )}
          </ul>
        </div>
      )}

      {update.error && (
        <ErrorText role="alert" size="xs">
          {update.error.message}
        </ErrorText>
      )}

      {/* Wraps on narrow screens instead of pushing "Abbrechen" off the start edge. */}
      <footer className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Abbrechen
        </Button>
        <Button type="submit" loading={update.isPending}>
          Speichern
        </Button>
      </footer>
    </form>
  );
}

/** One of the two answers to "who may open it": a radio with title and explanation. */
function ChoiceRow({
  name,
  checked,
  autoFocus = false,
  onSelect,
  icon,
  title,
  description,
}: {
  name: string;
  checked: boolean;
  /** Takes the focus when the dialog opens (see `Dialog`'s `data-autofocus`). */
  autoFocus?: boolean;
  onSelect: () => void;
  icon: 'person' | 'lock';
  title: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        'flex items-center gap-3 rounded-control px-3 py-2.5 transition-colors',
        'has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-mention',
        checked ? 'bg-surface-2' : 'hover:bg-surface-1',
      )}
    >
      <input
        type="radio"
        name={name}
        className="sr-only"
        checked={checked}
        // React's autoFocus covers a form that loads after the dialog opened; `data-autofocus`
        // one that's there right away (the dialog isn't open yet while React commits).
        autoFocus={autoFocus}
        data-autofocus={autoFocus || undefined}
        onChange={onSelect}
      />
      <Icon name={icon} size={20} className="text-fg-muted" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-fg">{title}</span>
        <span className="text-xs text-fg-subtle">{description}</span>
      </span>
      <Icon
        name={checked ? 'checkCircle' : 'radioButtonUnchecked'}
        size={20}
        className={checked ? 'text-fg' : 'text-fg-faint'}
      />
    </label>
  );
}

/** A member with a tick box; owner and admins stay ticked ("hat immer Zugriff"). */
function MemberCheckRow({
  member,
  self,
  lockedReason,
  checked,
  onChange,
}: {
  member: WorkspaceMember;
  self: boolean;
  lockedReason: string | null;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const locked = lockedReason !== null;
  return (
    <li>
      <label
        title={lockedReason ?? undefined}
        className={cn(
          'flex items-center gap-3 rounded-control-sm px-2 py-2',
          !locked && 'hover:bg-surface-1',
        )}
      >
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={locked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <CheckBox checked={checked} locked={locked} />
        <Avatar author={{ ...member, type: 'owner' }} size={32} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-body font-medium text-fg">
              {member.name}
              {self && <span className="font-normal text-fg-subtle"> (du)</span>}
            </span>
            {member.role === 'admin' && <Badge>Admin</Badge>}
          </span>
          <span className="truncate text-xs text-fg-subtle">{member.email}</span>
        </span>
        {locked && <LockedNote>hat immer Zugriff</LockedNote>}
      </label>
    </li>
  );
}

/** The visible box of the (visually hidden) checkbox before it – a peer for focus and state. */
function CheckBox({ checked, locked }: { checked: boolean; locked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-[18px] shrink-0 items-center justify-center rounded-badge transition-colors',
        'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-mention',
        checked ? 'bg-primary text-on-primary' : 'shadow-[inset_0_0_0_1.5px_var(--color-fg-faint)]',
        locked && 'opacity-50',
      )}
    >
      {checked && <Icon name="check" size={14} />}
    </span>
  );
}

function LockedNote({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-xs text-fg-subtle">{children}</span>;
}
