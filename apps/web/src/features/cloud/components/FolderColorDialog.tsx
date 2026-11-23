import { useId, useState } from 'react';
import type { CloudArea, CloudAreaColor, CloudNode } from '@slider/shared';
import { ConfirmDialog } from '@/ui';
import { folderColor } from '../lib/areas';
import { AreaColorPicker } from './AreaColorPicker';

/**
 * „Farbe“: a folder's colour – none (its area's, or the plain folder), one on offer, or one of
 * one's own.
 */
export function FolderColorDialog({
  node,
  areas,
  onClose,
  onPick,
}: {
  node: CloudNode;
  areas: readonly CloudArea[] | undefined;
  onClose: () => void;
  onPick: (color: CloudAreaColor | null) => void;
}) {
  const label = useId();
  const [color, setColor] = useState<CloudAreaColor | null>(node.color ?? null);
  return (
    <ConfirmDialog
      onClose={onClose}
      title="Farbe des Ordners"
      tone="primary"
      confirmLabel="Sichern"
      onConfirm={() => onPick(color)}
    >
      <div className="flex flex-col gap-2">
        <span id={label} className="truncate text-xs text-fg-subtle">
          {node.name}
        </span>
        <AreaColorPicker
          value={color}
          onChange={setColor}
          labelledBy={label}
          none
          noneColor={folderColor({ ...node, color: null }, areas)}
        />
      </div>
    </ConfirmDialog>
  );
}
