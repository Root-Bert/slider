import type { SuccessorChoice } from '@slider/shared';

/** Every workspace has someone chosen. */
export const successorsComplete = (
  choices: readonly SuccessorChoice[] | undefined,
  value: Readonly<Record<string, string>>,
) => (choices ?? []).every((choice) => Boolean(value[choice.workspaceId]));
