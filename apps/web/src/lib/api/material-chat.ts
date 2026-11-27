import type {
  MaterialChatDto,
  MaterialChatEvent,
  MaterialChatInput,
  MaterialChatSummary,
} from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { boardKeys, boardPath, type BoardRef } from './board-owner';
import { postEventStream } from './event-stream';

const chatsPath = (owner: BoardRef) => boardPath(owner, '/material-chats');

/**
 * The AI on the material page: a message sent – into one's chat or a new one (`chatId` null) –,
 * its answer read as it is written (`MaterialChatEvent`s, the chat's id first). Refusals (no AI
 * key, no access) throw before anything streams; `signal` aborting stops it on the server.
 */
export const chatMaterial = (
  owner: BoardRef,
  input: MaterialChatInput,
  onEvent: (event: MaterialChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> => postEventStream(boardPath(owner, '/material-chat'), input, onEvent, signal);

/** One's own chats on the board, latest first. */
export const useMaterialChats = (owner: BoardRef) =>
  useQuery({
    queryKey: boardKeys.chats(owner),
    queryFn: () => api.get<MaterialChatSummary[]>(chatsPath(owner)),
  });

/** One of one's chats with its messages. */
export const getMaterialChat = (owner: BoardRef, chatId: string) =>
  api.get<MaterialChatDto>(`${chatsPath(owner)}/${encodeURIComponent(chatId)}`);

/** „Chat löschen“: gone from the list at once. */
export function useDeleteMaterialChat(owner: BoardRef) {
  const queryClient = useQueryClient();
  const key = boardKeys.chats(owner);
  return useMutation({
    mutationFn: (chatId: string) => api.delete(`${chatsPath(owner)}/${encodeURIComponent(chatId)}`),
    onMutate: (chatId) =>
      queryClient.setQueryData<MaterialChatSummary[]>(key, (all = []) =>
        all.filter((each) => each.id !== chatId),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
