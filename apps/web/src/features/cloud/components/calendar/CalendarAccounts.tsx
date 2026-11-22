import { MAX_MAILBOX_LABEL, type Calendar, type MailAccount } from '@slider/shared';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  mailOAuthResult,
  startMailOAuth,
  useAuthProviders,
  useCalendarConnections,
  useCalendars,
  useDeleteCalendarConnection,
  useMailAccounts,
  useMailCalendarRefusals,
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
 * An account whose calendars stand in the calendar: a mailbox of Post, or a Google calendar
 * connected alone („Google Kalender verbinden“).
 */
export interface CalendarAccount {
  id: string;
  /** Its own name, else its address – never a generic one. */
  name: string;
  address: string;
  label: string | null;
  /** Connected for its calendars alone; else a mailbox (changed and deleted in Post). */
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
 * To the provider's sign-in, in this tab; it comes back to this page. `connect`: Google for one's
 * calendars alone (a new connection, or that one anew); `renew`: a mailbox, asking for its
 * calendars too.
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
  const connect = (accountId?: string) =>
    go({
      provider: 'google',
      calendarOnly: true,
      ...(accountId ? { accountId } : {}),
      returnTo: returnHere(),
    });
  const renew = (account: CalendarAccount) => {
    if (account.connection) return connect(account.id);
    if (account.signIn === 'password') return;
    go({ provider: account.signIn, accountId: account.id, returnTo: returnHere() });
  };
  return { leaving, connect, renew };
}

/** Google's sign-in for the calendars alone is set up on this server. */
function useCanConnectGoogle() {
  return useAuthProviders().data?.calendarOAuth.includes('google') ?? false;
}

/** „Google Kalender verbinden“ at the top right of „Konten“ (as „Neues Postfach“ on „Postfächer“). */
export function ConnectGoogleButton() {
  const canConnect = useCanConnectGoogle();
  const { leaving, connect } = useSignIn();
  if (!canConnect) return null;
  return (
    <Button variant="secondary" loading={leaving} className="gap-2" onClick={() => connect()}>
      {!leaving && <GoogleMark size={16} />}
      Google Kalender verbinden
    </Button>
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

function ProviderMark({ account }: { account: CalendarAccount }) {
  return (
    <span className="flex size-8 items-center justify-center rounded-chip bg-surface-2 text-fg-muted">
      {account.signIn === 'google' ? (
        <GoogleMark size={16} />
      ) : account.signIn === 'microsoft' ? (
        <MicrosoftMark size={16} />
      ) : (
        <Icon name="mail" size={18} />
      )}
    </span>
  );
}

/** How an account is doing, in a line: why to sign in anew, else what it brings. */
function stateLine(account: CalendarAccount) {
  if (account.refused)
    return 'Slider darf die Kalender noch nicht lesen – nach dem neuen Anmelden stehen sie im Kalender.';
  if (account.signedOut)
    return 'Die Anmeldung ist abgelaufen – nach dem neuen Anmelden stehen die Kalender wieder im Kalender.';
  const count = account.calendars.length;
  return [
    account.label ? account.address : null,
    count === 1 ? '1 Kalender' : `${count} Kalender`,
    account.readOnly ? 'Nur zum Ansehen – zum Ändern neu anmelden' : null,
    account.connection ? 'Ohne Postfach' : 'Postfach in Post',
  ]
    .filter(Boolean)
    .join(' | ');
}

/**
 * „Konten“ of the calendar: the accounts whose calendars stand in it – how each is doing, signed in
 * anew, renamed; a Google calendar connected alone is deleted here, a mailbox in Post.
 */
export function CalendarAccounts() {
  const ui = useCloud();
  const navigate = useNavigate();
  const calendars = useCalendars(ui.workspace.id).data;
  const accounts = useCalendarAccounts(ui.workspace.id, calendars);
  const remove = useDeleteCalendarConnection(ui.workspace.id);
  const canConnect = useCanConnectGoogle();
  const { connect, renew } = useSignIn();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CalendarAccount | null>(null);
  // An account's menu at the pointer (right click on its row) – the same as its „…“ one.
  const [menu, setMenu] = useState<{
    account: CalendarAccount;
    at: { x: number; y: number };
  } | null>(null);
  const actionsFor = (account: CalendarAccount): MenuAction[] => [
    ...(account.signIn !== 'password'
      ? [{ label: 'Neu anmelden', icon: 'key' as const, onSelect: () => renew(account) }]
      : []),
    { label: 'Umbenennen', icon: 'edit', onSelect: () => setRenaming(account.id) },
    account.connection
      ? {
          label: 'Löschen',
          icon: 'delete',
          tone: 'danger',
          onSelect: () => setDeleting(account),
        }
      : {
          label: 'In Post verwalten',
          icon: 'mail',
          onSelect: () => void navigate(routes.cloudMailAccounts(ui.workspace.id)),
        },
  ];
  if (!accounts) return null;
  const addMailbox = (
    <>
      Kalender von Microsoft, iCloud und anderen kommen mit ihrem Postfach –{' '}
      <TextLink to={routes.cloudNewMailbox(ui.workspace.id)}>Postfach hinzufügen</TextLink>
    </>
  );
  return (
    <div className="flex flex-col gap-6">
      {accounts.length === 0 ? (
        <EmptyState
          title="Noch kein Konto"
          message={
            canConnect
              ? 'Verbinde deinen Google Kalender – oder füge in Post ein Postfach hinzu, seine Kalender kommen mit.'
              : 'Füge in Post ein Postfach hinzu – seine Kalender kommen mit.'
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {canConnect && (
                <Button variant="secondary" className="gap-2" onClick={() => connect()}>
                  <GoogleMark size={16} />
                  Google Kalender verbinden
                </Button>
              )}
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
                leading={<ProviderMark account={account} />}
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
                subtitle={stateLine(account)}
                subtitleTitle={stateLine(account)}
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
          </RowList>
          <p className="flex items-start gap-2 px-2.5 text-body text-fg-muted">
            <Icon name="info" size={16} className="mt-0.5 shrink-0" />
            <span>{addMailbox}</span>
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
      {deleting && (
        <ConfirmDialog
          onClose={() => setDeleting(null)}
          title={`${deleting.address} löschen?`}
          description="Seine Kalender verschwinden hier. Bei Google bleibt alles."
          confirmLabel="Löschen"
          confirmIcon="delete"
          pending={remove.isPending}
          onConfirm={() =>
            remove.mutate(deleting.id, {
              onSuccess: () => {
                ui.notify(`${deleting.address} gelöscht`);
                setDeleting(null);
              },
              onError: (error: Error) => ui.notify(error.message, 'danger'),
            })
          }
        />
      )}
    </div>
  );
}
