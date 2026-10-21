import { useState, type FormEvent } from 'react';
import { ACCOUNT_EXPORT_URL, useDeleteAccount, useDeletionChoices } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { DELETION_RULES } from '../deletion-rules';
import { successorsComplete } from '../successors';
import { SuccessorPicker } from './SuccessorPicker';
import { Button, buttonClasses, ConfirmDialog, Section, TextField } from '@/ui';

/**
 * Data rights (BER-145, DSGVO Art. 15/17/20): a copy of everything stored about you, and deleting
 * your account – both by the person themselves, nothing for an admin to do by hand.
 */

/** A link that looks like a button: the browser downloads the ZIP itself. */
function DownloadLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} download className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
      {label}
    </a>
  );
}

export function ExportDataSection() {
  return (
    <Section
      title="Deine Daten"
      description="Alles, was Slider über dich speichert, als ZIP: Profil, Anmeldewege, deine Präsentationen mit Originaldateien, deine Kommentare und Aufnahmen."
      aside={<DownloadLink href={ACCOUNT_EXPORT_URL} label="Daten herunterladen" />}
    />
  );
}

export function DeleteAccountSection({ email }: { email: string }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <Section
      title="Konto löschen"
      tone="danger"
      description={`Löscht dein Konto endgültig. ${DELETION_RULES}`}
      aside={
        <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
          Konto löschen
        </Button>
      }
    >
      {confirming && <DeleteOwnAccountDialog email={email} onClose={() => setConfirming(false)} />}
    </Section>
  );
}

function DeleteOwnAccountDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [successors, setSuccessors] = useState<Record<string, string>>({});
  const choices = useDeletionChoices(true);
  const remove = useDeleteAccount();
  const matches = typed.trim().toLowerCase() === email.toLowerCase();
  const ready = matches && choices.isSuccess && successorsComplete(choices.data, successors);
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!ready || remove.isPending) return;
    remove.mutate(
      { confirmEmail: typed, successors },
      {
        // Another admin left meanwhile: the organisation now needs one chosen too – ask again.
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'bad_request') void choices.refetch();
        },
      },
    );
  };
  return (
    <ConfirmDialog
      onClose={onClose}
      title="Konto endgültig löschen?"
      description={`Das lässt sich nicht rückgängig machen. Lade vorher deine Daten herunter, wenn du sie behalten willst. Zur Bestätigung gib deine E-Mail-Adresse ein: ${email}`}
      confirmLabel="Konto löschen"
      confirmIcon="delete"
      confirmDisabled={!ready}
      pending={remove.isPending}
      error={remove.error?.message ?? choices.error?.message}
      onConfirm={() => submit()}
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {choices.data && (
          <SuccessorPicker choices={choices.data} value={successors} onChange={setSuccessors} />
        )}
        <TextField
          label="E-Mail-Adresse"
          type="email"
          autoComplete="off"
          value={typed}
          autoFocus
          onChange={(event) => setTyped(event.target.value)}
        />
      </form>
    </ConfirmDialog>
  );
}
