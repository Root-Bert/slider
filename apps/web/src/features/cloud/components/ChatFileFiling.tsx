import type { ReactNode } from 'react';
import { CHAT_FILES_FOLDER, type CloudNode } from '@slider/shared';
import { useFolderFilings, usePlaceChatFile } from '@/lib/api';
import { Button } from '@/ui';
import { useCloud } from '../hooks/useCloud';

/**
 * In an area's „Chat-Dateien“: under each file sent in its chat, where the AI would rather put
 * it – „Verschieben“ moves it there in one click. Elsewhere nothing.
 */
export function useChatFileFiling(
  folder: Pick<CloudNode, 'id' | 'name'> | null,
): ((node: CloudNode) => ReactNode) | undefined {
  const ui = useCloud();
  const chatFiles = folder?.name === CHAT_FILES_FOLDER ? folder.id : null;
  const filings = useFolderFilings(chatFiles);
  const place = usePlaceChatFile(ui.workspace.id);
  const known = filings.data;
  if (!chatFiles || !known || Object.keys(known).length === 0) return undefined;
  // A line under its name: the place, then the button – it never pushes the row's columns.
  return function ChatFileFilingLine(node) {
    const filing = known[node.id];
    if (!filing) return null;
    return (
      <span className="flex min-w-0 items-center gap-2 pt-0.5">
        <span
          className="truncate text-xs text-fg-muted"
          title={[`nach ${filing.place}`, filing.why].filter(Boolean).join(' | ')}
        >
          nach {filing.place}
        </span>
        <Button
          variant="soft"
          size="xs"
          disabled={place.isPending}
          // The row's click picks the file; this one does not.
          onClick={(event) => {
            event.stopPropagation();
            place.mutate(
              { attachmentId: filing.attachmentId },
              // Moved, it leaves the list – the page shows it.
              { onError: (error) => ui.notify(error.message, 'danger') },
            );
          }}
        >
          Verschieben
        </Button>
      </span>
    );
  };
}
