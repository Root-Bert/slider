import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  MAIL_CHECK_STEPS,
  MAIL_OAUTH_LABELS,
  MAIL_OAUTH_PROVIDERS,
  MAX_MAILBOX_LABEL,
  mailboxDefaultLabel,
  mailboxLabels,
  mailProviderOf,
  mailServersToCheck,
  type MailAccount,
  type MailAccountInput,
  type MailCheckFailure,
  type MailCheckStep,
  type MailOAuthProvider,
  type MailOAuthStart,
  type MailPrepared,
} from '@slider/shared';
import {
  mailOAuthResult,
  startMailOAuth,
  useAddMailAccount,
  useAuthProviders,
  useDeleteMailAccount,
  useMailAccounts,
  useMailPrepared,
  useSyncMailAccount,
  useUpdateMailAccount,
} from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { formatRelativeTime } from '@/lib/format';
import { useOnPageRestore } from '@/lib/page-restore';
import { canCreateDecks } from '@/features/workspaces';
import {
  Badge,
  Button,
  ButtonLink,
  cn,
  ConfirmDialog,
  Divider,
  EmptyState,
  GoogleMark,
  Icon,
  ListRow,
  ContextMenu,
  Menu,
  type MenuAction,
  MicrosoftMark,
  Notice,
  RowList,
  TextField,
  Toggle,
} from '@/ui';
import { useSender } from '../../hooks/useSender';
import { ADD_MAILBOX_HASH } from '../../hooks/useMailView';
import { MailboxHelper } from './MailboxHelper';
import { MailboxNameInput } from './MailboxNameInput';

interface FormError {
  text: string;
  check?: MailCheckFailure;
}

/** Back from the provider with a refusal: the form opens again with it, as it was filled. */
interface Returned {
  accountId: string | null;
  name: string;
  label: string;
  aiReads: boolean;
  error: FormError;
}

interface Draft {
  address: string;
  password: string;
  name: string;
  /** Its own name; empty: its default. */
  label: string;
  username: string;
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  aiReads: boolean;
}

const EMPTY: Draft = {
  address: '',
  password: '',
  name: '',
  label: '',
  username: '',
  imapHost: '',
  imapPort: '993',
  imapSecure: true,
  smtpHost: '',
  smtpPort: '465',
  smtpSecure: true,
  aiReads: true,
};

const draftOf = (account: MailAccount): Draft => ({
  address: account.address,
  password: '',
  name: account.name === account.address ? '' : account.name,
  label: account.label ?? '',
  username: account.username,
  imapHost: account.imapHost,
  imapPort: String(account.imapPort),
  imapSecure: account.imapSecure,
  smtpHost: account.smtpHost,
  smtpPort: String(account.smtpPort),
  smtpSecure: account.smtpSecure,
  aiReads: account.aiReads,
});

interface CheckRow {
  label: string;
  steps: { step: MailCheckStep; ok: string; failed: string }[];
}

/** The two servers a mailbox needs, and what is checked at each – in the order it is checked. */
const SERVER_ROWS: CheckRow[] = (
  [
    ['imap', 'Posteingang (IMAP)'],
    ['smtp', 'Postausgang (SMTP)'],
  ] as const
).map(([side, label]) => ({
  label,
  steps: (['erreicht', 'verschlüsselt', 'angemeldet'] as const).map((part, at) => ({
    step: `${side}-${(['server', 'tls', 'login'] as const)[at]}` as MailCheckStep,
    ok: part,
    failed: `nicht ${part}`,
  })),
}));

/** Signed in through the provider: first its own steps – access allowed there, the right account. */
const providerRow = (via: MailOAuthProvider): CheckRow => ({
  label: MAIL_OAUTH_LABELS[via],
  steps: [
    { step: 'oauth-consent', ok: 'Zugriff erlaubt', failed: 'Zugriff nicht erlaubt' },
    { step: 'oauth-account', ok: 'Konto passt', failed: 'Konto passt nicht' },
  ],
});

/**
 * Where checking a mailbox stopped: per server whether it was reached, encrypted and let in –
 * ticked up to the step that failed, not tried after it – and what the server said. Signed in
 * through Microsoft or Google, their steps come first.
 */
