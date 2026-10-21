import { useState } from 'react';
import type { InstanceWorkspace } from '@slider/shared';
import { useInstanceWorkspaces, useSetWorkspaceBlocked, useSetWorkspacePlan } from '@/lib/api';
import { formatFileSize, formatRelativeTime } from '@/lib/format';
import {
  Badge,
  cn,
  ConfirmDialog,
  ErrorText,
  LoadingState,
  Menu,
  type MenuAction,
  type ShowToast,
} from '@/ui';
import { PlanBadge, WorkspaceMark } from '@/features/workspaces';
import { useListSearch } from '../hooks/useListSearch';
import { cell, ROW_CLASS, type Column } from '../lib/table';
import { DataTable, Pager, SearchField } from './ListControls';

type Pending =
  | { kind: 'block' | 'unblock'; workspace: InstanceWorkspace }
  | { kind: 'grant' | 'revoke'; workspace: InstanceWorkspace };

/**
 * Every organisation on the instance with its size and plan – never what is in it (BER-167), the
 * dashboard's "Organisationen" tab. The admin blocks one, or – where the plans differ – grants it
 * Paid without Stripe or takes that back.
 */
export function WorkspacesTable({ plans, onNotify }: { plans: boolean; onNotify: ShowToast }) {
  const search = useListSearch();
  const list = useInstanceWorkspaces(search.q, search.offset);
  const [pending, setPending] = useState<Pending | null>(null);
  const block = useSetWorkspaceBlocked();
  const plan = useSetWorkspacePlan();
  const mutation = pending?.kind === 'grant' || pending?.kind === 'revoke' ? plan : block;

  const close = () => {
    setPending(null);
    block.reset();
    plan.reset();
  };
  const confirm = () => {
    if (!pending) return;
    const { workspace } = pending;
    const done = (message: string) => () => {
      onNotify(message);
      close();
    };
    if (pending.kind === 'grant' || pending.kind === 'revoke') {
      plan.mutate(
        { workspaceId: workspace.id, plan: pending.kind === 'grant' ? 'paid' : 'free' },
        {
          onSuccess: done(
            pending.kind === 'grant'
              ? `„${workspace.name}“ ist jetzt im Paid-Plan`
              : `„${workspace.name}“ ist jetzt im Free-Plan`,
          ),
        },
      );
    } else {
      block.mutate(
        { workspaceId: workspace.id, blocked: pending.kind === 'block' },
        {
          onSuccess: done(
            pending.kind === 'block'
              ? `„${workspace.name}“ ist gesperrt`
              : `„${workspace.name}“ ist entsperrt`,
          ),
        },
      );
    }
  };

  return (
    <>
      <SearchField
        label="Name oder Domain suchen"
        value={search.typed}
        onChange={search.setTyped}
      />
      {list.isError ? (
        <ErrorText role="alert">{list.error.message}</ErrorText>
      ) : !list.data ? (
        <LoadingState padding="sm" />
      ) : list.data.workspaces.length === 0 ? (
        <p className="text-body text-fg-subtle">Keine Organisation gefunden.</p>
      ) : (
        <DataTable label="Organisationen" columns={columnsFor(plans)}>
          {list.data.workspaces.map((workspace) => (
            <WorkspaceRow
              key={workspace.id}
              workspace={workspace}
              plans={plans}
              onAction={(kind) => setPending({ kind, workspace })}
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
          {...CONFIRM_COPY[pending.kind](pending.workspace.name)}
          pending={mutation.isPending}
          error={mutation.error?.message}
          onConfirm={confirm}
        />
      )}
    </>
  );
}

const COLUMNS = {
  name: { label: 'Organisation' },
  members: { label: 'Personen', numeric: true },
  decks: { label: 'Reviews', numeric: true },
  storage: { label: 'Speicher', numeric: true },
  plan: { label: 'Plan' },
  created: { label: 'Seit', className: 'max-md:hidden' },
  actions: { label: 'Aktionen', hidden: true, className: 'w-10' },
} satisfies Record<string, Column>;

/** Without different plans there is no plan to show. */
const columnsFor = (plans: boolean): Column[] =>
  Object.entries(COLUMNS)
    .filter(([key]) => plans || key !== 'plan')
    .map(([, column]) => column);

const CONFIRM_COPY: Record<
  Pending['kind'],
  (name: string) => {
    title: string;
    description: string;
    confirmLabel: string;
    tone: 'danger' | 'primary';
  }
> = {
  block: (name) => ({
    title: `„${name}“ sperren?`,
    description:
      'Niemand öffnet dann ihre Reviews, niemand tritt bei, ihr Firmen-Login ist aus. Mitglieder sehen, dass sie gesperrt ist, und können austreten. Gelöscht wird nichts, Entsperren stellt alles wieder her.',
    confirmLabel: 'Sperren',
    tone: 'danger',
  }),
  unblock: (name) => ({
    title: `„${name}“ entsperren?`,
    description: 'Ihre Mitglieder können sie dann wieder ganz normal nutzen.',
    confirmLabel: 'Entsperren',
    tone: 'primary',
  }),
  grant: (name) => ({
    title: `„${name}“ in den Paid-Plan?`,
    description:
      'Freigeschaltet ohne Stripe, etwa bei Zahlung per Rechnung. Ein Abo kann sie dann nicht abschließen, bis du die Freischaltung beendest.',
    confirmLabel: 'Paid freischalten',
    tone: 'primary',
  }),
  revoke: (name) => ({
    title: `Freischaltung von „${name}“ beenden?`,
    description:
      'Sie ist dann sofort im Free-Plan. Liegt sie über einem Limit, gehen nur noch Lesen, Löschen und Upgraden, bis alles wieder passt.',
    confirmLabel: 'Auf Free setzen',
    tone: 'danger',
  }),
};

function WorkspaceRow({
  workspace,
  plans,
  onAction,
}: {
  workspace: InstanceWorkspace;
  plans: boolean;
  onAction: (kind: Pending['kind']) => void;
}) {
  const blocked = workspace.blockedAt !== null;
  const actions: MenuAction[] = [];
  if (plans) {
    actions.push(
      workspace.planGranted
        ? { label: 'Freischaltung beenden', icon: 'undo', onSelect: () => onAction('revoke') }
        : {
            label: 'Paid freischalten',
            icon: 'checkCircleOutline',
            onSelect: () => onAction('grant'),
            disabled: workspace.subscribed,
            title: workspace.subscribed
              ? 'Läuft über ein Abo – den Plan ändert, wer dafür bezahlt.'
              : undefined,
          },
    );
  }
  actions.push(
    blocked
      ? { label: 'Entsperren', icon: 'lock', onSelect: () => onAction('unblock') }
      : { label: 'Sperren …', icon: 'lock', tone: 'danger', onSelect: () => onAction('block') },
  );
  return (
    <tr className={ROW_CLASS}>
      <td className={cell(COLUMNS.name)}>
        <div className="flex min-w-0 items-center gap-3">
          <WorkspaceMark name={workspace.name} logoUrl={workspace.logoUrl} size={32} />
          <div className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span className={cn('truncate font-medium', blocked ? 'text-fg-muted' : 'text-fg')}>
                {workspace.name}
              </span>
              {blocked && <Badge tone="danger">Gesperrt</Badge>}
            </span>
            {workspace.joinDomain && (
              <span className="truncate text-xs text-fg-subtle">@{workspace.joinDomain}</span>
            )}
          </div>
        </div>
      </td>
      <td className={cell(COLUMNS.members)}>{workspace.memberCount}</td>
      <td className={cell(COLUMNS.decks)}>{workspace.deckCount}</td>
      <td className={cell(COLUMNS.storage)}>{formatFileSize(workspace.storageBytes)}</td>
      {plans && (
        <td className={cell(COLUMNS.plan)}>
          <span className="flex gap-1.5">
            <PlanBadge plan={workspace.plan} />
            {workspace.planGranted && <Badge tone="success">freigeschaltet</Badge>}
          </span>
        </td>
      )}
      <td className={cn(cell(COLUMNS.created), 'text-fg-subtle')}>
        {formatRelativeTime(workspace.createdAt)}
      </td>
      <td className={cell(COLUMNS.actions)}>
        <Menu label={`Aktionen für „${workspace.name}“`} actions={actions} />
      </td>
    </tr>
  );
}
