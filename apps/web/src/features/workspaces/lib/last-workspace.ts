import type { Workspace } from '@slider/shared';

const STORAGE_KEY = 'slider.lastWorkspace';

export function readLastWorkspaceId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function rememberWorkspace(workspaceId: string) {
  try {
    localStorage.setItem(STORAGE_KEY, workspaceId);
  } catch {
    // Storage unavailable (private mode) – `/` then opens the first workspace.
  }
}

/** The workspace `/` opens: the last used one if the account still belongs to it, else the first. */
export function pickWorkspace(
  workspaces: readonly Workspace[],
  lastId: string | null,
): Workspace | null {
  return workspaces.find((workspace) => workspace.id === lastId) ?? workspaces[0] ?? null;
}
