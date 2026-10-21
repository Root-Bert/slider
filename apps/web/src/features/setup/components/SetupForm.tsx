import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type ReactNode } from 'react';
import {
  API_PREFIX,
  healthSchema,
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
import { LegalTextsSection } from '@/features/legal';
import {
  Badge,
  Button,
  Icon,
  Notice,
  Section,
  Select,
  Spinner,
  TextField,
  TextLink,
  useCopyToClipboard,
  type ShowToast,
} from '@/ui';
import {
  collectChanges,
  initialDraft,
  SETUP_PATH,
  smtpParts,
  smtpUrl,
  sourceOf,
  type SetupDraft,
  type SmtpParts,
} from '../lib/setup-form';
import { Code } from './Code';

type Settings = NonNullable<SetupStatus['settings']>;

const MICROSOFT_KEYS: SetupKey[] = ['MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_TENANT'];
const GOOGLE_KEYS: SetupKey[] = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
const OIDC_KEYS: SetupKey[] = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_LABEL'];
const MAIL_KEYS: SetupKey[] = ['SMTP_URL', 'MAIL_FROM'];
const NEXTCLOUD_KEYS: SetupKey[] = ['NEXTCLOUD_URL'];
const NEXTCLOUD_LOGIN_KEYS: SetupKey[] = ['NEXTCLOUD_CLIENT_ID', 'NEXTCLOUD_CLIENT_SECRET'];

/**
 * The settings in groups – login, access, mail, privacy, legal texts, server. Every card says
 * whether it is set up and where from; values from the environment are marked `.env`, locked, and
 * only change there. Imprint and privacy policy live in the database and save on their own.
 */
export function SetupForm({
  status,
  settings,
  headers,
  onNotify,
}: {
  status: SetupStatus;
  settings: Settings;
  headers: Record<string, string>;
  onNotify: ShowToast;
}) {
  const queryClient = useQueryClient();
  const { fields } = settings;
  const [draft, setDraft] = useState<SetupDraft>(() => initialDraft(fields));
  // Filled with the saved server, port and user; the password stays empty ("keep").
  const [smtp, setSmtp] = useState<SmtpParts>(() => smtpParts(fields.SMTP_URL.value));
  const [removed, setRemoved] = useState<ReadonlySet<SetupKey>>(new Set());
  // `unreachable`: saved, but the restarted server didn't answer in time (or `/setup` didn't load).
  const [phase, setPhase] = useState<'edit' | 'restarting' | 'saved' | 'unreachable'>('edit');

  const set = (key: SetupKey) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const setSmtpPart = (part: keyof SmtpParts) => (value: string) =>
    setSmtp((current) => ({ ...current, [part]: value }));
  const remove = (keys: SetupKey[]) => setRemoved((r) => new Set([...r, ...keys]));
  const undoRemove = (keys: SetupKey[]) =>
    setRemoved((r) => new Set([...r].filter((key) => !keys.includes(key))));

  // The server process that took the save: the restarted one has another boot id.
  const bootBefore = useRef<string | null>(null);

  const save = useMutation({
    mutationFn: async (values: SaveSetupInput['values']) => {
      bootBefore.current =
        settings.restart === 'automatic' ? ((await health())?.bootId ?? null) : null;
      return apiRequest<SaveSetupResult>('/setup', { method: 'PUT', body: { values }, headers });
    },
    onSuccess: async (result) => {
      if (result.restart === 'manual') {
        setPhase('saved');
        return;
      }
      await reload({ bootBefore: bootBefore.current });
    },
  });

  /**
   * After the restart: wait for the server, then load what it now has. `justSaved`: the old
   * server may still be shutting down (see `waitForRestart`).
   */
  const reload = async (justSaved?: { bootBefore: string | null }) => {
    setPhase('restarting');
    if (!(await waitForRestart(justSaved))) {
      setPhase('unreachable');
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['setup'] });
    await queryClient.invalidateQueries({ queryKey: workspaceKeys.providers });
    // "Übernommen" only once the restarted server answered `/setup` too.
    if (queryClient.getQueryState(['setup'])?.status === 'error') {
      setPhase('unreachable');
      return;
    }
    // The form stays mounted across the refetch: start over from what the server now has, or
    // removed values would still show (and be sent again with the next save).
    const fresh = queryClient.getQueryData<SetupStatus>(['setup'])?.settings;
    if (fresh) {
      setDraft(initialDraft(fresh.fields));
      setSmtp(smtpParts(fresh.fields.SMTP_URL.value));
    }
    setRemoved(new Set());
    setPhase('saved');
  };

  const smtpFromEnv = fields.SMTP_URL.source === 'env';
  const smtpRemoved = removed.has('SMTP_URL');
  const savedSmtp = fields.SMTP_URL.source === 'stored' ? smtpParts(fields.SMTP_URL.value) : null;
  // A saved password belongs to its user: another user needs its own.
  const smtpNeedsPassword = savedSmtp !== null && smtp.user.trim() !== savedSmtp.user;

  const submit = () => {
    setPhase('edit');
    const values = collectChanges(fields, draft, removed);
    if (!smtpFromEnv && !smtpRemoved) {
      // Server, port and user come back as saved: send the mail server only when it changed. An
      // empty password keeps the saved one (the API puts it back for the same user).
      const next = smtpUrl(smtp);
      if (next !== (fields.SMTP_URL.value ?? '')) values.SMTP_URL = next || null;
    }
    save.mutate(values);
  };

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
  // Where a card stands, and "Entfernen" for what was saved here. A removed card is locked (its
  // fields would be dropped on save) until "Rückgängig".
  const aside = (keys: SetupKey[]) => {
    const source = sourceOf(fields, keys);
    const isRemoved = keys.some((key) => removed.has(key));
    const canRemove = keys.some((key) => fields[key].source === 'stored' && !removed.has(key));
    return (
      <div className="flex shrink-0 items-center gap-2">
        {isRemoved ? (
          <Badge tone="warning">Wird entfernt</Badge>
        ) : source === 'env' ? (
          <EnvBadge />
        ) : source === 'stored' ? (
          <Badge tone="success">Eingerichtet</Badge>
        ) : (
          <Badge tone="neutral">Nicht eingerichtet</Badge>
        )}
        {canRemove ? (
          <Button variant="ghost" size="sm" icon="delete" onClick={() => remove(keys)}>
            Entfernen
          </Button>
        ) : isRemoved ? (
          <Button variant="ghost" size="sm" icon="undo" onClick={() => undoRemove(keys)}>
            Rückgängig
          </Button>
        ) : null}
      </div>
    );
  };

  const signup = (draft.SIGNUP || 'open') as SignupMode;
  // On unless switched off – the server defaults to on, too.
  const deleteUnused = ['false', '0'].includes(draft.DELETE_UNUSED) ? 'false' : 'true';
  const anyFromEnv = Object.values(fields).some((f) => f.source === 'env');

  return (
    <form
      className="flex flex-col gap-10"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {anyFromEnv && (
        <p className="text-body text-fg-subtle">
          Mit <EnvBadge /> markierte Felder sind auf dem Server festgelegt. Ändern geht nur dort,
          danach Slider neu starten.
        </p>
      )}

      {!status.claimed && status.loginConfigured && (
        <Notice tone="info" title="Noch kein Admin">
          Anmelden macht niemanden zum Admin. Melde dich an und gib danach hier den Setup-Token noch
          einmal ein – damit wirst du Admin dieser Instanz.{' '}
          <TextLink href={routes.login(SETUP_PATH)} variant="inline" weight="medium">
            Zur Anmeldung
          </TextLink>
        </Notice>
      )}

      <Group
        title="Anmeldung"
        description="Wie man sich bei Slider anmeldet. Mindestens ein Weg muss eingerichtet sein; Passkeys gehen zusätzlich immer."
      >
        <Section
          title="Microsoft"
          description="„Weiter mit Microsoft“ und PowerPoints aus OneDrive/SharePoint. App registrieren unter entra.microsoft.com → App-Registrierungen, Plattform „Web“."
          aside={aside(MICROSOFT_KEYS)}
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
          description="„Weiter mit Google“ und Präsentationen aus Google Drive. OAuth-Client (Webanwendung) anlegen unter console.cloud.google.com → Google Auth Platform → Clients; für Drive im Projekt auch die Google Drive API und Google Picker API aktivieren."
          aside={aside(GOOGLE_KEYS)}
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
          aside={aside(OIDC_KEYS)}
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
          title="Nextcloud"
          description="„Weiter mit Nextcloud“ für die Nextcloud eurer Firma (unter Dateien eingetragen). In Nextcloud unter Verwaltung → Sicherheit → OAuth-2.0-Clients einen Client anlegen."
          aside={aside(NEXTCLOUD_LOGIN_KEYS)}
        >
          <RedirectUri uri={settings.redirectUris.nextcloud} />
          <div className="grid gap-3 sm:grid-cols-2">
            {field('NEXTCLOUD_CLIENT_ID', 'Client-Kennung')}
            {field('NEXTCLOUD_CLIENT_SECRET', 'Geheimnis', { secret: true })}
          </div>
        </Section>
      </Group>

      <Group title="Zugang" description="Wer ein Konto anlegen darf.">
        <Section
          title="Registrierung"
          description="Gilt für alle ohne Einladung. Eingeladene Personen dürfen immer."
          aside={fields.SIGNUP.source === 'env' ? <EnvBadge /> : undefined}
        >
          {fields.SIGNUP.source === 'env' ? (
            <LockedField label="Neue Konten" value={SIGNUP_LABELS[signup] ?? signup} />
          ) : (
            <label className="flex flex-col gap-1.5 text-xs text-fg-subtle">
              Neue Konten
              <Select<SignupMode>
                value={signup}
                onChange={set('SIGNUP')}
                options={SIGNUP_MODES.map((value) => ({ value, label: SIGNUP_LABELS[value] }))}
              />
            </label>
          )}
          {signup === 'domains' &&
            field('SIGNUP_DOMAINS', 'Domains', { placeholder: 'firma.de, firma.com' })}
          <p className="text-xs text-fg-subtle">{SIGNUP_HINTS[signup]}</p>
        </Section>
      </Group>

      <Group
        title="Dateien"
        description="Optional. Woher Slider Präsentationen außer OneDrive/SharePoint holt."
      >
        <Section
          title="Nextcloud"
          description="Jede Nextcloud funktioniert ohne Einrichtung – man gibt beim Verbinden ihre Adresse ein. Trag hier die Nextcloud eurer Firma ein, dann entfällt das, und sie darf auch im internen Netz liegen."
          aside={aside(NEXTCLOUD_KEYS)}
        >
          {field('NEXTCLOUD_URL', 'Adresse der Firmen-Nextcloud', {
            placeholder: 'https://cloud.firma.de',
          })}
        </Section>
      </Group>

      <Group
        title="E-Mail"
        description="Optional. Ohne Mailserver gibt es für Einladungen einen Link zum Weitergeben."
      >
        <Section
          title="Mailserver"
          description="Verschickt Einladungen direkt per Mail. Jeder SMTP-Zugang passt, z. B. Brevo oder das Postfach beim Domain-Hoster."
          aside={aside(MAIL_KEYS)}
        >
          {smtpFromEnv ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
              <LockedField label="SMTP-Server" value={smtp.host || '–'} />
              <LockedField label="Port" value={smtp.port} />
              <LockedField label="Benutzer" value={smtp.user || '–'} />
              <LockedField label="Passwort" value="••••••••" />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
              <TextField
                label="SMTP-Server"
                disabled={smtpRemoved}
                placeholder="smtp-relay.brevo.com"
                value={smtp.host}
                onChange={(e) => setSmtpPart('host')(e.target.value)}
              />
              <TextField
                label="Port"
                disabled={smtpRemoved}
                inputMode="numeric"
                value={smtp.port}
                hint={smtp.port === '465' ? 'TLS' : 'STARTTLS'}
                onChange={(e) => setSmtpPart('port')(e.target.value)}
              />
              <TextField
                label="Benutzer"
                disabled={smtpRemoved}
                autoComplete="off"
                value={smtp.user}
                onChange={(e) => setSmtpPart('user')(e.target.value)}
              />
              <TextField
                label="Passwort"
                disabled={smtpRemoved}
                type="password"
                autoComplete="new-password"
                placeholder={
                  savedSmtp && !smtpNeedsPassword ? 'Gespeichert – leer lassen zum Behalten' : ''
                }
                hint={
                  smtpRemoved
                    ? 'Wird beim Speichern entfernt'
                    : smtpNeedsPassword && !smtp.password
                      ? 'Neuer Benutzer – Passwort eingeben'
                      : undefined
                }
                value={smtp.password}
                onChange={(e) => setSmtpPart('password')(e.target.value)}
              />
            </div>
          )}
          {field('MAIL_FROM', 'Absender', { placeholder: 'Slider <slider@firma.de>' })}
        </Section>
      </Group>

      <Group title="Datenschutz" description="Wie lange Slider ungenutzte Daten aufhebt.">
        <Section
          title="Ungenutzte Daten löschen"
          description="Konten und Präsentationen, die 18 Monate niemand genutzt hat, werden gelöscht. Die Frist zählt frühestens ab dem Einschalten, vorher wird nichts gelöscht."
          aside={fields.DELETE_UNUSED.source === 'env' ? <EnvBadge /> : undefined}
        >
          {fields.DELETE_UNUSED.source === 'env' ? (
            <LockedField label="Automatisch löschen" value={DELETE_UNUSED_LABELS[deleteUnused]} />
          ) : (
            <label className="flex flex-col gap-1.5 text-xs text-fg-subtle">
              Automatisch löschen
              <Select<'true' | 'false'>
                value={deleteUnused}
                onChange={set('DELETE_UNUSED')}
                options={(['false', 'true'] as const).map((value) => ({
                  value,
                  label: DELETE_UNUSED_LABELS[value],
                }))}
              />
            </label>
          )}
          {deleteUnused === 'true' && (
            <p className="text-xs text-fg-subtle">
              Erinnerungen vor dem Löschen kommen nur per Mail, also nur mit eingerichtetem
              Mailserver. Ohne wird trotzdem gelöscht, nur unangekündigt.
            </p>
          )}
        </Section>
      </Group>

      <Group title="Rechtliches" description="Werden für sich gespeichert, ohne Neustart.">
        {/* Authorized and claimed: the signed-in instance admin, whom `PUT /legal` requires. */}
        {status.claimed ? (
          <LegalTextsSection onNotify={onNotify} />
        ) : (
          <Section
            title="Impressum & Datenschutz"
            description="Pflegst du hier, sobald du als Admin dieser Instanz angemeldet bist."
          >
            {null}
          </Section>
        )}
      </Group>

      <Group
        title="Server"
        description={
          <>
            Steht nur in der <Code>.env</Code>: Adresse, Datenbank, Proxy und Limits. Dort ändern,
            danach Slider neu starten.
          </>
        }
      >
        <Section
          title="Adresse"
          description="Alle Links und Weiterleitungen zeigen dorthin."
          aside={<EnvBadge />}
        >
          <LockedField label="Öffentliche Adresse (SLIDER_URL)" value={settings.url} />
        </Section>
      </Group>

      {save.isError && (
        <Notice tone="danger" role="alert">
          {save.error.message}
        </Notice>
      )}
      {/* The result sits next to the button that was pressed, at the bottom of a long form. */}
      {phase === 'saved' && <Saved status={status} manual={settings.restart === 'manual'} />}
      {phase === 'unreachable' && (
        <Notice
          tone="warning"
          role="alert"
          title="Slider antwortet noch nicht"
          footer={
            <Button size="sm" variant="secondary" icon="refresh" onClick={() => void reload()}>
              Erneut prüfen
            </Button>
          }
        >
          Die Änderungen sind gespeichert, aber der Server ist nach dem Neustart nicht erreichbar.
          Prüfe das Server-Log, zum Beispiel mit <Code>docker logs slider</Code>.
        </Notice>
      )}
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

const DELETE_UNUSED_LABELS = {
  false: 'Aus',
  true: 'Nach 18 Monaten ohne Nutzung',
} as const;

const SIGNUP_MODES: SignupMode[] = ['open', 'company', 'domains', 'invite'];
const SIGNUP_LABELS: Record<SignupMode, string> = {
  open: 'Alle, die sich anmelden können',
  company: 'Mit Einladung oder per Firmen-Domain',
  domains: 'Nur bestimmte E-Mail-Domains',
  invite: 'Nur mit Einladung',
};

/** What each mode means for joining organisations by company domain (BER-148). */
const SIGNUP_HINTS: Record<SignupMode, string> = {
  open: 'Organisationen können sich für ihre Firmen-Domain öffnen: Kolleg:innen finden sie dann und treten ohne Einladung bei.',
  company:
    'Ein Konto bekommt, wer eingeladen ist oder eine Adresse einer Domain hat, für die sich eine Organisation geöffnet hat.',
  domains:
    'Nur Adressen dieser Domains bekommen ein Konto. Organisationen können sich zusätzlich für ihre Firmen-Domain öffnen.',
  invite:
    'Ausschließlich Einladungen – Organisationen lassen sich nicht per Domain finden oder beitreten.',
};

/** A heading over cards that belong together. */
function Group({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 px-1">
        <p id={headingId} className="text-sm font-semibold text-fg">
          {title}
        </p>
        <p className="text-body text-fg-subtle">{description}</p>
      </div>
      {children}
    </div>
  );
}

function EnvBadge() {
  return (
    <Badge tone="info" title="Steht in der .env des Servers – nur dort änderbar">
      <Icon name="lock" size={12} />
      .env
    </Badge>
  );
}

/** A value from the environment: shown, not editable here. */
function LockedField({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <TextField
      label={label}
      value={value}
      readOnly
      trailing={<Icon name="lock" size={16} className="shrink-0 text-fg-subtle" />}
      hint="Nur in der .env änderbar"
      className={className}
    />
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
      <LockedField
        label={label}
        value={secret ? '••••••••' : (field.value ?? '')}
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
      disabled={removed}
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
      <Notice tone="warning" role="status">
        Gespeichert. Starte den Slider-Server neu, damit die Änderungen gelten.
      </Notice>
    );
  }
  return (
    <Notice tone="success" role="status">
      Gespeichert und übernommen.{' '}
      {!status.claimed && status.loginConfigured && (
        <>
          Melde dich jetzt an und gib danach den Setup-Token noch einmal ein, um Admin zu werden:{' '}
          <TextLink href={routes.login(SETUP_PATH)} variant="inline" weight="medium">
            Zur Anmeldung
          </TextLink>
        </>
      )}
    </Notice>
  );
}

