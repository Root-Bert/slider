import { attachmentSchema, cloudReference, type Attachment, type CloudNode } from '@slider/shared';

/**
 * Files dragged out of their page – in Cloud's app onto a tab or into the page beside it
 * (`desktop/tabs.mjs`). The other page knows nothing of this one's list, so the drag itself says
 * what it carries.
 */
export const NODES_DRAG = 'application/x-cloud-nodes';
/** The app's tab bar dropped files onto this page's tab: `detail` is what the drag carried. */
export const TAB_DROP_EVENT = 'cloud:drop';

export interface DraggedAcross {
  workspaceId: string;
  ids: string[];
  /** What a chat's field shows when they are dropped on it: references to them, not copies. */
  refs?: Attachment[];
}

export const carryNodes = (
  dataTransfer: DataTransfer,
  workspaceId: string,
  nodes: readonly CloudNode[],
) =>
  dataTransfer.setData(
    NODES_DRAG,
    JSON.stringify({
      workspaceId,
      ids: nodes.map((node) => node.id),
      refs: nodes.map(cloudReference),
    } satisfies DraggedAcross),
  );

export const carriesNodes = (dataTransfer: DataTransfer) => dataTransfer.types.includes(NODES_DRAG);

export function carriedNodes(text: unknown): DraggedAcross | null {
  try {
    const value: unknown = JSON.parse(String(text));
    if (typeof value !== 'object' || value === null) return null;
    const { workspaceId, ids, refs } = value as Partial<DraggedAcross>;
    if (typeof workspaceId !== 'string' || !Array.isArray(ids)) return null;
    const known = ids.filter((id): id is string => typeof id === 'string').slice(0, 500);
    const pointed = attachmentSchema.array().safeParse(refs);
    return known.length
      ? { workspaceId, ids: known, ...(pointed.success && { refs: pointed.data }) }
      : null;
  } catch {
    return null;
  }
}
