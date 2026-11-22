import { useId, useState, type FormEvent } from 'react';
import type { CloudArea, CloudAreaColor, CloudAreaVisibility } from '@slider/shared';
import { useCreateCloudArea, useUpdateCloudArea } from '@/lib/api';
import { ConfirmDialog, TextField, Toggle } from '@/ui';
import { isWorkspaceOwn } from '../lib/areas';
import { AREA_COLORS, AreaColorPicker } from './AreaColorPicker';

/**
 * „Neuer Bereich“ and „Bereich bearbeiten“: a name, what it is for, its colour, and whether
 * everyone in the workspace sees it or only its people.
 */
export function AreaDialog({
  workspaceId,
  area,
  parent,
  takenColors,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  /** Absent: a new one. */
  area?: CloudArea;
  /** A new one goes under this area. */
  parent?: CloudArea;
  /** Colours other areas wear – a new one starts with one that is free. */
  takenColors: readonly CloudAreaColor[];
  onClose: () => void;
  onSaved: (area: CloudArea, created: boolean) => void;
}) {
  const formId = useId();
  const colorLabel = useId();
  // The workspace's own two keep their names and who sees them.
  const fixed = !!area && isWorkspaceOwn(area);
  const create = useCreateCloudArea(workspaceId);
  const update = useUpdateCloudArea(workspaceId);
  const free = (['cyan', 'green', 'violet', 'yellow', 'red', 'blue'] as CloudAreaColor[])
    .concat(AREA_COLORS.map((each) => each.color))
    .find((color) => !takenColors.includes(color));
  const [name, setName] = useState(area?.name ?? '');
  const [description, setDescription] = useState(area?.description ?? '');
  const [color, setColor] = useState<CloudAreaColor>(area?.color ?? free ?? 'cyan');
  const [visibility, setVisibility] = useState<CloudAreaVisibility>(
    area?.visibility ?? 'workspace',
  );
  const pending = create.isPending || update.isPending;
  const error = create.error?.message ?? update.error?.message;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const input = { name: name.trim(), description: description.trim(), color, visibility };
    if (!input.name || pending) return;
    if (area) {
      update.mutate({ id: area.id, ...input }, { onSuccess: (saved) => onSaved(saved, false) });
    } else {
      create.mutate(
        { ...input, parentId: parent?.id ?? null },
        { onSuccess: (saved) => onSaved(saved, true) },
      );
    }
  };

  return (
    <ConfirmDialog
      onClose={onClose}
      title={area ? 'Bereich bearbeiten' : parent ? 'Neuer Unterbereich' : 'Neuer Bereich'}
      description={
        area
          ? undefined
          : parent
            ? `Liegt unter „${parent.name}“, mit eigener Farbe und eigenen Leuten.`
            : 'Ein Ort für ein Team: mit Farbe, Leuten und allem, woran es arbeitet.'
      }
      tone="primary"
      confirmLabel={area ? 'Sichern' : 'Anlegen'}
      form={formId}
      pending={pending}
      confirmDisabled={!name.trim()}
      error={error}
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-4">
        {/* The workspace's own two: their names and who sees them stay. */}
        {!fixed && (
          <TextField
            label="Name"
            placeholder="z. B. Vertrieb"
            maxLength={60}
            autoFocus
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
        <TextField
          label="Wofür"
          placeholder="z. B. Angebote, Pitches und Verträge"
          maxLength={200}
          autoFocus={fixed}
          autoComplete="off"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        {/* The workspace's own shows the workspace's mark, not a colour. */}
        {!area?.root && (
          <div className="flex flex-col gap-2">
            <span id={colorLabel} className="text-xs text-fg-subtle">
              Farbe
            </span>
            <AreaColorPicker
              value={color}
              onChange={(next) => next && setColor(next)}
              labelledBy={colorLabel}
            />
          </div>
        )}
        {!fixed && (
          <Toggle
            checked={visibility === 'members'}
            onChange={(only) => setVisibility(only ? 'members' : 'workspace')}
            label="Nur für die Personen des Bereichs"
            description="Aus: alle im Workspace sehen den Bereich. An: nur wer dazugehört und die Admins."
          />
        )}
      </form>
    </ConfirmDialog>
  );
}
