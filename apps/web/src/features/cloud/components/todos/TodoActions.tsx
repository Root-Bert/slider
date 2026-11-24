import { useState } from 'react';
import type { Todo } from '@slider/shared';
import { useDeleteTodo } from '@/lib/api';
import { ConfirmDialog, ContextMenu, Menu, type MenuAction } from '@/ui';
import { useCloud } from '../../hooks/useCloud';

/**
 * A to-do's actions, as an agent's (`AgentActions`): „Löschen“ for who may change it. As the ⋯ of
 * its open panel (`button`) and at `contextAt` for a right click on its tile or row. Nothing for
 * who may not – the browser's own menu then.
 */
export function TodoActions({
  todo,
  button = false,
  contextAt = null,
  onContextClose,
}: {
  todo: Todo;
  button?: boolean;
  contextAt?: { x: number; y: number } | null;
  onContextClose?: () => void;
}) {
  const ui = useCloud();
  const remove = useDeleteTodo(ui.workspace.id);
  const [deleting, setDeleting] = useState(false);
  if (!todo.canEdit) return null;
  const actions: MenuAction[] = [
    { label: 'Löschen', icon: 'delete', tone: 'danger', onSelect: () => setDeleting(true) },
  ];
  return (
    <>
      {button && <Menu label="Mehr zur Aufgabe" actions={actions} />}
      {contextAt && onContextClose && (
        <ContextMenu
          label={`Aktionen für „${todo.title}“`}
          actions={actions}
          at={contextAt}
          onClose={onContextClose}
        />
      )}
      {deleting && (
        <ConfirmDialog
          onClose={() => setDeleting(false)}
          title={`„${todo.title}“ löschen?`}
          description="Die Aufgabe ist dann für alle weg."
          confirmLabel="Löschen"
          confirmIcon="delete"
          onConfirm={() => {
            setDeleting(false);
            remove.mutateAsync(todo.id).then(
              () => ui.notify(`„${todo.title}“ gelöscht`),
              (error: Error) => ui.notify(error.message, 'danger'),
            );
          }}
        />
      )}
    </>
  );
}
