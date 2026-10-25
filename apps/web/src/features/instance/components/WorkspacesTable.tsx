import type { InstanceWorkspace } from '@slider/shared';
import { useInstanceWorkspaces, useSetWorkspaceBlocked, useSetWorkspacePlan } from '@/lib/api';
import { formatFileSize, formatRelativeTime } from '@/lib/format';
import { Badge, cn, Menu, type MenuAction, type ShowToast } from '@/ui';
import { PlanBadge, WorkspaceMark } from '@/features/workspaces';
import { useConfirmedAction, type ConfirmedAction } from '../hooks/useConfirmedAction';
import { useListSearch } from '../hooks/useListSearch';
import { cell, ROW_CLASS, type Column } from '../lib/table';
import { DirectoryList } from './ListControls';

type Kind = 'block' | 'unblock' | 'grant' | 'revoke';

/**
 * Every workspace on the instance with its size and plan – never what is in it (BER-167), the
 * dashboard's "Workspaces" tab. The admin blocks one, or – where the plans differ – grants it
 * Paid without Stripe or takes that back.
 */
export function WorkspacesTable({ plans, onNotify }: { plans: boolean; onNotify: ShowToast }) {
  const search = useListSearch();
  const list = useInstanceWorkspaces(search.q, search.offset);
  const block = useSetWorkspaceBlocked();
  const plan = useSetWorkspacePlan();
  const confirm = useConfirmedAction(onNotify, [block, plan]);
  const action = (kind: Kind, workspace: InstanceWorkspace): ConfirmedAction => {
    const workspaceId = workspace.id;
    return {
      ...CONFIRM_COPY[kind](workspace.name),
      run: (onSuccess) =>
        kind === 'grant' || kind === 'revoke'
          ? plan.mutate({ workspaceId, plan: kind === 'grant' ? 'paid' : 'free' }, { onSuccess })
          : block.mutate({ workspaceId, blocked: kind === 'block' }, { onSuccess }),
    };
  };

  return (
    <DirectoryList
      label="Workspaces"
      searchLabel="Name oder Domain suchen"
      empty="Kein Workspace gefunden."
      columns={columnsFor(plans)}
      search={search}
      list={list}
      items={list.data?.workspaces}
      row={(workspace) => (
        <WorkspaceRow
          key={workspace.id}
          workspace={workspace}
          plans={plans}
          onAction={(kind) => confirm.ask(action(kind, workspace))}
        />
      )}
    >
      {confirm.dialog}
    </DirectoryList>
  );
}

const COLUMNS = {
  name: { label: 'Workspace' },
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

const CONFIRM_COPY: Record<Kind, (name: string) => Omit<ConfirmedAction, 'run'>> = {
  block: (name) => ({
    title: `„${name}“ sperren?`,
    description:
      'Niemand öffnet dann ihre Reviews, niemand tritt bei, ihr Firmen-Login ist aus. Mitglieder sehen, dass sie gesperrt ist, und können austreten. Gelöscht wird nichts, Entsperren stellt alles wieder her.',
    confirmLabel: 'Sperren',
    tone: 'danger',
    done: `„${name}“ ist gesperrt`,
  }),
  unblock: (name) => ({
    title: `„${name}“ entsperren?`,
    description: 'Ihre Mitglieder können sie dann wieder ganz normal nutzen.',
    confirmLabel: 'Entsperren',
    tone: 'primary',
    done: `„${name}“ ist entsperrt`,
  }),
  grant: (name) => ({
    title: `„${name}“ in den Paid-Plan?`,
    description:
      'Freigeschaltet ohne Stripe, etwa bei Zahlung per Rechnung. Ein Abo kann sie dann nicht abschließen, bis du die Freischaltung beendest.',
    confirmLabel: 'Paid freischalten',
    tone: 'primary',
    done: `„${name}“ ist jetzt im Paid-Plan`,
  }),
  revoke: (name) => ({
    title: `Freischaltung von „${name}“ beenden?`,
    description:
      'Sie ist dann sofort im Free-Plan. Liegt sie über einem Limit, gehen nur noch Lesen, Löschen und Upgraden, bis alles wieder passt.',
    confirmLabel: 'Auf Free setzen',
    tone: 'danger',
    done: `„${name}“ ist jetzt im Free-Plan`,
  }),
};

function WorkspaceRow({
  workspace,
  plans,
  onAction,
}: {
  workspace: InstanceWorkspace;
  plans: boolean;
  onAction: (kind: Kind) => void;
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
