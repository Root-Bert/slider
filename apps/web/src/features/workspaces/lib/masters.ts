import type { WorkspaceMaster } from '@slider/shared';
import { pluralize } from '@/lib/format';

/** "8 Layouts" */
export const metaLine = (master: WorkspaceMaster) =>
  pluralize(master.layouts.length, 'Layout', 'Layouts');

export const layoutName = (layout: WorkspaceMaster['layouts'][number], index: number) =>
  layout.name ?? `Layout ${index + 1}`;

/** Saves the design's file under its name. */
export function downloadMaster(master: WorkspaceMaster) {
  const link = document.createElement('a');
  link.href = master.fileUrl;
  link.download = `${master.name}.${master.fileExtension}`;
  link.click();
}
