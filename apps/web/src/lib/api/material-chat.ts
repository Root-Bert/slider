import type { MaterialChatEvent, MaterialChatInput } from '@slider/shared';
import { postEventStream } from './material-questions';

/**
 * The AI on the material page: the chat so far sent, its answer read as it is written
 * (`MaterialChatEvent`s). Refusals (no AI key, no access) throw before anything streams;
 * `signal` aborting stops it on the server.
 */
export const chatMaterial = (
  deckId: string,
  input: MaterialChatInput,
  onEvent: (event: MaterialChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> =>
  postEventStream(`/decks/${encodeURIComponent(deckId)}/material-chat`, input, onEvent, signal);
