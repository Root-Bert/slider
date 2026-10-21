import type { Workspace } from '@slider/shared';
import { readString, writeString } from '@/lib/storage';

const STORAGE_KEY = 'slider.lastWorkspace';

export const readLastWorkspaceId = (): string | null => readString(STORAGE_KEY);

/** Storage unavailable (private mode) – `/` then opens the first workspace. */
export const rememberWorkspace = (workspaceId: string) => writeString(STORAGE_KEY, workspaceId);

/**
 * The workspace `/` opens: the last used one if the account still belongs to it, else the first.
 * Blocked ones (BER-167) only when there is nothing else – they open nothing but leaving.
 */
export function pickWorkspace(
  workspaces: readonly Workspace[],
  lastId: string | null,
): Workspace | null {
  const open = workspaces.filter((workspace) => !workspace.blocked);
  const candidates = open.length > 0 ? open : workspaces;
  return candidates.find((workspace) => workspace.id === lastId) ?? candidates[0] ?? null;
}
