import type { SenderChannel } from '@slider/shared';
import { useMuteSenderChannel } from '@/lib/api';
import type { MenuAction } from '@/ui';

/**
 * The menu's „Stummschalten“ / „Laut schalten“ for a conversation, beside „Anpinnen“: no count
 * on the app's icon, no notification – „@“ with one's name still tells. No toast: the row dims.
 */
export function useMuteAction(
  workspaceId: string,
  notify: (message: string, tone: 'danger') => void,
) {
  const mute = useMuteSenderChannel(workspaceId);
  return (channel: Pick<SenderChannel, 'id' | 'muted'>): MenuAction => ({
    label: channel.muted ? 'Laut schalten' : 'Stummschalten',
    key: 'mute',
    icon: channel.muted ? 'notifications' : 'notificationsOff',
    onSelect: () =>
      mute.mutate(
        { id: channel.id, muted: !channel.muted },
        { onError: (error) => notify(error.message, 'danger') },
      ),
  });
}
