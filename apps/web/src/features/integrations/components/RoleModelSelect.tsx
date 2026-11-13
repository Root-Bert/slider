import { Select } from '@/ui';
import { AI_MODEL_ROLES, createModelOptions } from '../lib/ai-models';

/**
 * The pick of the AI's model to create decks on or for quick requests – for a key, the
 * instance's key in a workspace, or a workspace apart. First the model it falls back to
 * (`standardLabel` as shown, `standard` its id), then what the service offers. `current`: its
 * own model, `null` none – the fallback applies; picking that gives `null`.
 */
export function RoleModelSelect({
  role,
  where,
  offered,
  standard,
  standardLabel,
  current,
  disabled,
  className,
  onPick,
}: {
  role: 'create' | 'quick';
  /** Ends the label: `mit Anthropic`, `in Workspace X`. */
  where: string;
  offered: readonly { id: string; name: string }[];
  standard: string;
  standardLabel: string;
  current: string | null;
  disabled: boolean;
  className?: string;
  onPick: (model: string | null) => void;
}) {
  return (
    <Select
      className={className}
      aria-label={`Modell für ${AI_MODEL_ROLES[role].label} ${where}`}
      size="sm"
      value={current ?? ''}
      disabled={disabled}
      options={createModelOptions(offered, standardLabel, standard, current)}
      onChange={(value) => onPick(value || null)}
    />
  );
}
