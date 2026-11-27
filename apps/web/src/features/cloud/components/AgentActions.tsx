import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMatch, useNavigate } from 'react-router';
import {
  CLOUD_AGENT_TITLE_MAX,
  cloudAgentTitleSchema,
  type CloudAgentSummary,
  type SenderAgent,
} from '@slider/shared';
import { useDeleteCloudAgent, useRenameCloudAgent } from '@/lib/api';
import { cn, ConfirmDialog, ContextMenu, Menu, type MenuAction } from '@/ui';
import { useCloud } from '../hooks/useCloud';
import { useAgentShare } from './AgentShare';

/** Whether an agent has a menu at all: its owner names and shares it, they or an admin delete it. */
export const hasAgentActions = (agent: CloudAgentSummary) => agent.mine || agent.canDelete;

/**
 * „Agent löschen?“ – asked the same on its page, in a list and on its chat in a side bar (Cloud's
 * and Sender's, hence no `useCloud` here).
 */
export function DeleteAgentDialog({
  agent,
  workspaceId,
  notify,
  onClose,
  onDeleted,
}: {
  agent: Pick<CloudAgentSummary, 'id'>;
  workspaceId: string;
  notify: (message: string, tone?: 'danger') => void;
  onClose: () => void;
  /** It is gone from the lists already: the page leaves here. */
  onDeleted?: () => void;
}) {
  const remove = useDeleteCloudAgent(workspaceId);
  return (
    <ConfirmDialog
      onClose={onClose}
      title="Agent löschen?"
      description="Sein Chat und sein Schreibtisch sind dann weg. Was er angelegt und geändert hat, bleibt."
      confirmLabel="Löschen"
      confirmIcon="delete"
      onConfirm={() => {
        onClose();
        // Its tile is gone at once, and this dialog with it: the promise still says how it went
        // (`mutate`'s own callbacks are dropped once their component is gone).
        remove.mutateAsync(agent.id).then(
          () => notify('Agent gelöscht'),
          (error: Error) => notify(error.message, 'danger'),
        );
        onDeleted?.();
      }}
    />
  );
}

/**
 * „Löschen“ in an agent's chat menu in a side bar (Cloud's and Sender's), for who may: the same
 * question as on its page; its chat open, the page goes to `homePath`.
 */
export function useDeleteAgentAction({
  agent,
  to,
  homePath,
  workspaceId,
  notify,
}: {
  agent: Pick<SenderAgent, 'id' | 'canDelete'> | null;
  /** Its chat's path – open, it is left once it is gone. */
  to: string;
  homePath: string;
  workspaceId: string;
  notify: (message: string, tone?: 'danger') => void;
}): { actions: MenuAction[]; dialog: ReactNode } {
  const [deleting, setDeleting] = useState(false);
  const open = useMatch({ path: to, end: false }) !== null;
  const navigate = useNavigate();
  if (!agent?.canDelete) return { actions: [], dialog: null };
  return {
    actions: [
      { label: 'Löschen', icon: 'delete', tone: 'danger', onSelect: () => setDeleting(true) },
    ],
    dialog: deleting && (
      <DeleteAgentDialog
        agent={agent}
        workspaceId={workspaceId}
        notify={notify}
        onClose={() => setDeleting(false)}
        onDeleted={open ? () => void navigate(homePath, { replace: true }) : undefined}
      />
    ),
  };
}

/**
 * „Umbenennen“ in place, as a presentation's title does it: the name itself turns into a field.
 * Enter or leaving the field saves, Escape cancels; an empty or unchanged name just ends the edit.
 * The lists and its page show the new name at once; a refusal toasts and the old one is back.
 */
export function AgentTitleInput({
  agent,
  onDone,
  className,
}: {
  agent: Pick<CloudAgentSummary, 'id' | 'title'>;
  /** The edit ended; `hadFocus`: by Enter or Escape, not by leaving the field. */
  onDone: (hadFocus: boolean) => void;
  className?: string;
}) {
  const ui = useCloud();
  const rename = useRenameCloudAgent(ui.workspace.id);
  const [title, setTitle] = useState(agent.title);
  const ref = useRef<HTMLInputElement>(null);
  // Enter and the blur that follows must not save twice.
  const settled = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = () => {
    settled.current = true;
    onDone(document.activeElement === ref.current);
  };
  const save = () => {
    if (settled.current) return;
    const parsed = cloudAgentTitleSchema.safeParse({ title });
    if (!parsed.success || parsed.data.title === agent.title) return finish();
    rename.mutate(
      { agentId: agent.id, title: parsed.data.title },
      { onError: (error) => ui.notify(error.message, 'danger') },
    );
    finish();
  };
  return (
    <input
      ref={ref}
      value={title}
      onChange={(event) => setTitle(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          save();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish();
        }
      }}
      // The browser's own menu (paste …) instead of the agent's.
      onContextMenu={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      maxLength={CLOUD_AGENT_TITLE_MAX}
      aria-label="Name des Agenten"
      className={cn(
        '-mx-1 w-full min-w-0 rounded-badge bg-surface-1 px-1 text-fg',
        'ring-2 ring-focus outline-none',
        className,
      )}
    />
  );
}

/**
 * The ⋯ menu of an agent's tile or row, as a presentation's (`DeckActions`): „Umbenennen“ and who
 * sees it, for its owner, and „Löschen“ for who may. The same actions open at `contextAt` for a right click.
 * Nothing for who can do neither – the list it stands in says whose it is.
 */
export function AgentActions({
  agent,
  contextAt,
  onContextClose,
  onRename,
}: {
  agent: CloudAgentSummary;
  contextAt: { x: number; y: number } | null;
  onContextClose: () => void;
  /** „Umbenennen“: the tile or row turns its title into a field. */
  onRename: () => void;
}) {
  const ui = useCloud();
  const [deleting, setDeleting] = useState(false);
  const share = useAgentShare(agent);
  const actions: MenuAction[] = [
    ...(agent.mine
      ? [{ label: 'Umbenennen', icon: 'edit', onSelect: onRename } satisfies MenuAction]
      : []),
    ...share.actions,
    ...(agent.canDelete
      ? [
          {
            label: 'Löschen',
            icon: 'delete',
            tone: 'danger',
            onSelect: () => setDeleting(true),
          } satisfies MenuAction,
        ]
      : []),
  ];
  if (actions.length === 0) return null;
  const label = `Aktionen für „${agent.title}“`;
  return (
    <>
      <Menu label={label} actions={actions} />
      {contextAt && (
        <ContextMenu label={label} actions={actions} at={contextAt} onClose={onContextClose} />
      )}
      {deleting && (
        <DeleteAgentDialog
          agent={agent}
          workspaceId={ui.workspace.id}
          notify={ui.notify}
          onClose={() => setDeleting(false)}
        />
      )}
      {share.dialog}
    </>
  );
}
