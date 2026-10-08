import { ApiError } from '@/lib/api-client';
import { useInsertSlide as useInsertSlideMutation } from '@/lib/queries';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch } from '../state/viewer-state';
import { useViewerToast } from '../state/viewer-toast';

/** `?insertAfter=<slide id>`: the ⊕ click to finish after the Microsoft write login (BER-128). */
export const INSERT_AFTER_PARAM = 'insertAfter';

/**
 * Inserts an empty slide after a slide (BER-128) and jumps to it once the new revision is
 * loaded. Without write consent yet the browser goes to Microsoft; the API's login link comes
 * back to the deck with {@link INSERT_AFTER_PARAM}, and the viewer finishes the insert there.
 */
export function useInsertSlide() {
  const { deck } = useViewerData();
  const mutation = useInsertSlideMutation(deck.id);
  const dispatch = useViewerDispatch();
  const registry = useStageRegistry();
  const showToast = useViewerToast();

  /** `redirectToLogin: false` right after a login, so a refused consent can't loop. */
  const run = (afterSlideId: string, { redirectToLogin = true } = {}) =>
    mutation.mutate(
      { afterSlideId },
      {
        onSuccess: ({ result, slideId }) => {
          if (result.status === 'error') {
            showToast(
              result.error?.message ?? 'Die Folie konnte nicht eingefügt werden.',
              'danger',
            );
            return;
          }
          if (slideId) {
            dispatch({ type: 'activeSlideChanged', slideId });
            registry.revealSlide(slideId, { align: 'nearest', behavior: 'smooth' });
          }
          showToast(
            slideId
              ? 'Folie eingefügt und in der PowerPoint gespeichert'
              : 'Folie in der PowerPoint gespeichert – die Vorschau folgt gleich',
            'neutral',
          );
        },
        onError: (error) => {
          if (redirectToLogin && error instanceof ApiError && error.loginUrl) {
            window.location.assign(error.loginUrl);
            return;
          }
          showToast(error.message, 'danger');
        },
      },
    );

  return { run, isPending: mutation.isPending };
}
