import type {
  MaterialChatDto,
  MaterialChatEvent,
  MaterialChatInput,
  MaterialChatSummary,
} from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { queryKeys } from './keys';
import { postEventStream } from './material-questions';

const chatsPath = (deckId: string) => `/decks/${encodeURIComponent(deckId)}/material-chats`;

/**
 * The AI on the material page: a message sent – into one's chat or a new one (`chatId` null) –,
 * its answer read as it is written (`MaterialChatEvent`s, the chat's id first). Refusals (no AI
 * key, no access) throw before anything streams; `signal` aborting stops it on the server.
 */
export const chatMaterial = (
  deckId: string,
  input: MaterialChatInput,
  onEvent: (event: MaterialChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> =>
  postEventStream(`/decks/${encodeURIComponent(deckId)}/material-chat`, input, onEvent, signal);

/** One's own chats on the deck, latest first. */
export const useMaterialChats = (deckId: string) =>
  useQuery({
    queryKey: queryKeys.materialChats(deckId),
    queryFn: () => api.get<MaterialChatSummary[]>(chatsPath(deckId)),
  });

/** One of one's chats with its messages. */
export const getMaterialChat = (deckId: string, chatId: string) =>
  api.get<MaterialChatDto>(`${chatsPath(deckId)}/${encodeURIComponent(chatId)}`);

/** „Chat löschen“: gone from the list at once. */
export function useDeleteMaterialChat(deckId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.materialChats(deckId);
  return useMutation({
    mutationFn: (chatId: string) =>
      api.delete(`${chatsPath(deckId)}/${encodeURIComponent(chatId)}`),
    onMutate: (chatId) =>
      queryClient.setQueryData<MaterialChatSummary[]>(key, (all = []) =>
        all.filter((each) => each.id !== chatId),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
