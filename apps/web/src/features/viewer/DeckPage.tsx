import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useParams, useSearchParams } from 'react-router';
import { routes } from '@/app/routes';
import { isSignedOutError } from '@/features/auth/lib/gate';
import { ImportProgress } from '@/features/onboarding/ImportProgress';
import { markDeckOpened } from '@/features/reviews/lib/last-visits';
import { useComments, useDeck, useMe, useSlides } from '@/lib/queries';
import { DeckError, DeckLoading } from './DeckStates';
import { useColorOverrides } from './lib/color-overrides';
import { useDocumentTitle } from './hooks/usePageSession';
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
  const location = useLocation();

  const deck = useDeck(deckId);
  const me = useMe();
  const ready = deck.data?.import.status === 'ready';
  const slides = useSlides(deckId, ready);
  const comments = useComments(deckId, ready);
  const colorOverrides = useColorOverrides();

  useDocumentTitle(deck.data?.title);

  // Sort "Zuletzt geöffnet" in Reviews – also for direct links, not just card clicks.
  const loaded = deck.isSuccess;
  useEffect(() => {
    if (loaded) markDeckOpened(deckId);
  }, [loaded, deckId]);

  const data = useMemo(
    () =>
      deck.data && slides.data && comments.data && me.data
        ? deriveViewerData(deck.data, slides.data, comments.data, me.data.viewer, colorOverrides)
        : null,
    [deck.data, slides.data, comments.data, me.data, colorOverrides],
  );

  // A deck seen importing morphs into the viewer: the import stage stays on top of the freshly
  // mounted viewer until it has dissolved into it.
  const importing = deck.data !== undefined && deck.data.import.status !== 'ready';
  const [sawImport, setSawImport] = useState(false);
  const [revealed, setRevealed] = useState(false);
  if (importing && !sawImport) setSawImport(true);
  const aspectRatios = useMemo(
    () => data?.slides.map((slide) => slide.aspectRatio) ?? null,
    [data],
  );

  const error = deck.error ?? me.error ?? slides.error ?? comments.error;
  // Signed out: sign in and come back here.
  if (isSignedOutError(me.error) || isSignedOutError(deck.error)) {
    return <Navigate to={routes.login(location.pathname + location.search)} replace />;
  }
  if (error) return <DeckError error={error} />;
  const showImport = deck.data && (importing || (sawImport && !revealed));
  if (!data && !showImport) return <DeckLoading />;

  return (
    <>
      {data && (
        <ViewerStoreProvider data={data} initialSlideId={initialSlideId}>
          <RevisionProvider>
            <Viewer />
          </RevisionProvider>
        </ViewerStoreProvider>
      )}
      {showImport && (
        <ImportProgress
          deck={deck.data}
          aspectRatios={importing ? null : aspectRatios}
          onRevealed={() => setRevealed(true)}
        />
      )}
    </>
  );
}
