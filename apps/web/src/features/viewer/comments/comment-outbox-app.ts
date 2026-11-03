import type { QueryClient } from '@tanstack/react-query';
import { queryKeys, storeCommentAnswer } from '@/lib/api';
import {
  COMMENT_OUTBOX_VERSION,
  createCommentOutbox,
  sendCommentAction,
  setCommentOutbox,
  type CommentOutbox,
  type CommentOutboxEntry,
  type CommentTransport,
} from '@/lib/api/comment-outbox';
import { browserQueue, COMMENT_STORE } from '../editing/outbox';
import { sendMediaComment } from '../media/hooks/useMediaComment';

/*
 * The app's one comment outbox (`lib/api/comment-outbox.ts`): kept in the browser beside the
 * editor's edits, sending through the API – a recording or pictures the way the composer sends
 * them (`sendMediaComment`) – and storing the answers in the query cache. Created and wired with
 * the editor's outbox (`installEditOutbox`): the same account, connection and tab events.
 */
export function createAppCommentOutbox(
  client: QueryClient,
  session: Pick<CommentTransport, 'currentUser' | 'whoAmI' | 'sessionEnded'>,
): CommentOutbox {
  const outbox = createCommentOutbox(
    browserQueue<CommentOutboxEntry>(COMMENT_STORE, COMMENT_OUTBOX_VERSION),
    {
      ...session,
      send: (deckId, action) =>
        sendCommentAction(deckId, action, (deck, { input, media }) =>
          sendMediaComment(deck, {
            input,
            recording: media?.recording ?? null,
            images: (media?.images ?? []).map((image) => async () => image),
          }),
        ),
      answered: (deckId, action, answer, settled) =>
        storeCommentAnswer(client, deckId, action, answer, settled),
      // What is shown comes back as the server has it.
      refused: (deckId) => void client.invalidateQueries({ queryKey: queryKeys.comments(deckId) }),
      online: () => navigator.onLine !== false,
    },
  );
  setCommentOutbox(outbox);
  return outbox;
}
