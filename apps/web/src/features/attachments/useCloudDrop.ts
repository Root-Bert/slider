import { useState, type DragEvent } from 'react';
import { CLOUD_FOLDER_TYPE, type Attachment } from '@slider/shared';
import { routes } from '@/lib/routes';
import { carriedNodes, carriesNodes, NODES_DRAG } from '@/lib/cloud-drag';
import type { Attachments } from './useAttachments';

/** Where a Cloud file or folder a message points to opens: in Cloud, for whoever may see it. */
export const referenceRoute = (workspaceId: string, attachment: Attachment) =>
  attachment.type === CLOUD_FOLDER_TYPE
    ? routes.cloudFolder(workspaceId, attachment.nodeId ?? attachment.id)
    : routes.cloudFile(workspaceId, attachment.nodeId ?? attachment.id);

/**
 * Cloud files and folders dragged onto a chat's field: put on it as references (`point`) – the
 * message points to them, nothing is copied. Spread `props` on the field's box; `over` while
 * they hover it. Files from one's own computer keep their way (paste, the clip).
 */
export function useCloudDrop(files: Attachments | undefined) {
  const [over, setOver] = useState(false);
  const takes = (event: DragEvent) =>
    !!files?.enabled && files.accept === 'files' && carriesNodes(event.dataTransfer);
  return {
    over,
    props: {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!takes(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'link';
        if (!over) setOver(true);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (!takes(event)) return;
        event.preventDefault();
        setOver(false);
        const carried = carriedNodes(event.dataTransfer.getData(NODES_DRAG));
        if (!files || !carried?.refs?.length || carried.workspaceId !== files.workspaceId) return;
        files.point(carried.refs);
      },
    },
  };
}
