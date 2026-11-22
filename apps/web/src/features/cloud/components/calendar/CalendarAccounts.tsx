import {
  MAIL_OAUTH_LABELS,
  MAX_MAILBOX_LABEL,
  type Calendar,
  type MailAccount,
  type MailOAuthProvider,
} from '@slider/shared';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  mailOAuthResult,
  startMailOAuth,
  useAddAccountCalendars,
  useAddMailboxToCalendars,
  useAuthProviders,
  useCalendarConnections,
  useCalendars,
  useIdentities,
  useMailAccounts,
  useMailCalendarRefusals,
  useRemoveAccountCalendars,
  useRenameCalendarConnection,
  useRenameMailAccount,
} from '@/lib/api';
import { useOnPageRestore } from '@/lib/page-restore';
import { routes } from '@/lib/routes';
import {
  Badge,
  Button,
  ButtonLink,
  cn,
  ConfirmDialog,
  ContextMenu,
  EmptyState,
  GoogleMark,
  Icon,
  ListRow,
  Menu,
  MicrosoftMark,
  RowList,
  TextLink,
  type MenuAction,
} from '@/ui';
import { useCloud } from '../../hooks/useCloud';

/**
 * An account whose calendars stand in the calendar: a mailbox of Post, or calendars connected
 * alone („Google/Microsoft Kalender verbinden“, or a mailbox removed while its calendars stayed).
 */
export interface CalendarAccount {
  id: string;
  /** Its own name, else its address – never a generic one. */
  name: string;
  address: string;
  label: string | null;
  /** Its calendars alone, no mailbox; else a mailbox too (changed and removed in Post). */
  connection: boolean;
  signIn: MailAccount['signIn'];
  calendars: Calendar[];
  /** The provider ended its sign-in or never let the calendars be read: „Neu anmelden“. */
  signedOut: boolean;
  /** Signed in before calendars could be read at all (no calendars until signed in anew). */
  refused: boolean;
  /** Its calendars only to look at until signed in anew. */
  readOnly: boolean;
}

/**
 * One's accounts with calendars in this workspace – mailboxes first (as Post lists them), then the
 * calendars connected alone. `null` until both lists are there (no name is guessed meanwhile).
 */
export function useCalendarAccounts(
  workspaceId: string,
  calendars: readonly Calendar[] | undefined,
): CalendarAccount[] | null {
  const mailboxes = useMailAccounts(workspaceId).data;
  const connections = useCalendarConnections(workspaceId).data;
  const refusals = useMailCalendarRefusals(workspaceId).data ?? [];
  if (!mailboxes || !connections || !calendars) return null;
  const of = (id: string) => calendars.filter((each) => each.mailAccountId === id);
  const refused = (id: string) => refusals.some((each) => each.accountId === id);
  const readOnly = (list: Calendar[]) => list.some((each) => each.signInToChange);
  return [
    ...mailboxes
      .filter((mailbox) => of(mailbox.id).length > 0 || refused(mailbox.id))
      .map((mailbox) => ({
        id: mailbox.id,
        name: mailbox.label || mailbox.address,
        address: mailbox.address,
        label: mailbox.label,
        connection: false,
        signIn: mailbox.signIn,
        calendars: of(mailbox.id),
        signedOut: mailbox.state === 'signin' || refused(mailbox.id),
        refused: refused(mailbox.id),
        readOnly: readOnly(of(mailbox.id)),
      })),
    ...connections.map((connection) => ({
      id: connection.accountId,
      name: connection.label || connection.address,
      address: connection.address,
      label: connection.label,
      connection: true,
      signIn: connection.signIn,
      calendars: of(connection.accountId),
      signedOut: connection.signedOut || refused(connection.accountId),
      refused: refused(connection.accountId),
      readOnly: readOnly(of(connection.accountId)),
    })),
  ];
}

/** This page as it is, to come back to from the provider (without a sign-in's outcome). */
function returnHere() {
  const kept = new URLSearchParams(window.location.search);
  kept.delete('anmeldung');
  const query = kept.toString();
  return query ? `${window.location.pathname}?${query}` : window.location.pathname;
}

/**
 * Back from Google or Microsoft (`?anmeldung=`): connected, signed in anew – or why not; read once.
 */
