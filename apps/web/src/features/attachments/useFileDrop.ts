import { useEffect, useState, type DragEvent } from 'react';
import { CLOUD_FOLDER_TYPE, type Attachment } from '@slider/shared';
import { routes } from '@/lib/routes';
import { carriedNodes, carriesNodes, NODES_DRAG } from '@/lib/cloud-drag';
import type { Attachments } from './useAttachments';

/** Where a Cloud file or folder a message points to opens: in Cloud, for whoever may see it. */
export const referenceRoute = (workspaceId: string, attachment: Attachment) =>
  attachment.type === CLOUD_FOLDER_TYPE
    ? routes.cloudFolder(workspaceId, attachment.nodeId ?? attachment.id)
    : routes.cloudFile(workspaceId, attachment.nodeId ?? attachment.id);

const carriesFiles = (dataTransfer: DataTransfer) => dataTransfer.types.includes('Files');

/**
 * Files dragged onto a chat – its field, or the whole conversation: from one's own computer they
 * go up and onto the message (as pasted or picked with the clip); Cloud files and folders are put
 * on it as references (`point`) – the message points to them, nothing is copied. Spread `props`
 * on the box that takes them; `over` while they hover it (`FileDropHint`). `onDropped`: after
 * they are put on (the caret into the field, so Enter sends). The innermost box takes a drop
 * alone – the agent's field beside a mail, not the mail's reply too.
 */
export function useFileDrop(files: Attachments | undefined, onDropped?: () => void) {
  const [over, setOver] = useState(false);
  const takes = (event: DragEvent) =>
    !!files?.enabled &&
    (carriesNodes(event.dataTransfer)
      ? files.accept === 'files'
      : carriesFiles(event.dataTransfer));
  // Dropped anywhere – also on a box inside this one that took it alone – or given up: gone.
  useEffect(() => {
    if (!over) return;
    const end = () => setOver(false);
    window.addEventListener('drop', end, true);
    window.addEventListener('dragend', end, true);
    return () => {
      window.removeEventListener('drop', end, true);
      window.removeEventListener('dragend', end, true);
    };
  }, [over]);
  return {
    over,
    props: {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!takes(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = carriesNodes(event.dataTransfer) ? 'link' : 'copy';
        if (!over) setOver(true);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (!files || !takes(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        if (carriesNodes(event.dataTransfer)) {
          const carried = carriedNodes(event.dataTransfer.getData(NODES_DRAG));
          if (!carried?.refs?.length || carried.workspaceId !== files.workspaceId) return;
          files.point(carried.refs);
        } else {
          const dropped = [...event.dataTransfer.files];
          if (dropped.length === 0) return;
          files.add(dropped);
        }
        onDropped?.();
      },
    },
  };
}
