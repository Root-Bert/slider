import type { InstanceUser } from '@slider/shared';
import { useInstanceUsers, useSetUserBlocked } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { Avatar, Badge, cn, Menu, type ShowToast } from '@/ui';
import { useConfirmedAction, type ConfirmedAction } from '../hooks/useConfirmedAction';
import { useListSearch } from '../hooks/useListSearch';
import { cell, ROW_CLASS, type Column } from '../lib/table';
import { DirectoryList } from './ListControls';

/**
 * Every account on the instance (BER-167), the dashboard's "Personen" tab: name and address – to
 * find someone – and when they came and last used Slider. Blocked, an account signs in nowhere;
 * nothing of it is deleted.
 */
export function UsersTable({ userId, onNotify }: { userId: string; onNotify: ShowToast }) {
  const search = useListSearch();
  const list = useInstanceUsers(search.q, search.offset);
  const block = useSetUserBlocked();
  const confirm = useConfirmedAction(onNotify, [block]);
  const toggle = (user: InstanceUser): ConfirmedAction => {
    const blocking = user.blockedAt === null;
    const run = (onSuccess: () => void) =>
      block.mutate({ userId: user.id, blocked: blocking }, { onSuccess });
    return blocking
      ? {
          title: `${user.name} sperren?`,
          description: `${user.email} wird sofort abgemeldet und kann sich nicht mehr anmelden. Reviews, Kommentare und Mitgliedschaften bleiben, Entsperren lässt das Konto wieder herein.`,
          confirmLabel: 'Sperren',
          tone: 'danger',
          done: `${user.name} ist gesperrt`,
          run,
        }
      : {
          title: `${user.name} entsperren?`,
          description: `${user.email} kann sich dann wieder anmelden.`,
          confirmLabel: 'Entsperren',
          tone: 'primary',
          done: `${user.name} ist entsperrt`,
          run,
        };
  };

  return (
    <DirectoryList
      label="Personen"
      searchLabel="Name oder E-Mail suchen"
      empty="Niemand gefunden."
      columns={Object.values(COLUMNS)}
      search={search}
      list={list}
      items={list.data?.users}
      row={(user) => (
        <UserRow
          key={user.id}
          user={user}
          self={user.id === userId}
          onToggle={() => confirm.ask(toggle(user))}
        />
      )}
    >
      {confirm.dialog}
    </DirectoryList>
  );
}

const COLUMNS = {
  name: { label: 'Person' },
  workspaces: { label: 'Organisationen', numeric: true },
  created: { label: 'Seit', className: 'max-md:hidden' },
  active: { label: 'Zuletzt aktiv' },
  actions: { label: 'Aktionen', hidden: true, className: 'w-10' },
} satisfies Record<string, Column>;

function UserRow({
  user,
  self,
  onToggle,
}: {
  user: InstanceUser;
  self: boolean;
  onToggle: () => void;
}) {
  const blocked = user.blockedAt !== null;
  return (
    <tr className={ROW_CLASS}>
      <td className={cell(COLUMNS.name)}>
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn('flex shrink-0', blocked && 'opacity-60')}>
            <Avatar author={{ name: user.name, color: user.color, type: 'owner' }} size={32} />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span className={cn('truncate font-medium', blocked ? 'text-fg-muted' : 'text-fg')}>
                {user.name}
                {self && <span className="font-normal text-fg-subtle"> (du)</span>}
              </span>
              {user.isInstanceAdmin && <Badge tone="info">Instanz-Admin</Badge>}
              {blocked && <Badge tone="danger">Gesperrt</Badge>}
            </span>
            <span className="truncate text-xs text-fg-subtle">{user.email}</span>
          </div>
        </div>
      </td>
      <td className={cell(COLUMNS.workspaces)}>{user.workspaceCount}</td>
      <td className={cn(cell(COLUMNS.created), 'text-fg-subtle')}>
        {formatRelativeTime(user.createdAt)}
      </td>
      <td className={cn(cell(COLUMNS.active), 'text-fg-muted')}>
        {formatRelativeTime(user.lastActiveAt)}
      </td>
      <td className={cell(COLUMNS.actions)}>
        {!user.isInstanceAdmin && (
          <Menu
            label={`Aktionen für ${user.name}`}
            actions={[
              blocked
                ? { label: 'Entsperren', icon: 'lock', onSelect: onToggle }
                : { label: 'Sperren …', icon: 'lock', tone: 'danger', onSelect: onToggle },
            ]}
          />
        )}
      </td>
    </tr>
  );
}
