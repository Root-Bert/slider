import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useParams, useSearchParams } from 'react-router';
import { routes } from '@/lib/routes';
import { isSignedOutError } from '@/features/auth';
import { markDeckOpened } from '@/lib/last-visits';
import { useComments, useDeck, useDeckEdit, useDeckPeople, useMe, useSlides } from '@/lib/api';
import { ImportFailed } from './ImportFailed';
import { DeckError, DeckLoading } from './DeckStates';
import { dropPendingSlide, usePendingSlides, withPendingSlides } from './editing/pending-slides';
import { dropRemoteSlideOps, useRemoteSlideOps, withRemoteSlides } from './editing/remote-slides';
import { useColorOverrides } from './hooks/useColorOverrides';
import { useLiveConnected } from './live/lib/live-store';
import { blockingError } from './lib/blocking-error';
import { useDocumentTitle } from './hooks/usePageSession';
import { MATERIAL_PARAM, SLIDE_PARAM } from './hooks/useSlideUrlSync';
import { RevisionProvider } from './state/RevisionProvider';
import { deriveViewerData } from './state/viewer-data';
import { ViewerStoreProvider } from './state/ViewerStoreProvider';
import { Viewer } from './Viewer';

/** Route `/d/:deckId[?slide=<slideId>]`: loads the deck and switches between import, error and viewer. */
export function Component() {
  const { deckId = '' } = useParams();
  // Another deck is a fresh page: the viewer's state, the slide linked to and the import reveal
  // start over instead of carrying over from the deck before.
  return <DeckRoute key={deckId} deckId={deckId} />;
}

/** The page of one deck – keyed by its id in `Component`. */
export function DeckRoute({ deckId }: { deckId: string }) {
  const [searchParams] = useSearchParams();
  const [initialSlideId] = useState(() => searchParams.get(SLIDE_PARAM));
  const location = useLocation();
  // `?material` opens on the material page; a new deck on Folie 1, its prompt.
  const [initialMaterial] = useState(() => searchParams.has(MATERIAL_PARAM));

  const deck = useDeck(deckId);
  const me = useMe();
  const ready = deck.data?.import.status === 'ready';
  const slides = useSlides(deckId, ready);
  // Just the flag: the snapshot changes with every cursor move of every peer.
  const live = useLiveConnected();
  const comments = useComments(deckId, ready, live);
  // Not awaited: `@` suggests the commenters until the rest arrives.
  const people = useDeckPeople(deckId, ready);
  const colorOverrides = useColorOverrides();
  // Slides just put in show at once, until the server's are there (read from the cache only).
  const pendingSlides = usePendingSlides();
  // Someone else's slides duplicated, moved, deleted: shown at once too (`remote-slides`).
  const remoteSlideOps = useRemoteSlideOps();
  const editState = useDeckEdit(deckId, false).data;
  const shownSlides = useMemo(() => {
    if (!slides.data) return null;
    const pending = withPendingSlides(deckId, slides.data, editState?.slides, pendingSlides);
    const remote = withRemoteSlides(
      deckId,
      pending.slides,
      editState?.slides,
      editState?.seq,
      remoteSlideOps,
    );
    return { slides: remote.slides, settled: pending.settled, remoteSettled: remote.settled };
  }, [deckId, slides.data, editState?.slides, editState?.seq, pendingSlides, remoteSlideOps]);
  useEffect(() => {
    for (const newPageId of shownSlides?.settled ?? []) dropPendingSlide(newPageId);
    dropRemoteSlideOps(shownSlides?.remoteSettled ?? []);
  }, [shownSlides]);

  useDocumentTitle(deck.data?.title);

  // Sort "Zuletzt geöffnet" in Reviews – also for direct links, not just card clicks.
  // Kept per account: on a shared computer, the next person's sort is their own.
  const loaded = deck.isSuccess;
  const userId = me.data?.user?.id;
  useEffect(() => {
    if (loaded && userId) markDeckOpened(userId, deckId);
  }, [loaded, userId, deckId]);

  const data = useMemo(
    () =>
      deck.data && shownSlides && comments.data && me.data
        ? deriveViewerData(
            deck.data,
            shownSlides.slides,
            comments.data,
            me.data.viewer,
            colorOverrides,
            people.data,
          )
        : null,
    [deck.data, shownSlides, comments.data, me.data, colorOverrides, people.data],
  );

  // A failed refetch keeps the viewer (and what is being written in it) up.
  const error = blockingError([deck, me, slides, comments]);
  // Signed out: sign in and come back here.
  if (isSignedOutError(me.error) || isSignedOutError(deck.error)) {
    return <Navigate to={routes.login(location.pathname + location.search)} replace />;
  }
  if (error) return <DeckError error={error} />;
  if (deck.data?.import.status === 'failed') {
    return <ImportFailed deck={deck.data} error={deck.data.import.error} />;
  }
  // Still importing (a moment: uploads open on their previews) or loading.
  if (!data) return <DeckLoading />;

  return (
    <ViewerStoreProvider
      data={data}
      initialSlideId={initialSlideId}
      initialMaterial={initialMaterial}
    >
      <RevisionProvider>
        <Viewer />
      </RevisionProvider>
    </ViewerStoreProvider>
  );
}
