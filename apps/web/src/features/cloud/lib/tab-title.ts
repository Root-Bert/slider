/**
 * `<page> | <workspace> | Cloud` – the workspace once: its own area's pages are already named
 * by it („Mein Workspace | Chat | Cloud“, not „Mein Workspace | Chat | Mein Workspace | Cloud“).
 */
export function tabTitle(page: string, workspace: string, app: string): string {
  const named = page === workspace || page.startsWith(`${workspace} | `);
  return [page, ...(named ? [] : [workspace]), app].join(' | ');
}
