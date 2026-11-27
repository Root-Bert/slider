import { useSearchParams } from 'react-router';
import type { CloudArea } from '@slider/shared';

/** Which of the overview's tabs is open (`?von=`): none given, one's own („Meine“). */
export const SCOPE_PARAM = 'von';
export const ALL_SCOPE = 'alle';
export const OWN_SCOPE = 'meine';
export const WORKSPACE_SCOPE = 'workspace';
/** Where „Dateien“, „Agenten“ and „Aufgaben“ land: one's own. */
export const DEFAULT_SCOPE = OWN_SCOPE;

export interface ScopeTab {
  key: string;
  label: string;
  hint?: string;
}

/** The open tab of „Agenten“ or „Aufgaben“: „alle“, „meine“, „workspace“ or an area's id. */
export function useScope() {
  const [params] = useSearchParams();
  return params.get(SCOPE_PARAM) ?? DEFAULT_SCOPE;
}

/**
 * The project open in an area's „Aufgaben“ (`?projekt=`): none – or one not of that area – its
 * „Allgemein“. Kept through a switch of the overview's tabs; an area without it falls back.
 */
const PROJECT_PARAM = 'projekt';
export function useProjectParam() {
  const [params, setParams] = useSearchParams();
  const set = (projectId: string | null) =>
    setParams(
      (now) => {
        const after = new URLSearchParams(now);
        if (projectId) after.set(PROJECT_PARAM, projectId);
        else after.delete(PROJECT_PARAM);
        return after;
      },
      { replace: true },
    );
  return [params.get(PROJECT_PARAM), set] as const;
}

/** „Mir zugeteilt“ on „Aufgaben“ (`?zugeteilt`): on or off, for every tab – as Post's „Ungelesen“. */
const ASSIGNED_PARAM = 'zugeteilt';
export function useAssignedOnly() {
  const [params, setParams] = useSearchParams();
  const on = params.has(ASSIGNED_PARAM);
  const set = (next: boolean) =>
    setParams(
      (now) => {
        const after = new URLSearchParams(now);
        if (next) after.set(ASSIGNED_PARAM, '');
        else after.delete(ASSIGNED_PARAM);
        return after;
      },
      { replace: true },
    );
  return [on, set] as const;
}

/**
 * The overview's tabs: „Alle“, „Meine“, „Workspace“, then every area one sees – as „Post“ shows
 * every mailbox; the workspace's own is „Workspace“. An area gone falls back to „Meine“.
 */
export function scopeTabs(
  areas: readonly CloudArea[],
  scope: string,
  hints: { own: string; workspace: string },
  { all = true }: { all?: boolean } = {},
) {
  const tabs: ScopeTab[] = [
    ...(all ? [{ key: ALL_SCOPE, label: 'Alle' }] : []),
    { key: OWN_SCOPE, label: 'Meine', hint: hints.own },
    { key: WORKSPACE_SCOPE, label: 'Workspace', hint: hints.workspace },
    ...areas.filter((area) => !area.root).map((area) => ({ key: area.id, label: area.name })),
  ];
  const current = tabs.some((tab) => tab.key === scope) ? scope : DEFAULT_SCOPE;
  return { tabs, current };
}
