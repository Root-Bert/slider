import { useNavigate } from 'react-router';
import type { SenderChannel } from '@slider/shared';
import { useMarkSenderChannel } from '@/lib/api';
import type { MenuAction } from '@/ui';

/**
 * The menu's „Als ungelesen markieren“ / „Als gelesen markieren“ for a conversation – as a mail's.
 * Open, it closes (`closeTo`): open, it would be read at once. No toast: the row shows it.
 */
export function useUnreadAction(
  workspaceId: string,
  notify: (message: string, tone: 'danger') => void,
) {
  const mark = useMarkSenderChannel(workspaceId);
  const navigate = useNavigate();
  return (
    channel: Pick<SenderChannel, 'id' | 'unread' | 'mentioned' | 'muted'>,
    closeTo?: string,
  ): MenuAction => {
    const fail = (error: Error) => notify(error.message, 'danger');
    return (channel.unread > 0 && !channel.muted) || channel.mentioned
      ? {
          label: 'Als gelesen markieren',
          key: 'unread',
          icon: 'mail',
          onSelect: () => mark.mutate({ id: channel.id, unread: false }, { onError: fail }),
        }
      : {
          label: 'Als ungelesen markieren',
          key: 'unread',
          icon: 'markEmailUnread',
          onSelect: () => {
            mark.mutate({ id: channel.id, unread: true }, { onError: fail });
            if (closeTo) void navigate(closeTo);
          },
        };
  };
}
