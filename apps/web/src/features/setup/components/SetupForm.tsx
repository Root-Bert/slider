import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import {
  API_PREFIX,
  type SaveSetupInput,
  type SaveSetupResult,
  type SetupField,
  type SetupKey,
  type SetupStatus,
  type SignupMode,
} from '@slider/shared';
import { routes } from '@/lib/routes';
import { apiRequest } from '@/lib/api-client';
import { workspaceKeys } from '@/lib/api';
import {
  Button,
  Notice,
  Section,
  Select,
  Spinner,
  TextField,
  TextLink,
  useCopyToClipboard,
} from '@/ui';
import {
  collectChanges,
  EMPTY_SMTP,
  initialDraft,
  smtpUrl,
  type SetupDraft,
  type SmtpParts,
} from '../lib/setup-form';

/** Before the first account: where the setup link is. Afterwards: only the admin. */
export function NotAuthorized({ status }: { status: SetupStatus }) {
  if (status.hasAccount) {
    return (
      <Notice tone="warning">
        Nur der Admin dieser Slider-Instanz kann die Einrichtung ändern.{' '}
        <TextLink to={routes.login('/einrichtung')} variant="inline">
          Als Admin anmelden
        </TextLink>
      </Notice>
    );
  }
  return (
    <Notice tone="warning">
      Öffne den Einrichtungslink aus dem Server-Log – er endet auf <Code>/einrichtung#token=…</Code>
      . Mit Docker zum Beispiel: <Code>docker logs slider</Code>.
    </Notice>
  );
}

type Settings = NonNullable<SetupStatus['settings']>;

