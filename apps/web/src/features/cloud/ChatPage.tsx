import { useParams } from 'react-router';
import { Conversation, useSenderOrNull } from '@/features/sender';
import { useCloud } from './hooks/useCloud';
import { tabTitle } from './lib/tab-title';

/**
 * A group or direct conversation, in Cloud – from the side bar's list under the areas. As high
 * as the window leaves under the app's header, its messages scroll inside it. The tab is named
 * like Cloud's other pages: `<conversation> | <workspace> | Cloud`.
 */
export function Component() {
  const { channelId = '' } = useParams();
  const ui = useCloud();
  const name = useSenderOrNull()?.channel(channelId)?.name || 'Chat';
  return (
    <div className="flex h-[calc(100dvh-104px)] flex-col pb-6">
      <title>{tabTitle(name, ui.workspace.name, 'Cloud')}</title>
      <Conversation channelId={channelId} />
    </div>
  );
}