function CheckSteps({ check }: { check: MailCheckFailure }) {
  const failed = MAIL_CHECK_STEPS.indexOf(check.step);
  const rows = check.via ? [providerRow(check.via), ...SERVER_ROWS] : SERVER_ROWS;
  const says =
    check.via && check.step.startsWith('oauth') ? MAIL_OAUTH_LABELS[check.via] : 'Server';
  return (
    <div className="flex flex-col gap-1.5 pl-6.5 text-xs">
      {rows.map(({ label, steps }) => (
        <div key={label} className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="w-36 shrink-0 text-fg-muted max-sm:w-full">{label}</span>
          {steps.map(({ step, ok, failed: failedLabel }) => {
            const at = MAIL_CHECK_STEPS.indexOf(step);
            const state = at < failed ? 'ok' : at === failed ? 'failed' : 'open';
            return (
              <span
                key={step}
                className={cn(
                  'flex items-center gap-1',
                  state === 'ok' && 'text-fg-muted',
                  state === 'failed' && 'font-medium text-danger',
                  state === 'open' && 'text-fg-faint',
                )}
              >
                <Icon
                  name={
                    state === 'ok'
                      ? 'checkCircle'
                      : state === 'failed'
                        ? 'error'
                        : 'radioButtonUnchecked'
                  }
                  size={14}
                  className={state === 'ok' ? 'text-success' : undefined}
                />
                {state === 'failed' ? failedLabel : ok}
              </span>
            );
          })}
        </div>
      ))}
      {check.serverSays && (
        <p className="text-fg-muted">
          {says} sagt: <q className="font-mono text-fg">{check.serverSays}</q>
        </p>
      )}
    </div>
  );
}

/** The providers a mailbox can sign in through here: those the server's login has set up. */
function useMailOAuthProviders(): MailOAuthProvider[] {
  const providers = useAuthProviders().data?.providers ?? [];
  return MAIL_OAUTH_PROVIDERS.filter((id) => providers.some((provider) => provider.id === id));
}

/** To the provider's sign-in page, in this tab; it comes back to this page (its agent open). */
function useStartMailOAuth() {
  const ui = useSender();
  const { pathname, search } = useLocation();
  return async (input: Omit<MailOAuthStart, 'returnTo'>) => {
    const kept = new URLSearchParams(search);
    kept.delete('anmeldung');
    const query = kept.toString();
    const returnTo = query ? `${pathname}?${query}` : pathname;
    const { url } = await startMailOAuth(ui.workspace.id, { ...input, returnTo });
    window.location.assign(url);
  };
}

/** „Mit Microsoft anmelden“ / „Mit Google anmelden“ – as the login page's buttons. */
function OAuthButton({
  input,
  onError,
  label,
  primary = false,
  inline = false,
}: {
  input: Omit<MailOAuthStart, 'returnTo'>;
  onError: (error: FormError) => void;
  /** Else „Mit <Anbieter> anmelden“. */
  label?: string;
  primary?: boolean;
  /** Beside the form's own buttons, as big as they are (not the login's size). */
  inline?: boolean;
}) {
  const start = useStartMailOAuth();
  const [leaving, setLeaving] = useState(false);
  // Back from the provider with the browser's Back button: clickable again.
  useOnPageRestore(() => setLeaving(false));
  return (
    <Button
      size={inline ? undefined : 'lg'}
      variant={primary ? 'primary' : 'secondary'}
      data-sign-in={primary || undefined}
      loading={leaving}
      className={cn('gap-2', !inline && 'gap-2.5 max-sm:flex-1')}
      onClick={() => {
        setLeaving(true);
        start(input).catch((error: Error) => {
          setLeaving(false);
          onError({ text: error.message });
        });
      }}
    >
      {!leaving &&
        (input.provider === 'microsoft' ? <MicrosoftMark size={16} /> : <GoogleMark size={16} />)}
      {label ?? `Mit ${MAIL_OAUTH_LABELS[input.provider]} anmelden`}
    </Button>
  );
}

/**
 * A mailbox's form, in the page: the address and the password – the servers of the big providers
 * fill in by themselves; any other mail server is typed in („Server selbst eintragen“). Kept only
 * once both servers let it in – the server says why not.
 */
