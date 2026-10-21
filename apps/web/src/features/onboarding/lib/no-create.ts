import type { Workspace } from '@slider/shared';
import { ROLE_LABELS } from '@/features/workspaces';

/** Why `/neu` is closed: names the actual role – reviewers comment, viewers only look. */
export function noCreateMessage({ role, name }: Pick<Workspace, 'role' | 'name'>): string {
  const can = role === 'viewer' ? 'Reviews nur ansehen' : 'Reviews ansehen und kommentieren';
  return `Als ${ROLE_LABELS[role]} in „${name}“ kannst du ${can}, aber keine anlegen. Bitte einen Admin, dich zum Mitglied zu machen.`;
}
