import type { HomeChatEvent, HomeChatInput } from '@slider/shared';
import { postEventStream } from './material-questions';

/**
 * The AI on Slider's start: a message sent with the chat so far, its answer read as it is
 * written (`HomeChatEvent`s). Refusals (no AI key, not a member) throw before anything streams;
 * `signal` aborting stops it on the server.
 */
export const chatHome = (
  workspaceId: string,
  input: HomeChatInput,
  onEvent: (event: HomeChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> =>
  postEventStream(`/workspaces/${encodeURIComponent(workspaceId)}/chat`, input, onEvent, signal);
