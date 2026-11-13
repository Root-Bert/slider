import { useEffect, useRef, useState } from 'react';
import type { WorkspaceMaster } from '@slider/shared';
import { useRenameWorkspaceMaster } from '@/lib/api';
import { cn, type ShowToast } from '@/ui';

const MAX_NAME_LENGTH = 200;

/**
 * "Umbenennen" in place, like a review's title: the name turns into an input. Enter or leaving
 * the field saves, Escape cancels; an empty or unchanged name just ends the edit. Only renames
 * in Slider – the file keeps its own name.
 */
export function MasterNameInput({
  workspaceId,
  master,
  onDone,
  onNotify,
  className,
}: {
  workspaceId: string;
  master: WorkspaceMaster;
  onDone: () => void;
  onNotify: ShowToast;
  className?: string;
}) {
  const [name, setName] = useState(master.name);
  const rename = useRenameWorkspaceMaster(workspaceId);
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
    if (settled.current || rename.isPending) return;
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === master.name) return finish();
    rename.mutate(
      { masterId: master.id, name: trimmed },
      {
        onSuccess: finish,
        onError: (error) => {
          onNotify(error.message, 'danger');
          ref.current?.focus();
        },
      },
    );
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
          save();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish();
        }
      }}
      // The browser's own menu (paste …) instead of the design's actions.
      onContextMenu={(event) => event.stopPropagation()}
      // A click into the field must not open the design.
      onClick={(event) => event.stopPropagation()}
      readOnly={rename.isPending}
      maxLength={MAX_NAME_LENGTH}
      aria-label="Name der Vorlage"
      className={cn(
        '-mx-1 w-full min-w-0 rounded-badge bg-surface-1 px-1 text-fg',
        'ring-2 ring-focus outline-none',
        className,
      )}
    />
  );
}
