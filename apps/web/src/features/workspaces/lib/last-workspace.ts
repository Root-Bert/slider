import type { Workspace } from '@slider/shared';
import { readString, writeString } from '@/lib/storage';

const STORAGE_KEY = 'slider.lastWorkspace';

export const readLastWorkspaceId = (): string | null => readString(STORAGE_KEY);

/** Storage unavailable (private mode) – `/` then opens the first workspace. */
export const rememberWorkspace = (workspaceId: string) => writeString(STORAGE_KEY, workspaceId);

/** The workspace `/` opens: the last used one if the account still belongs to it, else the first. */
export function pickWorkspace(
  workspaces: readonly Workspace[],
  lastId: string | null,
): Workspace | null {
  return workspaces.find((workspace) => workspace.id === lastId) ?? workspaces[0] ?? null;
}