export function useCalendarOAuthOutcome() {
  const ui = useCloud();
  const [params, setParams] = useSearchParams();
  const outcomeId = params.get('anmeldung');
  useEffect(() => {
    if (!outcomeId) return;
    let live = true;
    mailOAuthResult(outcomeId)
      .then((result) => {
        if (!live) return;
        if (result.ok)
          ui.notify(
            result.renewed
              ? `${result.account.address} neu angemeldet`
              : `${result.account.address} verbunden`,
          );
        else ui.notify(result.error, 'danger');
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
}

/**
 * To the provider's sign-in, in this tab; it comes back to this page. `connect`: calendars alone
 * (a new connection, that one anew, or a mailbox's calendars on again); `renew`: that account
 * anew as it is; `mailboxOf`: calendars alone become a mailbox.
 */
function useSignIn() {
  const ui = useCloud();
  const [leaving, setLeaving] = useState(false);
  // Back from the provider with the browser's Back button: clickable again.
  useOnPageRestore(() => setLeaving(false));
  const go = (input: Parameters<typeof startMailOAuth>[1]) => {
    setLeaving(true);
    startMailOAuth(ui.workspace.id, input).then(
      ({ url }) => window.location.assign(url),
      (error: Error) => {
        setLeaving(false);
        ui.notify(error.message, 'danger');
      },
    );
  };
  const connect = (provider: MailOAuthProvider, accountId?: string) =>
    go({
      provider,
      calendarOnly: true,
      ...(accountId ? { accountId } : {}),
      returnTo: returnHere(),
    });
  const renew = (account: CalendarAccount) => {
    if (account.signIn === 'password') return;
    if (account.connection) return connect(account.signIn, account.id);
    go({ provider: account.signIn, accountId: account.id, returnTo: returnHere() });
  };
  const mailboxOf = (account: CalendarAccount) => {
    if (account.signIn !== 'password')
      go({ provider: account.signIn, accountId: account.id, returnTo: returnHere() });
  };
  return { leaving, connect, renew, mailboxOf };
}

/** The providers whose sign-in for calendars alone is set up here (Microsoft first). */
function useCalendarProviders(): MailOAuthProvider[] {
  const offered = useAuthProviders().data?.calendarOAuth ?? [];
  return (['microsoft', 'google'] as const).filter((one) => offered.includes(one));
}

const ProviderLogo = ({ provider }: { provider: MailOAuthProvider }) =>
  provider === 'google' ? <GoogleMark size={16} /> : <MicrosoftMark size={16} />;

/**
 * „Microsoft Kalender verbinden“, „Google Kalender verbinden“ at the top right of „Konten“ (as
 * „Neues Postfach“ on „Postfächer“) – calendars without a mailbox.
 */
export function ConnectCalendarButtons() {
  const providers = useCalendarProviders();
  const { leaving, connect } = useSignIn();
  if (providers.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {providers.map((provider) => (
        <Button
          key={provider}
          variant="secondary"
          disabled={leaving}
          className="gap-2"
          onClick={() => connect(provider)}
        >
          <ProviderLogo provider={provider} />
          {MAIL_OAUTH_LABELS[provider]} Kalender verbinden
        </Button>
      ))}
    </div>
  );
}

/**
 * „Umbenennen“ in place, as a mailbox under „Postfächer“: Enter or leaving saves, Escape cancels;
 * emptied it is called by its address again. A mailbox's name is the one Post shows too.
 */
function AccountNameInput({ account, onDone }: { account: CalendarAccount; onDone: () => void }) {
  const ui = useCloud();
  const renameMailbox = useRenameMailAccount(ui.workspace.id);
  const renameConnection = useRenameCalendarConnection(ui.workspace.id);
  const [name, setName] = useState(account.name);
  const ref = useRef<HTMLInputElement>(null);
  // Enter and the blur that follows must not save twice.
  const settled = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = () => {
    settled.current = true;
    onDone();
  };
  const save = () => {
    if (settled.current) return;
    const trimmed = name.trim();
    if (trimmed === account.name || (!account.label && !trimmed)) return finish();
    const rename = account.connection ? renameConnection : renameMailbox;
    rename.mutate(
      { id: account.id, label: trimmed === account.address ? '' : trimmed },
      { onError: (error) => ui.notify(error.message, 'danger') },
    );
    finish();
  };
  return (
    <input
      ref={ref}
      value={name}
      onChange={(event) => setName(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          save();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish();
        }
      }}
      onContextMenu={(event) => event.stopPropagation()}
      maxLength={MAX_MAILBOX_LABEL}
      placeholder={account.address}
      aria-label="Name des Kontos"
      // Inside the row's truncated title: a ring outside it would be cut off.
      className={cn(
        'w-full max-w-80 min-w-0 rounded-badge bg-surface-1 px-1 text-fg [font:inherit]',
        'ring-2 ring-focus outline-none ring-inset',
      )}
    />
  );
}

function ProviderMark({ signIn }: { signIn: MailAccount['signIn'] }) {
  return (
    <span className="flex size-8 items-center justify-center rounded-chip bg-surface-2 text-fg-muted">
      {signIn === 'google' ? (
        <GoogleMark size={16} />
      ) : signIn === 'microsoft' ? (
        <MicrosoftMark size={16} />
      ) : (
        <Icon name="mail" size={18} />
      )}
    </span>
  );
}

/** Where an account's address also signs one in (`provider:address`). */
function useSignInAddresses(): ReadonlySet<string> {
  const identities = useIdentities().data ?? [];
  return new Set(
    identities.flatMap((one) => (one.email ? [`${one.provider}:${one.email.toLowerCase()}`] : [])),
  );
}

/** Its other uses, in a word each: „Auch Postfach“, „Auch Anmeldung“. */
function alsoOf(
  account: Pick<CalendarAccount, 'signIn' | 'address'> & { mailbox: boolean },
  signIns: ReadonlySet<string>,
) {
  return [
    account.mailbox ? 'Auch Postfach' : null,
    signIns.has(`${account.signIn}:${account.address.toLowerCase()}`) ? 'Auch Anmeldung' : null,
  ];
}

/** How an account is doing, in a line: why to sign in anew, else what it brings. */
function stateLine(account: CalendarAccount, signIns: ReadonlySet<string>) {
  if (account.refused)
    return 'Die Kalender dürfen noch nicht gelesen werden – nach dem neuen Anmelden stehen sie im Kalender.';
  if (account.signedOut)
    return 'Die Anmeldung ist abgelaufen – nach dem neuen Anmelden stehen die Kalender wieder im Kalender.';
  const count = account.calendars.length;
  return [
    account.label ? account.address : null,
    count === 1 ? '1 Kalender' : `${count} Kalender`,
    account.readOnly ? 'Nur zum Ansehen – zum Ändern neu anmelden' : null,
    ...alsoOf({ ...account, mailbox: !account.connection }, signIns),
  ]
    .filter(Boolean)
    .join(' | ');
}

/** Where the provider keeps it all: said when its calendars are removed here. */
const keptAt = (signIn: MailAccount['signIn']) =>
  signIn === 'password'
    ? 'Auf dem Server bleibt alles.'
    : `Bei ${MAIL_OAUTH_LABELS[signIn]} bleibt alles.`;

/**
 * „Konten“ of the calendar: the accounts whose calendars stand in it – how each is doing, signed in
 * anew, renamed, their calendars removed („Entfernen“: a mailbox stays in Post, calendars alone go);
 * below, dimmed, the mailboxes whose calendars were removed – „Verbinden“ brings them back.
 */
export function CalendarAccounts() {
  const ui = useCloud();
  const navigate = useNavigate();
  const calendars = useCalendars(ui.workspace.id).data;
  const accounts = useCalendarAccounts(ui.workspace.id, calendars);
  const mailboxes = useMailAccounts(ui.workspace.id).data;
  const mailOAuth = useAuthProviders().data?.mailOAuth ?? [];
  const signIns = useSignInAddresses();
  const remove = useRemoveAccountCalendars(ui.workspace.id);
  const addCalendars = useAddAccountCalendars(ui.workspace.id);
  const addMailbox = useAddMailboxToCalendars(ui.workspace.id);
  const providers = useCalendarProviders();
  const { leaving, connect, renew, mailboxOf } = useSignIn();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CalendarAccount | null>(null);
  // An account's menu at the pointer (right click on its row) – the same as its „…“ one.
  const [menu, setMenu] = useState<{
    account: CalendarAccount;
    at: { x: number; y: number };
  } | null>(null);
  const fail = (error: Error) => ui.notify(error.message, 'danger');
  // Calendars alone become a mailbox: through the provider where its mailboxes are set up here,
  // with the password kept for its calendars otherwise.
  const canAddMailbox = (account: CalendarAccount) =>
    account.connection && (account.signIn === 'password' || mailOAuth.includes(account.signIn));
  const actionsFor = (account: CalendarAccount): MenuAction[] => {
    const all: (MenuAction | null)[] = [
      ...(account.signIn !== 'password'
        ? [{ label: 'Neu anmelden', icon: 'key' as const, onSelect: () => renew(account) }]
        : []),
      { label: 'Umbenennen', icon: 'edit', onSelect: () => setRenaming(account.id) },
      account.connection
        ? canAddMailbox(account)
          ? {
              label: 'Postfach hinzufügen',
              icon: 'mail',
              onSelect: () =>
                account.signIn === 'password'
                  ? addMailbox.mutate(account.id, {
                      onSuccess: () => ui.notify(`${account.address} in Post hinzugefügt`),
                      onError: fail,
                    })
                  : mailboxOf(account),
            }
          : null
        : {
            label: 'In Post verwalten',
            icon: 'mail',
            onSelect: () => void navigate(routes.cloudMailAccounts(ui.workspace.id)),
          },
      {
        label: 'Entfernen',
        icon: 'delete',
        tone: 'danger',
        onSelect: () => setRemoving(account),
      },
    ];
    return all.filter((one): one is MenuAction => one !== null);
  };
  if (!accounts || !mailboxes) return null;
  // Mailboxes whose calendars were removed here: to bring back.
  const off = mailboxes.filter((mailbox) => !mailbox.calendars);
  const turnOn = (mailbox: MailAccount) =>
    addCalendars.mutate(mailbox.id, {
      onSuccess: ({ signIn }) => {
        if (signIn && mailbox.signIn !== 'password') connect(mailbox.signIn, mailbox.id);
        else ui.notify(`Kalender von ${mailbox.address} verbunden`);
      },
      onError: fail,
    });
  const addMailboxNote = (
    <>
      Kalender von iCloud und anderen kommen mit ihrem Postfach –{' '}
      <TextLink to={routes.cloudNewMailbox(ui.workspace.id)}>Postfach hinzufügen</TextLink>
    </>
  );
  return (
    <div className="flex flex-col gap-6">
      {accounts.length === 0 && off.length === 0 ? (
        <EmptyState
          title="Noch kein Konto"
          message={
            providers.length > 0
              ? `Verbinde deinen Kalender bei ${providers.map((one) => MAIL_OAUTH_LABELS[one]).join(' oder ')} – oder füge in Post ein Postfach hinzu, seine Kalender kommen mit.`
              : 'Füge in Post ein Postfach hinzu – seine Kalender kommen mit.'
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {providers.map((provider) => (
                <Button
                  key={provider}
                  variant="secondary"
                  className="gap-2"
                  disabled={leaving}
                  onClick={() => connect(provider)}
                >
                  <ProviderLogo provider={provider} />
                  {MAIL_OAUTH_LABELS[provider]} Kalender verbinden
                </Button>
              ))}
              <ButtonLink to={routes.cloudNewMailbox(ui.workspace.id)} variant="ghost" icon="add">
                Postfach hinzufügen
              </ButtonLink>
            </div>
          }
        />
      ) : (
        <>
          <RowList variant="hover" aria-label="Konten">
            {accounts.map((account) => (
              <ListRow
                key={account.id}
                variant="hover"
                padding="wide"
                leading={<ProviderMark signIn={account.signIn} />}
                title={
                  renaming === account.id ? (
                    <AccountNameInput account={account} onDone={() => setRenaming(null)} />
                  ) : (
                    account.name
                  )
                }
                badge={
                  account.signedOut ? (
                    <Badge tone="warning">Neu anmelden</Badge>
                  ) : account.readOnly ? (
                    <Badge>Nur ansehen</Badge>
                  ) : null
                }
                subtitle={stateLine(account, signIns)}
                subtitleTitle={stateLine(account, signIns)}
                onContextMenu={(event) => {
                  if (event.shiftKey || renaming === account.id) return;
                  event.preventDefault();
                  setMenu({ account, at: { x: event.clientX, y: event.clientY } });
                }}
                trailing={
                  <Menu label={`Aktionen für ${account.name}`} actions={actionsFor(account)} />
                }
              />
            ))}
            {off.map((mailbox) => (
              <ListRow
                key={mailbox.id}
                variant="hover"
                padding="wide"
                dimmed
                leading={<ProviderMark signIn={mailbox.signIn} />}
                title={mailbox.label || mailbox.address}
                subtitle={[
                  mailbox.label ? mailbox.address : null,
                  'Kalender nicht verbunden',
                  ...alsoOf({ ...mailbox, mailbox: true }, signIns),
                ]
                  .filter(Boolean)
                  .join(' | ')}
                trailing={
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={addCalendars.isPending && addCalendars.variables === mailbox.id}
                    disabled={leaving}
                    onClick={() => turnOn(mailbox)}
                  >
                    Verbinden
                  </Button>
                }
              />
            ))}
          </RowList>
          <p className="flex items-start gap-2 px-2.5 text-body text-fg-muted">
            <Icon name="info" size={16} className="mt-0.5 shrink-0" />
            <span>{addMailboxNote}</span>
          </p>
        </>
      )}
      {menu && (
        <ContextMenu
          label={`Aktionen für ${menu.account.name}`}
          at={menu.at}
          onClose={() => setMenu(null)}
          actions={actionsFor(menu.account)}
        />
      )}
      {removing && (
        <ConfirmDialog
          onClose={() => setRemoving(null)}
          title={`Kalender von ${removing.address} entfernen?`}
          description={
            removing.connection
              ? `Seine Kalender verschwinden hier. ${keptAt(removing.signIn)}`
              : `Seine Kalender verschwinden hier, das Postfach bleibt in Post. ${keptAt(removing.signIn)}`
          }
          confirmLabel="Entfernen"
          confirmIcon="delete"
          pending={remove.isPending}
          onConfirm={() =>
            remove.mutate(removing.id, {
              onSuccess: () => {
                ui.notify(`Kalender von ${removing.address} entfernt`);
                setRemoving(null);
              },
              onError: fail,
            })
          }
        />
      )}
    </div>
  );
}