/**
 * After saving the server restarts: wait until it answers again (at most ~30 s). `false` when it
 * didn't – the page must not claim the change took effect. Right after saving, the old server
 * may still answer for a moment before it shuts down: only the restarted one counts, known by
 * another boot id than `justSaved.bootBefore`. A server without boot ids (older versions):
 * an answer after it was seen down – or, should the restart have been too quick to see, one once
 * the old server is surely gone (it exits at most ~9 s after the save).
 */
async function waitForRestart(justSaved?: { bootBefore: string | null }): Promise<boolean> {
  const started = Date.now();
  let wentDown = !justSaved;
  while (Date.now() - started < RESTART_TIMEOUT_MS) {
    await sleep(RESTART_POLL_MS);
    const answer = await health();
    if (!answer) wentDown = true;
    else if (justSaved?.bootBefore && answer.bootId) {
      if (answer.bootId !== justSaved.bootBefore) return true;
    } else if (wentDown || Date.now() - started >= OLD_SERVER_GONE_MS) return true;
  }
  return false;
}

/** `GET /health`: `null` while the server doesn't answer (or not well). */
async function health(): Promise<{ bootId?: string } | null> {
  try {
    const res = await fetch(`${API_PREFIX}/health`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = healthSchema.safeParse(await res.json().catch(() => null));
    return body.success ? body.data : {};
  } catch {
    // Down.
    return null;
  }
}

const RESTART_POLL_MS = 500;
const RESTART_TIMEOUT_MS = 30_000;
/** The old server's shutdown: 300 ms until it starts, then at most 5 s + 3 s to exit. */
const OLD_SERVER_GONE_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
