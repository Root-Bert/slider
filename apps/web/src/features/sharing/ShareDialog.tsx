import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { Author, CreatedWorkspaceInvite, Deck, WorkspaceInvite } from '@slider/shared';
import { routes } from '@/app/routes';
import { useDeckShares, useMe, useRevokeDeckShare, useShareDeck } from '@/lib/queries';
import { Avatar, Button, Dialog, Icon, IconButton, TextField } from '@/ui';
import { slidesLabel } from '@/features/reviews/lib/deck-labels';
import { seatsLine } from '@/features/workspaces/lib/plan';
import { canManageMembers, formatExpiry } from '@/features/workspaces/lib/roles';
import { OriginalUntouchedNote } from './components/OriginalUntouchedNote';
import { useCopyToClipboard } from './hooks/useCopyToClipboard';

interface ShareDialogProps {
  deck: Deck;
  open: boolean;
  onClose: () => void;
}

/**
 * "Teilen": there are no guests – sharing always invites into the deck's organisation as
 * `viewer` (only looks). Joining through the invite opens the deck.
 */
export function ShareDialog({ deck, open, onClose }: ShareDialogProps) {
  const { data: me } = useMe();
  const workspace = me?.workspaces?.find((candidate) => candidate.id === deck.workspaceId) ?? null;
  const share = useShareDeck(deck.id);
  const shares = useDeckShares(deck.id, open);
  const [created, setCreated] = useState<CreatedWorkspaceInvite | null>(null);
  const seats = workspace ? seatsLine(workspace.usage) : null;
  const openShares = (shares.data ?? []).filter((invite) => invite.state === 'valid');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Teilen"
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
      <p className="flex items-start gap-2 rounded-control bg-white/5 px-3 py-2.5 text-[13px] leading-5 text-fg-muted">
        <Icon name="visibility" size={18} className="mt-px shrink-0 text-fg-subtle" />
        <span>
          Wer die Präsentation sehen soll, tritt{' '}
          {workspace ? `„${workspace.name}“` : 'der Organisation'} als Betrachter bei – mit eigenem
          Konto, ohne Kommentieren.{seats ? ` ${seats}` : ''}
        </span>
      </p>

      <InviteByEmail
        pending={share.isPending}
        onInvite={(email) => share.mutateAsync({ email }).then(setCreated)}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-fg">Einladungslink</p>
          <Button
            variant="secondary"
            size="sm"
            icon="link"
            loading={share.isPending && !share.variables?.email}
            onClick={() => share.mutate({}, { onSuccess: setCreated })}
          >
            Neuer Link
          </Button>
        </div>
        {created && <CreatedInvite created={created} />}
      </div>

      {share.error && (
        <p role="alert" className="text-[13px] text-danger">
          {share.error.message}
        </p>
      )}

      {openShares.length > 0 && <OpenShares deckId={deck.id} invites={openShares} />}

      <div className="h-px bg-hairline" />
      <People owner={deck.owner} participants={deck.participants} />

      {workspace && canManageMembers(workspace.role) && (
        <p className="text-xs text-fg-subtle">
          Zum Kommentieren lädst du Personen mit einer anderen Rolle ein:{' '}
          <Link
            to={routes.workspaceInvites(workspace.id)}
            onClick={onClose}
            className="text-fg underline underline-offset-4 hover:text-white"
          >
            Mitglieder einladen
          </Link>
        </p>
      )}
    </Dialog>
  );
}

function InviteByEmail({
  pending,
  onInvite,
}: {
  pending: boolean;
  onInvite: (email: string) => Promise<unknown>;
}) {
  const [email, setEmail] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!address) return;
    void onInvite(address).then(
      () => setEmail(''),
      () => undefined,
    );
  };
  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <TextField
        label="Per E-Mail einladen"
        icon="at"
        size="lg"
        type="email"
        required
        value={email}
        placeholder="name@firma.de"
        onChange={(event) => setEmail(event.currentTarget.value)}
        className="min-w-0 flex-1"
      />
      <Button type="submit" size="lg" loading={pending && Boolean(email)}>
        Einladen
      </Button>
    </form>
  );
}

const COPY_LABELS = { idle: 'Kopieren', copied: 'Kopiert ✓', failed: 'Nicht kopiert' } as const;

/** The plain invite URL is only visible right after creating it (the server keeps a hash). */
function CreatedInvite({ created }: { created: CreatedWorkspaceInvite }) {
  const { state, copy } = useCopyToClipboard();
  const { email } = created.invite;
  return (
    <div className="flex flex-col gap-2">
      {email && (
        <p role="status" className="text-xs text-fg-subtle">
          {created.emailSent
            ? `Einladung an ${email} verschickt.`
            : `Für ${email} erstellt – schick den Link selbst.`}
        </p>
      )}
      <div className="flex items-end gap-2">
        <TextField
          aria-label="Einladungslink"
          icon="link"
          size="lg"
          readOnly
          value={created.url}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1"
        />
        <Button variant="secondary" size="lg" onClick={() => void copy(created.url)}>
          {COPY_LABELS[state]}
        </Button>
      </div>
    </div>
  );
}

function OpenShares({ deckId, invites }: { deckId: string; invites: readonly WorkspaceInvite[] }) {
  const headingId = useId();
  const revoke = useRevokeDeckShare(deckId);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-xs text-fg-subtle">
        Offene Einladungen <span className="text-fg-faint">{invites.length}</span>
      </h3>
      <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
        {invites.map((invite) => (
          <li key={invite.id} className="flex items-center gap-3 py-1">
            <Icon
              name={invite.email ? 'at' : 'link'}
              size={18}
              className="shrink-0 text-fg-subtle"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm text-fg">
                {invite.email ?? `Link · ${invite.useCount}× verwendet`}
              </span>
              <span className="truncate text-xs text-fg-subtle">
                {formatExpiry(invite.expiresAt)}
              </span>
            </span>
            <IconButton
              icon="close"
              label="Einladung zurückziehen"
              size="sm"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(invite.id)}
            />
          </li>
        ))}
      </ul>
    </section>
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
        <PersonRow person={owner} suffix="(Du)" kind="Besitzer" />
        {others.map((person) => (
          <PersonRow key={person.id} person={person} kind={PERSON_KIND[person.type]} />
        ))}
      </ul>
    </section>
  );
}

/** Neutral on purpose: someone who commented may have left the organisation since. */
const PERSON_KIND: Record<Author['type'], string> = {
  owner: 'Kommentiert in Slider',
  external: 'Kommentar aus PowerPoint',
};

function PersonRow({ person, suffix, kind }: { person: Author; suffix?: string; kind: string }) {
  return (
    <li className="flex items-center gap-3">
      <Avatar author={person} size={32} showPowerPointBadge={person.type === 'external'} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-fg">
          {person.name}
          {suffix && <span className="text-fg-subtle"> {suffix}</span>}
        </span>
        <span className="truncate text-xs text-fg-subtle">{kind}</span>
      </div>
    </li>
  );
}