function AccountForm({
  account,
  onDone,
  canCancel = true,
  returned,
  focus = false,
  focusKey,
  titled = true,
  proposal,
}: {
  /** Changing this one; else a new one. */
  account?: MailAccount;
  /** Kept (`added`: the new one) or given up. */
  onDone: (added?: MailAccount) => void;
  /** Without any mailbox the form is all there is: nothing to go back to. */
  canCancel?: boolean;
  /** Back from Microsoft or Google without the mailbox: why, and what was filled in. */
  returned?: Returned;
  /** Its first choice focused (the page „Neues Postfach“). */
  focus?: boolean;
  /** Asked for again: focused again. */
  focusKey?: string;
  /** Its own heading – not where the page's title says it already. */
  titled?: boolean;
  /** What an agent got ready (`prepare_mailbox`): into the fields, each one once. */
  proposal?: MailPrepared | null;
}) {
  const ui = useSender();
  const add = useAddMailAccount(ui.workspace.id);
  const update = useUpdateMailAccount(ui.workspace.id);
  const oauth = useMailOAuthProviders();
  const formRef = useRef<HTMLFormElement>(null);
  // Once the sign-in buttons are known (they come with the login's providers): the first of them.
  useEffect(() => {
    const form = formRef.current;
    if (!focus || !form) return;
    form.scrollIntoView({ block: 'nearest' });
    form.querySelector<HTMLElement>('button, input')?.focus();
  }, [focus, oauth.length, focusKey]);
  const [draft, setDraft] = useState<Draft>(() =>
    account
      ? draftOf(account)
      : returned
        ? { ...EMPTY, name: returned.name, label: returned.label, aiReads: returned.aiReads }
        : EMPTY,
  );
  const [error, setError] = useState<FormError | null>(returned?.error ?? null);
  const provider = mailProviderOf(draft.address);
  const [own, setOwn] = useState(!!account && !mailProviderOf(account.address));
  // The agent's: everything but the password, which stays as typed. Servers other than a known
  // provider's are its own („Server selbst eintragen“).
  const [taken, setTaken] = useState<MailPrepared | null>(null);
  if (proposal && proposal.at !== taken?.at) {
    setTaken(proposal);
    setDraft((now) => ({
      ...now,
      address: proposal.address,
      name: proposal.name,
      label: proposal.label,
      username: proposal.username === proposal.address ? '' : proposal.username,
      imapHost: proposal.imapHost,
      imapPort: String(proposal.imapPort),
      imapSecure: proposal.imapSecure,
      smtpHost: proposal.smtpHost,
      smtpPort: String(proposal.smtpPort),
      smtpSecure: proposal.smtpSecure,
      aiReads: proposal.aiReads,
    }));
    const preset = mailProviderOf(proposal.address);
    setOwn(
      !!preset && (preset.imapHost !== proposal.imapHost || preset.smtpHost !== proposal.smtpHost),
    );
    setError(null);
  }
  // Then the password is what is left to type: its field (or the sign-in button) focused.
  useEffect(() => {
    if (!taken) return;
    formRef.current?.querySelector<HTMLElement>('input[type="password"], [data-sign-in]')?.focus();
  }, [taken]);
  // The big providers' servers fill in; anything else is typed (or asked for, once the address shows no preset).
  const manual =
    own || (!provider && draft.address.includes('@') && draft.address.split('@')[1]!.includes('.'));
  // Servers an agent filled in that are not of the address's domain, still as it put them:
  // looked at before the password goes there (what it read could have named someone else's).
  const foreign = taken
    ? mailServersToCheck({ ...taken, address: draft.address }).filter((host) =>
        [draft.imapHost, draft.smtpHost].some(
          (typed) => typed.trim().toLowerCase() === host.toLowerCase(),
        ),
      )
    : [];
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((now) => ({ ...now, [key]: value }));
  const pending = add.isPending || update.isPending;
  const servers = manual
    ? {
        imapHost: draft.imapHost.trim(),
        imapPort: Number(draft.imapPort) || 993,
        imapSecure: draft.imapSecure,
        smtpHost: draft.smtpHost.trim(),
        smtpPort: Number(draft.smtpPort) || 465,
        smtpSecure: draft.smtpSecure,
      }
    : {
        imapHost: provider?.imapHost ?? '',
        imapPort: 993,
        imapSecure: true,
        smtpHost: provider?.smtpHost ?? '',
        // Microsoft's SMTP takes STARTTLS on 587 only.
        smtpPort: microsoftSmtp(provider?.smtpHost) ? 587 : 465,
        smtpSecure: !microsoftSmtp(provider?.smtpHost),
      };
  // Another server: the kept password does not go there – it is typed again. As the server
  // compares: trimmed, whatever the case.
  const moves =
    !!account &&
    (['imapHost', 'imapPort', 'smtpHost', 'smtpPort'] as const).some(
      (key) => String(servers[key]).toLowerCase() !== String(account[key]).toLowerCase(),
    );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const input: MailAccountInput = {
      address: draft.address.trim(),
      name: draft.name.trim(),
      label: draft.label.trim(),
      username: (manual && draft.username.trim()) || draft.address.trim(),
      password: draft.password,
      ...servers,
      aiReads: draft.aiReads,
    };
    const done = (text: string, added?: MailAccount) => {
      ui.notify(text);
      onDone(added);
    };
    const refused = (failure: Error) =>
      setError({
        text: failure.message,
        check: failure instanceof ApiError ? failure.mailCheck : undefined,
      });
    if (account) {
      const { password, ...rest } = input;
      update.mutate(
        { id: account.id, ...rest, ...(password ? { password } : {}) },
        { onSuccess: () => done('Postfach gespeichert'), onError: refused },
      );
    } else
      add.mutate(input, {
        onSuccess: (added) => done('Postfach hinzugefügt', added),
        onError: refused,
      });
  };
  // A provider that lets no password in (Outlook): said at once, not after a try (then the
  // refusal says it, once).
  const noPassword = !own ? provider?.noPassword : undefined;
  // …and where its provider's sign-in is set up here, the way in is that button instead.
  const signInVia =
    noPassword && provider?.oauth && oauth.includes(provider.oauth) ? provider.oauth : undefined;
  // A typed address pre-fills the provider's sign-in; the mailbox gets the one it names.
  const typed = draft.address.trim();
  const oauthInput = {
    name: draft.name.trim(),
    label: draft.label.trim(),
    aiReads: draft.aiReads,
    ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed) ? { address: typed } : {}),
  };
  return (
    // In the page, as wide as it is – no card: the fields side by side where there is room.
    <form
      ref={formRef}
      onSubmit={submit}
      aria-label={account ? `${account.address} ändern` : 'Postfach hinzufügen'}
      className="@container flex w-full flex-col gap-5"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented && canCancel) {
          event.preventDefault();
          onDone();
        }
      }}
    >
      {titled && (
        <h2 className="text-base font-semibold text-fg">
          {account ? account.address : 'Postfach hinzufügen'}
        </h2>
      )}
      {/* What the agent put in: said first, above what it filled – servers not of the address's
          domain as a warning, before the password field. */}
      {foreign.length > 0 ? (
        <Notice tone="warning" variant="tinted" size="sm" title="Server prüfen">
          {`Vom Agenten eingetragen – ${foreign.join(' und ')} ${foreign.length > 1 ? 'gehören' : 'gehört'} nicht zu ${draft.address.split('@')[1]?.trim() || 'der Adresse'}. Gib dein Passwort nur ein, wenn dein Anbieter genau diese Server nennt.`}
        </Notice>
      ) : (
        taken && (
          <Notice tone="info" variant="tinted" size="sm" icon="autoAwesome">
            {taken.signIn === 'password'
              ? 'Vom Agenten eingetragen – prüf die Angaben, gib dein Passwort ein und füge das Postfach hinzu.'
              : `Vom Agenten eingetragen – melde dich mit ${MAIL_OAUTH_LABELS[taken.signIn]} an.`}
          </Notice>
        )
      )}
      {!account && oauth.length > 0 && (
        // The providers' sign-in first – the address comes from there; the password the other way.
        <>
          <div className="flex flex-wrap gap-3">
            {oauth.map((id) => (
              <OAuthButton key={id} input={{ provider: id, ...oauthInput }} onError={setError} />
            ))}
          </div>
          <Divider label="oder mit Adresse und Passwort" labelPosition="start" />
        </>
      )}
      <div className="grid items-start gap-x-6 gap-y-4 @xl:grid-cols-2 @4xl:grid-cols-3">
        <TextField
          label="E-Mail-Adresse"
          type="email"
          autoComplete="email"
          autoFocus={!account && oauth.length === 0}
          required
          value={draft.address}
          onChange={(event) => {
            set('address', event.target.value);
            // Another address, another provider: what the last one's servers said is gone.
            setError(null);
          }}
          hint={
            signInVia
              ? `${provider!.name} – Microsoft lässt hier nur „Mit ${MAIL_OAUTH_LABELS[signInVia]} anmelden“ herein, kein Passwort.`
              : provider && !own && !noPassword
                ? `${provider.name} – die Server tragen sich selbst ein.`
                : undefined
          }
        />
        {!signInVia && (
          <TextField
            label={account && !moves ? 'Passwort (nur wenn es sich ändert)' : 'Passwort'}
            type="password"
            autoComplete="current-password"
            required={!account || moves}
            value={draft.password}
            onChange={(event) => set('password', event.target.value)}
            hint={
              noPassword
                ? undefined
                : (!own && provider?.hint) || 'Wo dein Anbieter es verlangt, ein App-Passwort.'
            }
          />
        )}
        <TextField
          label="Name beim Senden"
          placeholder={ui.me.name}
          value={draft.name}
          onChange={(event) => set('name', event.target.value)}
        />
        <MailboxLabelField
          value={draft.label}
          onChange={(label) => set('label', label)}
          address={draft.address}
          signIn={account?.signIn}
        />
        {noPassword && !signInVia && error?.text !== noPassword && (
          <Notice
            tone="warning"
            variant="tinted"
            size="sm"
            title={`${provider!.name} geht hier noch nicht`}
            className="@xl:col-span-2 @4xl:col-span-3"
          >
            {noPassword}
          </Notice>
        )}
      </div>
      {provider && (
        <div className="grid items-start gap-x-6 gap-y-4 @xl:grid-cols-2 @4xl:grid-cols-3">
          <Toggle size="sm" checked={own} onChange={setOwn} label="Server selbst eintragen" />
        </div>
      )}
      {manual && (
        <div className="grid items-start gap-x-6 gap-y-4 @xl:grid-cols-2 @4xl:grid-cols-3">
          <TextField
            label="Benutzername"
            placeholder={draft.address || 'meist die Adresse'}
            value={draft.username}
            onChange={(event) => set('username', event.target.value)}
            className="@xl:col-span-2 @4xl:col-span-1"
          />
          {(
            [
              ['imap', 'Posteingang (IMAP)', 'imap.beispiel.de'],
              ['smtp', 'Postausgang (SMTP)', 'smtp.beispiel.de'],
            ] as const
          ).map(([kind, label, placeholder]) => (
            <fieldset key={kind} className="flex min-w-0 flex-col gap-2">
              <legend className="mb-2 text-sm font-medium text-fg">{label}</legend>
              <div className="flex gap-3">
                <TextField
                  label="Server"
                  placeholder={placeholder}
                  required
                  value={draft[`${kind}Host`]}
                  onChange={(event) => set(`${kind}Host`, event.target.value)}
                  className="min-w-0 flex-1"
                />
                <TextField
                  label="Port"
                  inputMode="numeric"
                  value={draft[`${kind}Port`]}
                  onChange={(event) => set(`${kind}Port`, event.target.value.replace(/\D/g, ''))}
                  className="w-24"
                />
              </div>
              <Toggle
                size="sm"
                checked={draft[`${kind}Secure`]}
                onChange={(on) => set(`${kind}Secure`, on)}
                label="Verschlüsselt (SSL/TLS)"
              />
            </fieldset>
          ))}
        </div>
      )}
      <div className="grid items-start gap-x-6 gap-y-4 @xl:grid-cols-2 @4xl:grid-cols-3">
        <AiReads on={draft.aiReads} onChange={(on) => set('aiReads', on)} />
      </div>
      {error && (
        <Notice
          tone="danger"
          variant="tinted"
          size="sm"
          role="alert"
          footer={error.check && <CheckSteps check={error.check} />}
        >
          {error.text}
        </Notice>
      )}
      <div className="flex justify-end gap-2">
        {canCancel && (
          <Button variant="ghost" onClick={() => onDone()}>
            Abbrechen
          </Button>
        )}
        {signInVia ? (
          <OAuthButton
            primary
            inline
            input={{ provider: signInVia, ...oauthInput }}
            onError={setError}
          />
        ) : (
          <Button type="submit" loading={pending}>
            {account ? 'Speichern' : 'Hinzufügen'}
          </Button>
        )}
      </div>
    </form>
  );
}