export function SetupForm({
  status,
  settings,
  headers,
}: {
  status: SetupStatus;
  settings: Settings;
  headers: Record<string, string>;
}) {
  const queryClient = useQueryClient();
  const { fields } = settings;
  const [draft, setDraft] = useState<SetupDraft>(() => initialDraft(fields));
  const [smtp, setSmtp] = useState<SmtpParts>(EMPTY_SMTP);
  const [removed, setRemoved] = useState<ReadonlySet<SetupKey>>(new Set());
  const [phase, setPhase] = useState<'edit' | 'restarting' | 'saved'>('edit');

  const set = (key: SetupKey) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const remove = (keys: SetupKey[]) => setRemoved((r) => new Set([...r, ...keys]));

  const save = useMutation({
    mutationFn: (values: SaveSetupInput['values']) =>
      apiRequest<SaveSetupResult>('/setup', { method: 'PUT', body: { values }, headers }),
    onSuccess: async (result) => {
      if (result.restart === 'manual') {
        setPhase('saved');
        return;
      }
      setPhase('restarting');
      await waitForRestart();
      await queryClient.invalidateQueries({ queryKey: ['setup'] });
      await queryClient.invalidateQueries({ queryKey: workspaceKeys.providers });
      setRemoved(new Set());
      setSmtp(EMPTY_SMTP);
      setPhase('saved');
    },
  });

  const submit = () => {
    const withSmtp = { ...draft, SMTP_URL: smtpUrl(smtp) };
    save.mutate(collectChanges(fields, withSmtp, removed));
  };

  const stored = (keys: SetupKey[]) =>
    keys.some((key) => fields[key].source === 'stored' && !removed.has(key));
  const field = (key: SetupKey, label: string, props: FieldProps = {}) => (
    <SetupTextField
      key={key}
      label={label}
      field={fields[key]}
      value={draft[key]}
      onChange={set(key)}
      removed={removed.has(key)}
      {...props}
    />
  );
  const removeButton = (keys: SetupKey[]) =>
    stored(keys) ? (
      <Button variant="ghost" size="sm" icon="delete" onClick={() => remove(keys)}>
        Entfernen
      </Button>
    ) : null;

  const signup = (draft.SIGNUP || 'open') as SignupMode;
  const smtpFromEnv = fields.SMTP_URL.source === 'env';

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {phase === 'saved' && <Saved status={status} manual={settings.restart === 'manual'} />}

      <Section
        title="Adresse"
        description="Kommt aus SLIDER_URL. Alle Links und Weiterleitungen zeigen dorthin."
      >
        <TextField label="Öffentliche Adresse" value={settings.url} readOnly />
      </Section>

      {!status.hasAccount && (
        <Section
          title="Dein Admin-Konto"
          description="Wer sich zuerst mit dieser Adresse anmeldet, wird Admin der Instanz. Andere Adressen können das erste Konto nicht anlegen."
        >
          {field('BOOTSTRAP_EMAIL', 'Deine E-Mail-Adresse', {
            type: 'email',
            placeholder: 'du@firma.de',
            autoComplete: 'email',
          })}
        </Section>
      )}

      <Section
        title="Microsoft"
        description="„Weiter mit Microsoft“ und PowerPoints aus OneDrive/SharePoint. App registrieren unter entra.microsoft.com → App-Registrierungen, Plattform „Web“."
        aside={removeButton(['MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_TENANT'])}
      >
        <RedirectUri uri={settings.redirectUris.microsoft} />
        <div className="grid gap-3 sm:grid-cols-2">
          {field('MS_CLIENT_ID', 'Anwendungs-ID (Client-ID)')}
          {field('MS_CLIENT_SECRET', 'Geheimer Clientschlüssel', { secret: true })}
          {field('MS_TENANT', 'Mandant', {
            placeholder: 'common',
            hint: 'common = alle Microsoft-Konten; sonst die Verzeichnis-ID der Firma.',
          })}
        </div>
      </Section>

      <Section
        title="Google"
        description="„Weiter mit Google“. OAuth-Client (Webanwendung) anlegen unter console.cloud.google.com → Google Auth Platform → Clients."
        aside={removeButton(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'])}
      >
        <RedirectUri uri={settings.redirectUris.google} />
        <div className="grid gap-3 sm:grid-cols-2">
          {field('GOOGLE_CLIENT_ID', 'Client-ID')}
          {field('GOOGLE_CLIENT_SECRET', 'Clientschlüssel', { secret: true })}
        </div>
      </Section>

      <Section
        title="Firmen-Login (SSO)"
        description="Jeder OpenID-Connect-Anbieter: Authentik, Keycloak, Okta, Zitadel, …"
        aside={removeButton(['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_LABEL'])}
      >
        <RedirectUri uri={settings.redirectUris.oidc} />
        <div className="grid gap-3 sm:grid-cols-2">
          {field('OIDC_ISSUER', 'Issuer-URL', {
            placeholder: 'https://auth.firma.de/application/o/slider/',
            className: 'sm:col-span-2',
          })}
          {field('OIDC_CLIENT_ID', 'Client-ID')}
          {field('OIDC_CLIENT_SECRET', 'Clientschlüssel', { secret: true })}
          {field('OIDC_LABEL', 'Text auf dem Button', { placeholder: 'Weiter mit SSO' })}
        </div>
      </Section>

      <Section
        title="Registrierung"
        description="Wer ohne Einladung ein Konto anlegen darf. Eingeladene Personen dürfen immer."
      >
        {fields.SIGNUP.source === 'env' ? (
          <EnvHint name="SIGNUP" value={fields.SIGNUP.value} />
        ) : (
          <label className="flex flex-col gap-1.5 text-xs text-fg-subtle">
            Neue Konten
            <Select<SignupMode>
              value={signup}
              onChange={set('SIGNUP')}
              options={[
                { value: 'open', label: 'Alle, die sich anmelden können' },
                { value: 'domains', label: 'Nur bestimmte E-Mail-Domains' },
                { value: 'invite', label: 'Nur mit Einladung' },
              ]}
            />
          </label>
        )}
        {signup === 'domains' &&
          field('SIGNUP_DOMAINS', 'Domains', { placeholder: 'firma.de, firma.com' })}
      </Section>

      <Section
        title="E-Mail"
        description="Optional: Einladungen direkt per Mail verschicken. Ohne gibt es den Link zum Weitergeben. Jeder SMTP-Zugang passt, z. B. Brevo oder das Postfach beim Domain-Hoster."
        aside={removeButton(['SMTP_URL', 'MAIL_FROM'])}
      >
        {smtpFromEnv ? (
          <EnvHint name="SMTP_URL" />
        ) : (
          <>
            {fields.SMTP_URL.set && !removed.has('SMTP_URL') && (
              <p className="text-body text-fg-subtle">
                Ein Mailserver ist gespeichert. Zum Ändern alle Felder neu ausfüllen.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
              <TextField
                label="SMTP-Server"
                placeholder="smtp-relay.brevo.com"
                value={smtp.host}
                onChange={(e) => setSmtp({ ...smtp, host: e.target.value })}
              />
              <TextField
                label="Port"
                inputMode="numeric"
                value={smtp.port}
                hint={smtp.port === '465' ? 'TLS' : 'STARTTLS'}
                onChange={(e) => setSmtp({ ...smtp, port: e.target.value })}
              />
              <TextField
                label="Benutzer"
                autoComplete="off"
                value={smtp.user}
                onChange={(e) => setSmtp({ ...smtp, user: e.target.value })}
              />
              <TextField
                label="Passwort"
                type="password"
                autoComplete="new-password"
                value={smtp.password}
                onChange={(e) => setSmtp({ ...smtp, password: e.target.value })}
                className="sm:col-span-1"
              />
            </div>
          </>
        )}
        {field('MAIL_FROM', 'Absender', { placeholder: 'Slider <slider@firma.de>' })}
      </Section>

      {save.isError && <Notice tone="danger">{save.error.message}</Notice>}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {phase === 'restarting' && (
          <span className="flex items-center gap-2 text-body text-fg-subtle">
            <Spinner size="md" /> Slider startet neu …
          </span>
        )}
        <Button type="submit" loading={save.isPending || phase === 'restarting'}>
          Speichern
        </Button>
      </div>
    </form>
  );
}

interface FieldProps {
  secret?: boolean;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  hint?: string;
  className?: string;
}

function SetupTextField({
  label,
  field,
  value,
  onChange,
  removed,
  secret,
  hint,
  ...props
}: FieldProps & {
  label: string;
  field: SetupField;
  value: string;
  onChange: (value: string) => void;
  removed: boolean;
}) {
  if (field.source === 'env') {
    return (
      <TextField
        label={label}
        value={secret ? '••••••••' : (field.value ?? '')}
        readOnly
        hint="Per Umgebungsvariable gesetzt"
        className={props.className}
      />
    );
  }
  return (
    <TextField
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      type={secret ? 'password' : props.type}
      autoComplete={secret ? 'new-password' : (props.autoComplete ?? 'off')}
      placeholder={
        secret && field.set && !removed
          ? 'Gespeichert – leer lassen zum Behalten'
          : props.placeholder
      }
      hint={removed ? 'Wird beim Speichern entfernt' : hint}
      className={props.className}
    />
  );
}

function RedirectUri({ uri }: { uri: string }) {
  const { state, copy } = useCopyToClipboard();
  return (
    <TextField
      label="Weiterleitungs-URI (genau so eintragen)"
      value={uri}
      readOnly
      onFocus={(event) => event.currentTarget.select()}
      trailing={
        <TextLink
          size="xs"
          icon={state === 'copied' ? 'check' : 'contentCopy'}
          onClick={() => void copy(uri)}
        >
          {state === 'copied' ? 'Kopiert' : 'Kopieren'}
        </TextLink>
      }
    />
  );
}

function Saved({ status, manual }: { status: SetupStatus; manual: boolean }) {
  if (manual) {
    return (
      <Notice tone="warning">
        Gespeichert. Starte den Slider-Server neu, damit die Änderungen gelten.
      </Notice>
    );
  }
  return (
    <Notice tone="success">
      Gespeichert und übernommen.{' '}
      {!status.hasAccount && status.loginConfigured && (
        <>
          Melde dich jetzt mit deiner Admin-Adresse an:{' '}
          <TextLink href={routes.login()} variant="inline" weight="medium">
            Zur Anmeldung
          </TextLink>
        </>
      )}
    </Notice>
  );
}

function EnvHint({ name, value }: { name: string; value?: string | null }) {
  return (
    <p className="text-body text-fg-subtle">
      Per Umgebungsvariable gesetzt: <Code>{name}</Code>
      {value ? ` = ${value}` : ''}
    </p>
  );
}

const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded-badge bg-surface-2 px-1 py-0.5 text-xs text-fg-muted">{children}</code>
);

/** After saving the server restarts: wait until it answers again (at most ~30 s). */
async function waitForRestart(): Promise<void> {
  await sleep(1000);
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const res = await fetch(`${API_PREFIX}/health`, { cache: 'no-store' });
      if (res.ok) return;
    } catch {
      // Still down.
    }
    await sleep(1000);
  }
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
