import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { ImportProgress } from '@/features/onboarding/ImportProgress';
import { useComments, useDeck, useMe, useSlides } from '@/lib/queries';
import { DeckError, DeckLoading, SessionEnded } from './DeckStates';
import { useDocumentTitle, useLeaveReview } from './hooks/usePageSession';
import { SLIDE_PARAM } from './hooks/useSlideUrlSync';
import { deriveViewerData } from './state/viewer-data';
import { ViewerStoreProvider } from './state/ViewerStoreProvider';
import { Viewer } from './Viewer';

/** Route `/d/:deckId[?slide=<slideId>]`: loads the deck and switches between import, error and viewer. */
export function Component() {
  const { deckId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const [initialSlideId] = useState(() => searchParams.get(SLIDE_PARAM));
  const { hasLeft, leave } = useLeaveReview();

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
  if (error) return <DeckError error={error} />;
  if (deck.data && deck.data.import.status !== 'ready') return <ImportProgress deck={deck.data} />;
  if (!data) return <DeckLoading />;

  return (
    <ViewerStoreProvider data={data} initialSlideId={initialSlideId}>
      <Viewer onLeave={leave} />
    </ViewerStoreProvider>
  );
}
