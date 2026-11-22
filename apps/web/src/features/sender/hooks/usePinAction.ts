import type { SenderPinKind } from '@slider/shared';
import { usePinSender } from '@/lib/api';
import type { MenuAction } from '@/ui';

/**
 * The menu's „Anpinnen“ / „Lösen“ for a chat or a mail – label and icon as a presentation's
 * (`DeckActions`) and a Cloud folder's; no toast, the row moves. A refusal toasts.
 */
export function usePinAction(
  workspaceId: string,
  notify: (message: string, tone: 'danger') => void,
) {
  const pin = usePinSender(workspaceId);
  return (kind: SenderPinKind, id: string, pinnedAt: string | null | undefined): MenuAction => ({
    label: pinnedAt ? 'Lösen' : 'Anpinnen',
    icon: 'pushPin',
    onSelect: () =>
      pin.mutate(
        { kind, id, pinned: !pinnedAt },
        { onError: (error) => notify(error.message, 'danger') },
      ),
  });
}
