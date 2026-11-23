import { useSearchParams } from 'react-router';
import type { CloudArea } from '@slider/shared';

/** Which of the overview's tabs is open (`?von=`): none given, all of them. */
export const SCOPE_PARAM = 'von';
export const ALL_SCOPE = 'alle';
export const OWN_SCOPE = 'meine';
export const WORKSPACE_SCOPE = 'workspace';

export interface ScopeTab {
  key: string;
  label: string;
  hint?: string;
}

/** The open tab of „Agenten“ or „Aufgaben“: „alle“, „meine“, „workspace“ or an area's id. */
export function useScope() {
  const [params] = useSearchParams();
  return params.get(SCOPE_PARAM) ?? ALL_SCOPE;
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
 * every mailbox; the workspace's own is „Workspace“. An area gone falls back to „Alle“.
 */
export function scopeTabs(
  areas: readonly CloudArea[],
  scope: string,
  hints: { own: string; workspace: string },
) {
  const tabs: ScopeTab[] = [
    { key: ALL_SCOPE, label: 'Alle' },
    { key: OWN_SCOPE, label: 'Meine', hint: hints.own },
    { key: WORKSPACE_SCOPE, label: 'Workspace', hint: hints.workspace },
    ...areas.filter((area) => !area.root).map((area) => ({ key: area.id, label: area.name })),
  ];
  const current = tabs.some((tab) => tab.key === scope) ? scope : ALL_SCOPE;
  return { tabs, current };
}
