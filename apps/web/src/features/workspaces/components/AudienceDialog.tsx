import { useState } from 'react';
import { emailDomain, isCompanyDomain, workspaceNameSchema, type Workspace } from '@slider/shared';
import { useRenameWorkspace, useSetWorkspaceDomain } from '@/lib/api';
import { Button, Dialog, Icon, TextField, type IconName } from '@/ui';

/**
 * Right after sign-up (BER-148): the organisation Slider founded for a company address – is it
 * private, or the company's, which everyone with an address at the domain finds and joins?
 * Closing asks again on the next visit.
 */
export function AudienceDialog({ workspace, email }: { workspace: Workspace; email: string }) {
  const [dismissed, setDismissed] = useState(false);
  const [name, setName] = useState(workspace.name);
  const rename = useRenameWorkspace(workspace.id);
  const setDomain = useSetWorkspaceDomain(workspace.id);
  const domain = emailDomain(email);
  const parsed = workspaceNameSchema.safeParse(name);
  const busy = rename.isPending || setDomain.isPending;
  const error = rename.error ?? setDomain.error;

  const choose = async (company: boolean) => {
    if (!parsed.success) return;
    if (parsed.data !== workspace.name) await rename.mutateAsync(parsed.data);
    await setDomain.mutateAsync(company);
  };

  if (!isCompanyDomain(domain)) return null;
  return (
    <Dialog
      open={!dismissed}
      onClose={() => setDismissed(true)}
      title="Für wen ist diese Organisation?"
      description="Wir haben dir eine Organisation angelegt. Das kannst du später in den Einstellungen ändern."
    >
      <div className="flex flex-col gap-4">
        <TextField
          label="Name"
          value={name}
          maxLength={80}
          error={parsed.success ? null : 'Der Name darf nicht leer sein.'}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="flex flex-col gap-2">
          <Choice
            icon="person"
            title="Nur für mich"
            description="Privat. Andere kommen nur mit einer Einladung hinein."
            disabled={busy || !parsed.success}
            onClick={() => void choose(false).catch(() => undefined)}
          />
          <Choice
            icon="personAdd"
            title={`Für mein Team bei ${domain}`}
            description={`Alle mit einer @${domain}-Adresse finden die Organisation und können beitreten.`}
            disabled={busy || !parsed.success}
            onClick={() => void choose(true).catch(() => undefined)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error.message}
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => setDismissed(true)}>
            Später
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function Choice({
  icon,
  title,
  description,
  disabled,
  onClick,
}: {
  icon: IconName;
  title: string;
  description: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-start gap-3 rounded-control bg-surface-1 px-4 py-3 text-left transition-colors hover:bg-hover disabled:opacity-50"
    >
      <Icon name={icon} size={20} className="mt-0.5 shrink-0 text-fg-muted" />
      <span className="flex flex-col gap-0.5">
        <span className="text-body font-medium text-fg">{title}</span>
        <span className="text-sm text-fg-subtle">{description}</span>
      </span>
    </button>
  );
}
