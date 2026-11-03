import type { EditableElement } from '@slider/shared';
import { Select } from '@/ui';
import { PLACEHOLDER_LABELS } from './placeholder-labels';
import { useTemplate } from './useTemplate';

/**
 * In a template being designed, atop a picked picture's panel: whether it is where a slide made
 * from the layout puts a picture, or stays as it is on every such slide. A text box needs no
 * choice – what is typed into it is what its placeholder asks for (`layoutPlaceholders`).
 */
export function PlaceholderControl({ element }: { element: EditableElement }) {
  const { template, update } = useTemplate();
  if (!template || element.kind !== 'image') return null;
  const current = template.placeholders[element.id] ?? '';
  return (
    <label className="flex items-center gap-3 text-xs text-fg-muted">
      Platzhalter
      <Select
        size="sm"
        value={current}
        onChange={(value) => {
          const { [element.id]: _, ...rest } = template.placeholders;
          update({ placeholders: value === 'picture' ? { ...rest, [element.id]: value } : rest });
        }}
        options={[
          { value: '', label: 'Keiner – fester Inhalt' },
          { value: 'picture', label: PLACEHOLDER_LABELS.picture },
        ]}
        className="min-w-0 flex-1"
      />
    </label>
  );
}
