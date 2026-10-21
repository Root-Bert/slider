import { useState } from 'react';
import type { InstanceUser } from '@slider/shared';
import { useInstanceUsers, useSetUserBlocked } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import {
  Avatar,
  Badge,
  cn,
  ConfirmDialog,
  ErrorText,
  LoadingState,
  Menu,
  type ShowToast,
} from '@/ui';
import { useListSearch } from '../hooks/useListSearch';
import { cell, ROW_CLASS, type Column } from '../lib/table';
import { DataTable, Pager, SearchField } from './ListControls';

/**
 * Every account on the instance (BER-167), the dashboard's "Personen" tab: name and address – to
 * find someone – and when they came and last used Slider. Blocked, an account signs in nowhere;
 * nothing of it is deleted.
 */
export function UsersTable({ userId, onNotify }: { userId: string; onNotify: ShowToast }) {
  const search = useListSearch();
  const list = useInstanceUsers(search.q, search.offset);
  const [pending, setPending] = useState<InstanceUser | null>(null);
  const block = useSetUserBlocked();
  const blocking = pending?.blockedAt === null;

  const close = () => {
    setPending(null);
    block.reset();
  };

  return (
    <>
      <SearchField
        label="Name oder E-Mail suchen"
        value={search.typed}
        onChange={search.setTyped}
      />
      {list.isError ? (
        <ErrorText role="alert">{list.error.message}</ErrorText>
      ) : !list.data ? (
        <LoadingState padding="sm" />
      ) : list.data.users.length === 0 ? (
        <p className="text-body text-fg-subtle">Niemand gefunden.</p>
      ) : (
        <DataTable label="Personen" columns={Object.values(COLUMNS)}>
          {list.data.users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              self={user.id === userId}
              onToggle={() => setPending(user)}
            />
          ))}
        </DataTable>
      )}
      {list.data && (
        <Pager offset={search.offset} total={list.data.total} onChange={search.setOffset} />
      )}
      {pending && (
        <ConfirmDialog
          onClose={close}
          title={blocking ? `${pending.name} sperren?` : `${pending.name} entsperren?`}
          description={
            blocking
              ? `${pending.email} wird sofort abgemeldet und kann sich nicht mehr anmelden. Reviews, Kommentare und Mitgliedschaften bleiben, Entsperren lässt das Konto wieder herein.`
              : `${pending.email} kann sich dann wieder anmelden.`
          }
          confirmLabel={blocking ? 'Sperren' : 'Entsperren'}
          tone={blocking ? 'danger' : 'primary'}
          pending={block.isPending}
          error={block.error?.message}
          onConfirm={() =>
            block.mutate(
              { userId: pending.id, blocked: blocking },
              {
                onSuccess: () => {
                  onNotify(
                    blocking ? `${pending.name} ist gesperrt` : `${pending.name} ist entsperrt`,
                  );
                  close();
                },
              },
            )
          }
        />
      )}
    </>
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
