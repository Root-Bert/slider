import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { LinkedMailAccount, LoginIdentity, MailSignIn } from '@slider/shared';
import { providerLoginUrl } from '@/features/auth';
import { useAuthProviders, useIdentities, useLinkedMailAccounts } from '@/lib/api';
import { routes } from '@/lib/routes';
import {
  Badge,
  GoogleMark,
  Icon,
  IconTile,
  ListRow,
  Menu,
  MicrosoftMark,
  RowList,
  Section,
  type MenuAction,
} from '@/ui';
import { UnlinkDialog } from './AccountSections';

/**
 * „Verknüpfte Konten“ on `/konto`: each address at Microsoft, Google or a mail server once, with
 * what it is linked for here – „Anmeldung“, „Post“, „Kalender“ (in which workspace, where there
 * are several). Each use is added and removed where it lives: the sign-in here, the mailbox in
 * Post › Postfächer, the calendars in Kalender › Konten – the menu leads there.
 */

interface Linked {
  key: string;
  address: string;
  signIn: MailSignIn;
  identity: LoginIdentity | null;
  mailboxes: LinkedMailAccount[];
}

const SIGN_IN_LABELS: Record<MailSignIn, string> = {
  microsoft: 'Microsoft',
  google: 'Google',
  password: 'Mail-Server',
};

/** Logins and mail accounts of one address at one provider, together. */
function useLinked(): Linked[] | null {
  const identities = useIdentities().data;
  const mailboxes = useLinkedMailAccounts().data;
  if (!identities || !mailboxes) return null;
  const rows = new Map<string, Linked>();
  const rowOf = (signIn: MailSignIn, address: string) => {
    const key = `${signIn}:${address.toLowerCase()}`;
    const row = rows.get(key) ?? { key, address, signIn, identity: null, mailboxes: [] };
    rows.set(key, row);
    return row;
  };
  for (const identity of identities)
    if ((identity.provider === 'microsoft' || identity.provider === 'google') && identity.email)
      rowOf(identity.provider, identity.email).identity = identity;
  for (const mailbox of mailboxes) rowOf(mailbox.signIn, mailbox.address).mailboxes.push(mailbox);
  return [...rows.values()];
}

/** „Anmeldung | Post | Kalender“ – each in its workspace where one has several. */
function usesLine(row: Linked, severalWorkspaces: boolean) {
  const where = (mailbox: LinkedMailAccount) =>
    severalWorkspaces ? ` (${mailbox.workspaceName})` : '';
  return [
    row.identity ? 'Anmeldung' : null,
    ...row.mailboxes.filter((one) => one.mail).map((one) => `Post${where(one)}`),
    ...row.mailboxes.filter((one) => one.calendars).map((one) => `Kalender${where(one)}`),
  ]
    .filter(Boolean)
    .join(' | ');
}

export function LinkedAccountsSection() {
  const navigate = useNavigate();
  const linked = useLinked();
  const identities = useIdentities().data ?? [];
  const loginProviders = useAuthProviders().data?.providers ?? [];
  const [unlinking, setUnlinking] = useState<LoginIdentity | null>(null);
  // Nothing at a mail provider: the logins above say it all.
  if (!linked || !linked.some((row) => row.mailboxes.length > 0)) return null;
  const severalWorkspaces =
    new Set(linked.flatMap((row) => row.mailboxes.map((one) => one.workspaceId))).size > 1;
  // Never the last login: a passkey alone doesn't count (the server checks the same).
  const canUnlink = identities.length > 1;
  const actionsFor = (row: Linked): MenuAction[] => {
    const loginUrl = loginProviders.find((one) => one.id === row.signIn)?.loginUrl;
    const where = (mailbox: LinkedMailAccount) =>
      severalWorkspaces ? ` (${mailbox.workspaceName})` : '';
    return [
      ...row.mailboxes.map((mailbox) => ({
        key: `post-${mailbox.accountId}`,
        label: `In Post verwalten${where(mailbox)}`,
        icon: 'mail' as const,
        onSelect: () => void navigate(routes.cloudMailAccounts(mailbox.workspaceId)),
      })),
      ...row.mailboxes.map((mailbox) => ({
        key: `calendar-${mailbox.accountId}`,
        label: `Im Kalender verwalten${where(mailbox)}`,
        icon: 'calendar' as const,
        onSelect: () => void navigate(routes.cloudCalendarAccounts(mailbox.workspaceId)),
      })),
      ...(row.identity
        ? [
            {
              label: 'Anmeldung entfernen',
              icon: 'delete' as const,
              tone: 'danger' as const,
              disabled: !canUnlink,
              title: canUnlink
                ? undefined
                : 'Deine letzte Anmeldung – verbinde vorher eine andere.',
              onSelect: () => row.identity && setUnlinking(row.identity),
            },
          ]
        : loginUrl
          ? [
              {
                label: 'Als Anmeldung verbinden',
                icon: 'key' as const,
                onSelect: () =>
                  window.location.assign(providerLoginUrl(`${loginUrl}?intent=connect`, '/konto')),
              },
            ]
          : []),
    ];
  };
  return (
    <Section
      title="Verknüpfte Konten"
      description="Wofür jedes deiner Konten bei Microsoft, Google oder einem Mail-Server hier verknüpft ist."
    >
      <RowList>
        {linked.map((row) => (
          <ListRow
            key={row.key}
            leading={
              <IconTile tone="inherit">
                {row.signIn === 'microsoft' ? (
                  <MicrosoftMark size={18} />
                ) : row.signIn === 'google' ? (
                  <GoogleMark size={18} />
                ) : (
                  <Icon name="mail" size={20} className="text-fg-muted" />
                )}
              </IconTile>
            }
            title={row.address}
            badge={
              row.mailboxes.some((one) => one.signedOut) ? (
                <Badge tone="warning">Neu anmelden</Badge>
              ) : null
            }
            subtitle={`${SIGN_IN_LABELS[row.signIn]} | ${usesLine(row, severalWorkspaces)}`}
            trailing={<Menu label={`Aktionen für ${row.address}`} actions={actionsFor(row)} />}
          />
        ))}
      </RowList>
      {unlinking && <UnlinkDialog identity={unlinking} onClose={() => setUnlinking(null)} />}
    </Section>
  );
}
