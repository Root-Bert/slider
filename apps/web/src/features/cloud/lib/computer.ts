import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

/**
 * What Cloud's app adds on a computer whose Finder shows the files (`desktop/cloud`): a file
 * opens where it lies there, in its own program – the system fetches it first and takes what the
 * program saves back up. In the browser `window.cloudDesktop` does not exist.
 */
export type PlacedApp = 'slider' | 'writer' | 'reader' | 'sender';
export type AppWhere = 'tab' | 'own';
/** An app the computer's Cloud does not know yet (an older one) is missing. */
export type CloudApps = Partial<Record<PlacedApp, { where: AppWhere; installed: boolean }>>;

interface CloudBridge {
  /** The app's window shows Slider's and Writer's pages in its tabs. Not in apps from before it. */
  tabs?: boolean;
  /**
   * Where each app's pages open there („Apps“ in the settings): in the window's tabs (`tab`) or
   * in the app of its own (`own`, if `installed`). Not in apps from before it.
   */
  apps?(): Promise<CloudApps | null>;
  setApp?(app: PlacedApp, where: AppWhere): Promise<CloudApps | null>;
  /** Opens the file in its program; `false` when the computer has no place for it (yet). */
  open(workspaceId: string, nodeId: string): Promise<boolean>;
  /** The ids of the workspace's files whose content is on this computer. */
  local(workspaceId: string): Promise<string[]>;
  /** Shows the file where it lies on the computer. Not in apps from before it. */
  reveal?(workspaceId: string, nodeId: string): Promise<boolean>;
  /**
   * The file's content leaves this computer – it stays in the files and is fetched again when
   * opened. `false` when the computer keeps it (changed and not sent yet). Not in older apps.
   */
  free?(workspaceId: string, nodeId: string): Promise<boolean>;
}

declare global {
  interface Window {
    cloudDesktop?: CloudBridge;
  }
}

export const cloudBridge = (): CloudBridge | null =>
  typeof window === 'undefined' ? null : (window.cloudDesktop ?? null);

/** Cloud's app lets the person say where each app's pages open (not the browser, not apps before it). */
export const canPlaceApps = () => typeof cloudBridge()?.apps === 'function';

const NONE: ReadonlySet<string> = new Set();
const key = (workspaceId: string) => ['cloud-computer', workspaceId];

/** The files that are on this computer; none in the browser. */
export function useOnThisComputer(workspaceId: string): ReadonlySet<string> {
  const bridge = cloudBridge();
  const { data } = useQuery({
    queryKey: key(workspaceId),
    queryFn: async () => new Set(await bridge?.local(workspaceId)),
    enabled: !!bridge,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
  return data ?? NONE;
}

/** What the computer's file manager is called, for „Im … zeigen“. */
export const fileManagerName = (): string => {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Win/i.test(agent)) return 'Explorer';
  return /Mac/i.test(agent) ? 'Finder' : 'Dateimanager';
};

/** Asks again soon: a file just opened is being fetched. */
export function useComputerChanged(workspaceId: string) {
  const client = useQueryClient();
  return useCallback(() => {
    for (const after of [1500, 5000]) {
      setTimeout(() => void client.invalidateQueries({ queryKey: key(workspaceId) }), after);
    }
  }, [client, workspaceId]);
}