const microsoftSmtp = (host: string | undefined) =>
  host === 'smtp.office365.com' || host === 'smtp-mail.outlook.com';

/**
 * The mailbox's own name – as it shows on the mail page; empty, it is called by its default
 * (Google, Microsoft, the provider or the domain), which stands as the hint.
 */
function MailboxLabelField({
  value,
  onChange,
  address,
  signIn,
}: {
  value: string;
  onChange: (label: string) => void;
  address: string;
  signIn?: MailAccount['signIn'] | undefined;
}) {
  const fallback = address.includes('@') ? mailboxDefaultLabel({ address, signIn }) : undefined;
  return (
    <TextField
      label="Name des Postfachs"
      placeholder={fallback ?? 'Arbeit, Privat …'}
      maxLength={MAX_MAILBOX_LABEL}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** The AI reading along – the same switch and words for every mailbox. */
function AiReads({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <Toggle size="sm" checked={on} onChange={onChange} label="KI liest neue Mails mit" />
      <p className="flex items-start gap-2 text-body text-fg-muted">
        <Icon name="info" size={16} className="mt-0.5 shrink-0" />
        {on
          ? 'Die KI dieses Workspace liest neue Mails mit – für „KI zur Mail“ neben der Mail, passende Dateien und Spam. Zum Nachschlagen im Web gehen nur Name und Firma des Absenders hinaus, keine Adressen.'
          : 'Die KI liest eine Mail nur, wenn du sie darum bittest – im Menü „Von der KI einschätzen lassen“ oder mit „Zusammenfassen“ in „KI zur Mail“.'}
      </p>
    </div>
  );
}

/**
 * A mailbox signed in through Microsoft or Google: address and servers are theirs – here only
 * its name and the AI's reading change, and it signs in anew („Neu anmelden“).
 */
function SignedInForm({
  account,
  onDone,
  returned,
}: {
  account: MailAccount;
  onDone: () => void;
  returned?: Returned;
}) {
  const ui = useSender();
  const update = useUpdateMailAccount(ui.workspace.id);
  const via = account.signIn as MailOAuthProvider;
  const [name, setName] = useState(account.name === account.address ? '' : account.name);
  const [label, setLabel] = useState(account.label ?? '');
  const [aiReads, setAiReads] = useState(account.aiReads);
  const [error, setError] = useState<FormError | null>(returned?.error ?? null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    update.mutate(
      { id: account.id, name: name.trim(), label: label.trim(), aiReads },
      {
        onSuccess: () => {
          ui.notify('Postfach gespeichert');
          onDone();
        },
        onError: (failure) => setError({ text: failure.message }),
      },
    );
  };
  return (
    <form
      onSubmit={submit}
      aria-label={`${account.address} ändern`}
      className="@container flex w-full flex-col gap-5"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          onDone();
        }
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-fg">{account.address}</h2>
        <p className="text-body text-fg-muted">
          Meldet sich über {MAIL_OAUTH_LABELS[via]} an – Adresse und Server kommen von dort.
        </p>
      </div>
      <div className="grid items-start gap-x-6 gap-y-4 @xl:grid-cols-2 @4xl:grid-cols-3">
        <TextField
          label="Name beim Senden"
          placeholder={ui.me.name}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <MailboxLabelField
          value={label}
          onChange={setLabel}
          address={account.address}
          signIn={account.signIn}
        />
      </div>
      <div className="grid items-start gap-x-6 gap-y-4 @xl:grid-cols-2 @4xl:grid-cols-3">
        <AiReads on={aiReads} onChange={setAiReads} />
      </div>
      {error && (
        <Notice
          tone="danger"
          variant="tinted"
          size="sm"
          role="alert"
          footer={error.check && <CheckSteps check={error.check} />}
        >
          {error.text}
        </Notice>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Abbrechen
        </Button>
        <OAuthButton
          inline
          label="Neu anmelden"
          input={{
            provider: via,
            accountId: account.id,
            name: name.trim(),
            label: label.trim(),
            aiReads,
          }}
          onError={setError}
        />
        <Button type="submit" loading={update.isPending}>
          Speichern
        </Button>
      </div>
    </form>
  );
}

/**
 * „Neues Postfach“ at the top right of „Postfächer“ (as „Neuer Bereich“ on „Bereiche“): to the
 * page with the form alone (`newMailboxPath`).
 */
export function NewMailboxButton() {
  const ui = useSender();
  return (
    <ButtonLink to={ui.newMailboxPath} variant="secondary" icon="add">
      Neues Postfach
    </ButtonLink>
  );
}

/**
 * Back from Microsoft or Google (`?anmeldung=`): how it ended – the mailbox, or why not
 * (`onRefused`); the parameter goes once read.
 */
function useMailOAuthOutcome({
  onAdded,
  onRefused,
}: {
  onAdded: (account: MailAccount, renewed: boolean) => void;
  onRefused: (returned: Returned, outcomeId: string) => void;
}) {
  const ui = useSender();
  const [params, setParams] = useSearchParams();
  const outcomeId = params.get('anmeldung');
  const added = useEffectEvent(onAdded);
  const refused = useEffectEvent(onRefused);
  useEffect(() => {
    if (!outcomeId) return;
    let live = true;
    mailOAuthResult(outcomeId)
      .then((result) => {
        if (!live) return;
        if (result.ok) {
          ui.notify(
            result.renewed ? `${result.account.address} neu angemeldet` : 'Postfach hinzugefügt',
          );
          added(result.account, result.renewed);
        } else
          refused(
            {
              accountId: result.accountId,
              name: result.name,
              label: result.label,
              aiReads: result.aiReads,
              error: { text: result.error, check: result.mailCheck },
            },
            outcomeId,
          );
      })
      .catch((error: Error) => live && ui.notify(error.message, 'danger'))
      .finally(() => {
        if (live)
          setParams(
            (now) => {
              now.delete('anmeldung');
              return now;
            },
            { replace: true },
          );
      });
    return () => {
      live = false;
    };
  }, [outcomeId, setParams, ui]);
  return outcomeId;
}

/** The mail page on a mailbox: where a new one is gone to once it is there. */
const mailboxHref = (mailPath: string, accountId: string) =>
  `${mailPath}?postfach=${encodeURIComponent(accountId)}`;

/**
 * „Neues Postfach“, a page of its own: the form alone – the other mailboxes stay on
 * „Postfächer“ – and beside it (`aside`, the agent that helps to set it up). Once the mailbox is
 * there, its mail opens; „Abbrechen“ and Esc go back to „Postfächer“.
 */
export function NewMailbox() {
  const ui = useSender();
  // Members and admins give agents work (as the server says).
  const helps = canCreateDecks(ui.workspace.role);
  const navigate = useNavigate();
  const accounts = useMailAccounts(ui.workspace.id);
  // What an agent got ready – not one that is a mailbox meanwhile.
  const prepared = useMailPrepared(ui.workspace.id).data;
  const proposal =
    prepared &&
    accounts.data &&
    !accounts.data.some((each) => each.address.toLowerCase() === prepared.address.toLowerCase())
      ? prepared
      : null;
  const [returned, setReturned] = useState<Returned | null>(null);
  const added = (account: MailAccount) =>
    void navigate(mailboxHref(ui.mailPath, account.id), { replace: true });
  const outcomeId = useMailOAuthOutcome({
    onAdded: added,
    onRefused: (back) => setReturned(back),
  });
  const done = (account?: MailAccount) =>
    account ? added(account) : void navigate(ui.mailAccountsPath);
  return (
    <div className="flex flex-col gap-8 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] xl:items-start">
      {helps && (
        <div className="xl:sticky xl:top-0 xl:order-last">
          <MailboxHelper />
        </div>
      )}
      <AccountForm
        // A refusal coming back opens it anew with its words.
        key={returned && !returned.accountId ? (outcomeId ?? 'returned') : 'new'}
        onDone={done}
        canCancel={(accounts.data?.length ?? 0) > 0}
        returned={returned && !returned.accountId ? returned : undefined}
        focus={!helps}
        titled={false}
        proposal={proposal}
      />
    </div>
  );
}

/**
 * „Postfächer“: one's mailboxes in this workspace – how each is doing, read now, changed or
 * deleted here (on the server everything stays). A new one is added on its own page.
 */
export function MailAccounts() {
  const ui = useSender();
  const accounts = useMailAccounts(ui.workspace.id);
  const sync = useSyncMailAccount(ui.workspace.id);
  const remove = useDeleteMailAccount(ui.workspace.id);
  const location = useLocation();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<MailAccount | null>(null);
  const actionsFor = (account: MailAccount): MenuAction[] => [
    ...(account.signIn !== 'password'
      ? [
          {
            label: 'Neu anmelden',
            icon: 'key' as const,
            onSelect: () =>
              startOAuth({
                provider: account.signIn as MailOAuthProvider,
                accountId: account.id,
              }).catch(fail),
          },
        ]
      : []),
    ...(account.state !== 'signin'
      ? [
          {
            label: 'Jetzt abrufen',
            icon: 'sync' as const,
            onSelect: () =>
              sync.mutate(account.id, {
                onSuccess: () => ui.notify('Abgerufen'),
                onError: fail,
              }),
          },
        ]
      : []),
    {
      label: 'Umbenennen',
      icon: 'edit',
      onSelect: () => setRenaming(account.id),
    },
    {
      label: 'Bearbeiten',
      icon: 'settings',
      onSelect: () => setEditing(account.id),
    },
    {
      label: 'Löschen',
      icon: 'delete',
      tone: 'danger',
      onSelect: () => setDeleting(account),
    },
  ];
  // A mailbox's menu at the pointer (right click on its row) – the same as its „…“ one.
  const [menu, setMenu] = useState<{ account: MailAccount; at: { x: number; y: number } } | null>(
    null,
  );
  const fail = (error: Error) => ui.notify(error.message, 'danger');
  const startOAuth = useStartMailOAuth();
  // Back from „Neu anmelden“: the mailbox signed in again – or its form says why not. A new one's
  // refusal belongs on its page (a sign-in started here before that page was there).
  const [returned, setReturned] = useState<Returned | null>(null);
  useMailOAuthOutcome({
    onAdded: () => {},
    onRefused: (back, outcomeId) => {
      if (back.accountId) {
        setReturned(back);
        setEditing(back.accountId);
      } else void navigate(`${ui.newMailboxPath}?anmeldung=${outcomeId}`, { replace: true });
    },
  });
  const done = () => {
    setEditing(null);
    setReturned(null);
  };
  // `#hinzufuegen` was the form under the list: links with it go on to its page.
  if (location.hash === ADD_MAILBOX_HASH) return <Navigate to={ui.newMailboxPath} replace />;
  if (!accounts.data) return null;
  const list = accounts.data;
  const labels = mailboxLabels(list);
  return (
    <div className="flex flex-col gap-6">
      {list.length === 0 ? (
        <EmptyState
          title="Noch kein Postfach"
          message="Trag dein Postfach ein – Gmail, Outlook, iCloud oder jeden anderen Mail-Server."
          action={
            <ButtonLink to={ui.newMailboxPath} icon="add">
              Postfach hinzufügen
            </ButtonLink>
          }
        />
      ) : (
        <RowList variant="hover" aria-label="Postfächer">
          {list.map((account) =>
            editing === account.id ? (
              <li key={account.id} className="p-2">
                {account.signIn === 'password' ? (
                  <AccountForm account={account} onDone={done} />
                ) : (
                  <SignedInForm
                    account={account}
                    onDone={done}
                    returned={returned?.accountId === account.id ? returned : undefined}
                  />
                )}
              </li>
            ) : (
              <ListRow
                key={account.id}
                variant="hover"
                padding="wide"
                leading={
                  <span className="flex size-8 items-center justify-center rounded-chip bg-surface-2 text-fg-muted">
                    <Icon name="mail" size={18} />
                  </span>
                }
                title={
                  renaming === account.id ? (
                    <MailboxNameInput
                      account={account}
                      shown={labels.get(account.id) ?? account.address}
                      onDone={() => setRenaming(null)}
                      // Inside the row's truncated title: a ring outside it would be cut off.
                      className="mx-0 w-full max-w-80 ring-inset"
                    />
                  ) : (
                    (labels.get(account.id) ?? account.address)
                  )
                }
                badge={
                  account.state === 'error' ? (
                    <Badge tone="danger">Fehler</Badge>
                  ) : account.state === 'signin' ? (
                    <Badge tone="warning">Neu anmelden</Badge>
                  ) : null
                }
                subtitle={
                  account.state === 'error' || account.state === 'signin'
                    ? (account.error ?? 'Nicht erreichbar')
                    : account.lastSyncAt
                      ? `${account.address} | Abgerufen ${formatRelativeTime(account.lastSyncAt)}`
                      : account.address
                }
                subtitleTitle={account.error ?? undefined}
                onContextMenu={(event) => {
                  if (event.shiftKey || renaming === account.id) return;
                  event.preventDefault();
                  setMenu({ account, at: { x: event.clientX, y: event.clientY } });
                }}
                trailing={
                  <Menu label={`Aktionen für ${account.address}`} actions={actionsFor(account)} />
                }
              />
            ),
          )}
        </RowList>
      )}
      {menu && (
        <ContextMenu
          label={`Aktionen für ${menu.account.address}`}
          at={menu.at}
          onClose={() => setMenu(null)}
          actions={actionsFor(menu.account)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          onClose={() => setDeleting(null)}
          title={`${deleting.address} löschen?`}
          description="Seine Mails verschwinden hier. Auf dem Mail-Server bleibt alles."
          confirmLabel="Löschen"
          confirmIcon="delete"
          pending={remove.isPending}
          onConfirm={() =>
            remove.mutate(deleting.id, {
              onSuccess: () => {
                ui.notify(`${deleting.address} gelöscht`);
                setDeleting(null);
              },
              onError: fail,
            })
          }
        />
      )}
    </div>
  );
}
