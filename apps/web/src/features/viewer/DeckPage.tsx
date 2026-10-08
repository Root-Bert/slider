import { useMemo, useState } from 'react';
import { Navigate, useLocation, useParams, useSearchParams } from 'react-router';
import { routes } from '@/app/routes';
import { isSignedOutError } from '@/features/auth/lib/gate';
import { ImportProgress } from '@/features/onboarding/ImportProgress';
import { useComments, useDeck, useMe, useSlides } from '@/lib/queries';
import { DeckError, DeckLoading, SessionEnded } from './DeckStates';
import { useDocumentTitle, useLeaveReview } from './hooks/usePageSession';
import { SLIDE_PARAM } from './hooks/useSlideUrlSync';
import { RevisionProvider } from './state/RevisionProvider';
import { deriveViewerData } from './state/viewer-data';
import { ViewerStoreProvider } from './state/ViewerStoreProvider';
import { Viewer } from './Viewer';

/** Route `/d/:deckId[?slide=<slideId>]`: loads the deck and switches between import, error and viewer. */
export function Component() {
  const { deckId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const [initialSlideId] = useState(() => searchParams.get(SLIDE_PARAM));
  const { hasLeft, leave } = useLeaveReview();
  const location = useLocation();

  const deck = useDeck(deckId);
  const me = useMe();
  const ready = deck.data?.import.status === 'ready' && !hasLeft;
  const slides = useSlides(deckId, ready);
  const comments = useComments(deckId, ready);

  useDocumentTitle(deck.data?.title);

  const data = useMemo(
    () =>
      deck.data && slides.data && comments.data && me.data
        ? deriveViewerData(deck.data, slides.data, comments.data, me.data.viewer)
        : null,
    [deck.data, slides.data, comments.data, me.data],
  );

  if (hasLeft) return <SessionEnded />;

  const error = deck.error ?? me.error ?? slides.error ?? comments.error;
  // Neither signed in nor a review-link guest: sign in and come back here.
  if (isSignedOutError(me.error) || isSignedOutError(deck.error)) {
    return <Navigate to={routes.login(location.pathname + location.search)} replace />;
  }
  if (error) return <DeckError error={error} />;
  if (deck.data && deck.data.import.status !== 'ready') return <ImportProgress deck={deck.data} />;
  if (!data) return <DeckLoading />;

  return (
    <ViewerStoreProvider data={data} initialSlideId={initialSlideId}>
      <RevisionProvider>
        <Viewer onLeave={leave} />
      </RevisionProvider>
    </ViewerStoreProvider>
  );
}
