import { useEffect, useRef, useState } from 'react';
import { cloudBaseName, cloudNameSchema, type CloudNode } from '@slider/shared';
import { cn } from '@/ui';
import { useCloud } from '../hooks/useCloud';

/**
 * „Umbenennen“ in place, as a presentation's title does it: the name itself turns into a field.
 * Enter or leaving the field saves, Escape cancels; an empty or unchanged name just ends the
 * edit – so a folder just made, its field still empty, stays „Neuer Ordner“. A file's name is
 * marked without its ending, as the Finder does – typing keeps what kind of file it is. The list
 * shows the new name at once; a refusal toasts and the old one is back.
 */
export function NodeNameInput({
  node,
  onDone,
  className,
}: {
  node: CloudNode;
  /** The edit ends; `hadFocus`: by Enter or Escape, not by leaving the field. */
  onDone?: (hadFocus: boolean) => void;
  className?: string;
}) {
  const ui = useCloud();
  // A folder just made: the name it got is only the hint, typed over from the first key.
  const fresh = ui.renaming?.id === node.id && ui.renaming.fresh === true;
  const [name, setName] = useState(fresh ? '' : node.name);
  const ref = useRef<HTMLInputElement>(null);
  // Enter and the blur that follows must not save twice.
  const settled = useRef(false);

  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(
      0,
      node.kind === 'file' ? cloudBaseName(node.name).length : node.name.length,
    );
    // Only when the field appears: the name it starts with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (newName?: string) => {
    settled.current = true;
    onDone?.(document.activeElement === ref.current);
    ui.endRename(node, newName);
  };

  const save = () => {
    if (settled.current) return;
    if (name.trim() === '' || name.trim() === node.name) return finish();
    const parsed = cloudNameSchema.safeParse(name);
    if (!parsed.success) {
      ui.notify(parsed.error.issues[0]?.message ?? 'Dieser Name geht nicht.', 'danger');
      // Left the field with a name that cannot be: the old one stays.
      if (document.activeElement !== ref.current) finish();
      return;
    }
    finish(parsed.data);
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
      // The field is its own: a click in it neither picks the item nor starts dragging a box.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      // The browser's own menu (paste …) instead of the item's actions.
      onContextMenu={(event) => event.stopPropagation()}
      maxLength={200}
      placeholder={fresh ? node.name : undefined}
      aria-label={node.kind === 'folder' ? 'Name des Ordners' : 'Name der Datei'}
      className={cn(
        'relative z-(--z-raised) -mx-1 w-full min-w-0 rounded-badge bg-surface-1 px-1 text-fg',
        'ring-2 ring-focus outline-none',
        className,
      )}
    />
  );
}
