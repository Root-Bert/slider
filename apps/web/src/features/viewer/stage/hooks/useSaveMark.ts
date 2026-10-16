import type { UpdateCommentInput } from '@slider/shared';
import { useUpdateComment } from '@/lib/api';
import { useViewerToast } from '../../state/viewer-toast';

/**
 * Stores a moved or resized mark (pin, box, drawing, text on the slide). `done` runs once the
 * request is over either way, so the drag preview can go. The update is optimistic: a failure
 * snaps the mark back to where it was stored – the toast says why.
 */
export function useSaveMark(deckId: string) {
  const update = useUpdateComment(deckId);
  const showToast = useViewerToast();
  // Per call, not `mutate`'s options: those run only for the latest call of this one mutation, so a
  // second drag before the first is stored would leave the first frame's preview standing.
  return (input: UpdateCommentInput & { commentId: string }, done: () => void) =>
    void update.mutateAsync(input).then(done, (error: Error) => {
      done();
      showToast(error.message, 'danger');
    });
}
