import { useState } from 'react';
import { updateWorkspaceSsoInputSchema, type Workspace, type WorkspaceSso } from '@slider/shared';
import { useDeleteWorkspaceSso, useSaveWorkspaceSso, useWorkspaceSso } from '@/lib/api';
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorText,
  LoadingState,
  Notice,
  Section,
  TextField,
  TextLink,
  useCopyToClipboard,
  type ShowToast,
} from '@/ui';

/**
 * Company login (BER-162): admins connect their own OpenID Connect provider for the addresses at
 * the workspace's company domain. Two steps – the provider, then a DNS TXT record proving
 * the domain. Admins only, and only where workspaces can be opened to a domain.
 */
export function SsoSection({
  workspace,
  enabled,
  onNotify,
}: {
  workspace: Workspace;
  /** Joining by domain is on for the instance (`SIGNUP` is not `invite`). */
  enabled: boolean;
  onNotify: ShowToast;
}) {
  const admin = enabled && workspace.role === 'admin';
  const sso = useWorkspaceSso(workspace.id, admin && workspace.joinDomain !== null);
  if (!admin) return null;

  return (
    <Section
      title="Firmen-Login (SSO)"
      description="Alle mit einer Adresse eurer Firma melden sich über euren eigenen Login-Anbieter an – Entra ID, Okta, Keycloak, Google Workspace oder jeder andere mit OpenID Connect."
    >
      {!workspace.joinDomain ? (
        <p className="text-body text-fg-subtle">
          Öffne den Workspace zuerst unter „Beitritt per Domain“ für eure Firmen-Domain. Der
          Firmen-Login gilt für die Adressen dort.
        </p>
      ) : sso.data ? (
        <SsoSettings
          key={`${sso.data.issuer}|${sso.data.clientId}`}
          workspaceId={workspace.id}
          sso={sso.data}
          onNotify={onNotify}
        />
      ) : sso.isError ? (
        <ErrorText>{sso.error.message}</ErrorText>
      ) : (
        <LoadingState padding="sm" />
      )}
    </Section>
  );
}

function SsoSettings({
  workspaceId,
  sso,
  onNotify,
}: {
  workspaceId: string;
  sso: WorkspaceSso;
  onNotify: ShowToast;
}) {
  const [issuer, setIssuer] = useState(sso.issuer ?? '');
  const [clientId, setClientId] = useState(sso.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [deleting, setDeleting] = useState(false);
  const save = useSaveWorkspaceSso(workspaceId);
  const remove = useDeleteWorkspaceSso(workspaceId);
  const parsed = updateWorkspaceSsoInputSchema.safeParse({
    issuer,
    clientId,
    clientSecret: clientSecret || undefined,
  });
  const ready = parsed.success && (sso.hasSecret || clientSecret.trim() !== '');

  if (!sso.available) {
    return (
      <Notice tone="info">
        Den Firmen-Login gibt es im Paid-Plan. Unter „Nutzung“ kannst du den Workspace upgraden.
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-xs text-fg-subtle">
        <Badge tone={sso.active ? 'success' : sso.configured ? 'warning' : 'neutral'}>
          {sso.active ? 'Aktiv' : sso.configured ? 'Domain noch nicht bestätigt' : 'Aus'}
        </Badge>
        {sso.active && `Alle mit @${sso.domain} können sich über euren Login-Anbieter anmelden.`}
      </p>

      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready || !parsed.success) return;
          save.mutate(parsed.data, {
            onSuccess: () => {
              setClientSecret('');
              onNotify('Firmen-Login gespeichert');
            },
            onError: (error) => onNotify(error.message, 'danger'),
          });
        }}
      >
        <p className="text-xs text-fg-subtle">
          1. Lege bei eurem Login-Anbieter eine App (Client) vom Typ „vertraulich“ an und trag diese
          Weiterleitungs-URI ein:
        </p>
        <CopyField label="Weiterleitungs-URI (genau so eintragen)" value={sso.redirectUri} />
        <TextField
          label="Issuer-URL"
          placeholder="https://login.firma.de/realms/firma"
          value={issuer}
          inputMode="url"
          autoComplete="off"
          onChange={(event) => setIssuer(event.target.value)}
        />
        <TextField
          label="Client ID"
          value={clientId}
          autoComplete="off"
          onChange={(event) => setClientId(event.target.value)}
        />
        <TextField
          label="Client Secret"
          type="password"
          value={clientSecret}
          autoComplete="new-password"
          placeholder={sso.hasSecret ? 'Gespeichert – leer lassen, um es zu behalten' : undefined}
          onChange={(event) => setClientSecret(event.target.value)}
        />
        <div>
          <Button
            type="submit"
            disabled={!ready}
            loading={save.isPending && save.variables !== 'verify'}
          >
            {sso.configured ? 'Speichern' : 'Verbinden'}
          </Button>
        </div>
      </form>

      {sso.dnsRecord && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-fg-subtle">
            2. Bestätige, dass @{sso.domain} euch gehört: Lege bei eurem DNS-Anbieter diesen
            TXT-Eintrag an und prüfe ihn dann.
          </p>
          <CopyField label="Name" value={sso.dnsRecord.name} />
          <CopyField label="Wert" value={sso.dnsRecord.value} />
          <div className="flex flex-wrap gap-2">
            <Button
              variant={sso.verified ? 'secondary' : 'primary'}
              icon="check"
              loading={save.isPending && save.variables === 'verify'}
              onClick={() =>
                save.mutate('verify', {
                  onSuccess: () => onNotify('Domain bestätigt'),
                  onError: (error) => onNotify(error.message, 'danger'),
                })
              }
            >
              {sso.verified ? 'Erneut prüfen' : 'Prüfen'}
            </Button>
            <Button variant="ghost" icon="delete" onClick={() => setDeleting(true)}>
              Firmen-Login entfernen
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleting}
        onClose={() => {
          setDeleting(false);
          // Resetting a running call would drop its success toast or error.
          if (!remove.isPending) remove.reset();
        }}
        title="Firmen-Login entfernen?"
        description="Wer sich bisher nur darüber angemeldet hat, braucht danach einen anderen Anmeldeweg."
        confirmLabel="Entfernen"
        confirmIcon="delete"
        pending={remove.isPending}
        // In the dialog: a toast would sit behind its backdrop.
        error={remove.error?.message}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => {
              setDeleting(false);
              onNotify('Firmen-Login entfernt');
            },
          })
        }
      />
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const { state, copy } = useCopyToClipboard();
  return (
    <TextField
      label={label}
      value={value}
      readOnly
      onFocus={(event) => event.currentTarget.select()}
      trailing={
        <TextLink
          size="xs"
          icon={state === 'copied' ? 'check' : 'contentCopy'}
          onClick={() => void copy(value)}
        >
          {state === 'copied' ? 'Kopiert' : 'Kopieren'}
        </TextLink>
      }
    />
  );
}
