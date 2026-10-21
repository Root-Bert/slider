import { useQueryClient } from '@tanstack/react-query';
import type { NextcloudConnection } from '@slider/shared';
import { pollNextcloudLogin, startNextcloudLogin, workspaceKeys } from '@/lib/api';
import { useNextcloudFlow } from './useNextcloudFlow';

export { NEXTCLOUD_POLL_MS, type NextcloudConnectState } from './useNextcloudFlow';

/** Connects a Nextcloud account for file access with Login Flow v2 (BER-135). */
export function useNextcloudConnect(onConnected: (connection: NextcloudConnection) => void) {
  const queryClient = useQueryClient();
  return useNextcloudFlow(startNextcloudLogin, pollNextcloudLogin, async (result) => {
    await queryClient.invalidateQueries({ queryKey: workspaceKeys.nextcloud });
    onConnected(result.connection);
  });
}
