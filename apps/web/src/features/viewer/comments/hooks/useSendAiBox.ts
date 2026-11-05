import { threadForRequest, type AiProposal } from '@slider/shared';
import { useQueryClient } from '@tanstack/react-query';
import type { Draft } from '../../state/viewer-state';
import { queryKeys, useCancelProposal, useCreateComment } from '@/lib/api';
import { useAskAi } from '../../editing/hooks/useAskAi';
import { useViewerData } from '../../state/viewer-data';
import { useViewerDispatch } from '../../state/viewer-state';
import { useViewerToast } from '../../state/viewer-toast';
import { replyInput } from '../lib/replies';

/**
 * Sends a box for the AI: a comment on its area, given to the AI at once (as ⌘↵ does). `close`:
 * its field goes with it – not when something else took its place already (sent as it gave way).
 */
export type SendAiBox = (draft: Draft, body: string, close?: boolean) => void;

/** The request the AI is at work on in a thread (its root's or a reply's), if any. */
export function runningIn(
  proposals: readonly AiProposal[] | undefined,
  commentIds: ReadonlySet<string>,
): AiProposal | null {
  return (
    proposals?.find(
      (proposal) =>
        proposal.status === 'running' &&
        proposal.commentId !== null &&
        commentIds.has(proposal.commentId),
    ) ?? null
  );
}

/**
 * Sending a box for the AI – from the composer that stays (the box's field goes at once, no wait
 * for the server): the comment, then the AI asked on it; its pin shows the AI at work. A box
 * adding to a request still at work (`Draft.aiThreadId`) is a reply in its thread: the AI is
 * stopped and asked again with it, as an addition said aloud is (voice `finish`). So is a box over
 * what an open thread on the slide is about already (`threadForRequest`, anyone's): no second pin
 * on the same thing – the thread is the AI's context.
 */
export function useSendAiBox(): SendAiBox {
  const { deck, slides, threads, viewer } = useViewerData();
  const dispatch = useViewerDispatch();
  const queryClient = useQueryClient();
  const createComment = useCreateComment(deck.id, viewer.author);
  const cancel = useCancelProposal(deck.id);
  const ai = useAskAi();
  const toast = useViewerToast();
  const sameThreadAs = (draft: Draft) => {
    const shapes = slides.find((slide) => slide.id === draft.slideId)?.shapes;
    const root = threadForRequest(
      threads.map((each) => each.root),
      draft.slideId,
      draft.anchor,
      shapes,
    );
    return root ? threads.find((each) => each.id === root.id) : undefined;
  };
  return (draft, body, close = true) => {
    if (close) dispatch({ type: 'draftSubmitted' });
    const thread = draft.aiThreadId
      ? threads.find((each) => each.id === draft.aiThreadId)
      : sameThreadAs(draft);
    if (thread) {
      const running = runningIn(
        queryClient.getQueryData<AiProposal[]>(queryKeys.proposals(deck.id)),
        new Set([thread.root.id, ...thread.replies.map((reply) => reply.id)]),
      );
      createComment
        .mutateAsync(replyInput(thread.root, body))
        .then(async (reply) => {
          // Done meanwhile: the addition is asked on top of its change.
          if (running) await cancel.mutateAsync(running.id).catch(() => undefined);
          ai.ask(reply);
        })
        .catch((error: Error) => toast(`Nicht gesendet: ${error.message}`, 'danger'));
      return;
    }
    createComment
      .mutateAsync({ slideId: draft.slideId, parentId: null, body, anchor: draft.anchor })
      .then((comment) => ai.ask(comment))
      .catch((error: Error) => toast(`Nicht gesendet: ${error.message}`, 'danger'));
  };
}
