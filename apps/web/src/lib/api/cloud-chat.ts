import type { CloudChatEvent, CloudChatInput } from '@slider/shared';
import { postEventStream } from './event-stream';

/**
 * The AI in Cloud: a message sent with the chat so far, its answer read as it is written
 * (`CloudChatEvent`s). Refusals (no AI key, not a member) throw before anything streams;
 * `signal` aborting stops it on the server.
 */
export const chatCloud = (
  workspaceId: string,
  input: CloudChatInput,
  onEvent: (event: CloudChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> =>
  postEventStream(
    `/workspaces/${encodeURIComponent(workspaceId)}/cloud/chat`,
    input,
    onEvent,
    signal,
  );
