import { useState, type DragEvent } from 'react';

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');

/**
 * Files dragged from the desktop onto an element: spread `handlers` on it; `dragOver` while files
 * are over it (not text or links dragged inside the page). `onDrop` gets every file dropped.
 */
export function useFileDrop(onDrop: (files: File[]) => void) {
  const [dragOver, setDragOver] = useState(false);
  const handlers = {
    onDragEnter: (event: DragEvent) => {
      if (hasFiles(event)) setDragOver(true);
    },
    onDragOver: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setDragOver(false);
      onDrop([...event.dataTransfer.files]);
    },
  };
  return { dragOver, handlers };
}
