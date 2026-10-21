import type { SuccessorChoice } from '@slider/shared';
import { ROLE_LABELS } from '@/features/workspaces';
import { Select } from '@/ui';

/**
 * Deleting oneself where one is the only admin of an organisation with others: choose who becomes
 * admin there (BER-145). One dropdown per organisation, nothing preselected.
 */
export function SuccessorPicker({
  choices,
  value,
  onChange,
}: {
  choices: readonly SuccessorChoice[];
  value: Readonly<Record<string, string>>;
  onChange: (value: Record<string, string>) => void;
}) {
  if (choices.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 text-left">
      <p className="text-sm text-fg-muted">
        Du bist einziger Admin{' '}
        {choices.length === 1 ? 'dieser Organisation' : 'dieser Organisationen'}. Wähle, wer dort
        Admin wird – die Person bekommt auch deine Präsentationen dort.
      </p>
      {choices.map((choice) => {
        const id = `successor-${choice.workspaceId}`;
        return (
          <label key={choice.workspaceId} htmlFor={id} className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg">{choice.workspaceName}</span>
            <Select
              id={id}
              value={value[choice.workspaceId] ?? ''}
              onChange={(userId) => onChange({ ...value, [choice.workspaceId]: userId })}
              options={[
                { value: '', label: 'Bitte wählen …' },
                ...choice.candidates.map((candidate) => ({
                  value: candidate.userId,
                  label: `${candidate.name} (${ROLE_LABELS[candidate.role]})`,
                })),
              ]}
            />
          </label>
        );
      })}
    </div>
  );
}
