import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useParams, useSearchParams } from 'react-router';
import { routes } from '@/lib/routes';
import { isSignedOutError } from '@/features/auth';
import { markDeckOpened } from '@/lib/last-visits';
import { useComments, useDeck, useDeckPeople, useMe, useSlides } from '@/lib/api';
import { ImportProgress } from './import/ImportProgress';
import { DeckError, DeckLoading } from './DeckStates';
import { useColorOverrides } from './lib/color-overrides';
import { useLiveSnapshot } from './live/lib/live-store';
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
  const live = useLiveSnapshot().connected;
  const comments = useComments(deckId, ready, live);
  // Not awaited: `@` suggests the commenters until the rest arrives.
  const people = useDeckPeople(deckId, ready);
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
        ? deriveViewerData(
            deck.data,
            slides.data,
            comments.data,
            me.data.viewer,
            colorOverrides,
            people.data,
          )
        : null,
    [deck.data, slides.data, comments.data, me.data, colorOverrides, people.data],
  );

  // A deck seen importing morphs into the viewer: the import stage stays on top of the freshly
  // mounted viewer until it has dissolved into it.
  const importing = deck.data !== undefined && deck.data.import.status !== 'ready';
  const [sawImport, setSawImport] = useState(false);
  const [revealed, setRevealed] = useState(false);
  // The import stage asks for the viewer once its placeholders have all printed.
  const [printed, setPrinted] = useState(false);
  if (importing && !sawImport) setSawImport(true);
  const commentsIntro = useCommentsIntro(sawImport, revealed);
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
  const viewerUp = data !== null && (!showImport || printed);

  return (
    <>
      {viewerUp && (
        <div className="contents" data-comments-intro={commentsIntro ?? undefined}>
          <ViewerStoreProvider data={data} initialSlideId={initialSlideId}>
            <RevisionProvider>
              <Viewer />
            </RevisionProvider>
          </ViewerStoreProvider>
        </div>
      )}
      {showImport && (
        <ImportProgress
          deck={deck.data}
          aspectRatios={viewerUp ? aspectRatios : null}
          onPrinted={() => setPrinted(true)}
          onRevealed={() => setRevealed(true)}
        />
      )}
    </>
  );
}

/** Lines drawn, then cards faded in – keep in step with `comments-draw` / `comments-in` in index.css. */
const COMMENTS_INTRO_MS = 1600;

/**
 * Comments of a deck seen importing: hidden while the import stage dissolves into the viewer,
 * then they come in – the lines are drawn from the slides to the cards, then the cards appear.
 */
function useCommentsIntro(sawImport: boolean, revealed: boolean): 'hidden' | 'enter' | null {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!revealed) return;
    const timer = setTimeout(() => setDone(true), COMMENTS_INTRO_MS);
    return () => clearTimeout(timer);
  }, [revealed]);
  if (!sawImport || done) return null;
  return revealed ? 'enter' : 'hidden';
}
