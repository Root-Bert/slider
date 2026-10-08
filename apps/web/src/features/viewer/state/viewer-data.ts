import type { Comment, Deck, Slide, Viewer } from '@slider/shared';
import { createContext, useContext } from 'react';
import {
  buildThreads,
  gapThreadsByGap,
  groupThreadsBySlide,
  type Thread,
} from '../lib/comment-selectors';

/** Server data of the open deck plus everything derived from it once per fetch. */
export interface ViewerData {
  deck: Deck;
  /** Sorted by position. */
  slides: Slide[];
  slideIndex: ReadonlyMap<string, number>;
  viewer: Viewer;
  isOwner: boolean;
  /** Guests with a "view" link can only look (BER-102). */
  canComment: boolean;
  /**
   * The ⊕ between slides inserts a slide into the PowerPoint (BER-128): owner only, and only for
   * decks linked from OneDrive/SharePoint – Slider can write nowhere else.
   */
  canInsertSlides: boolean;
  threads: Thread[];
  threadById: ReadonlyMap<string, Thread>;
  /** All threads per home slide, unfiltered. */
  threadsBySlide: ReadonlyMap<string, Thread[]>;
  /** Gap threads keyed by `gapKey(after, before)`. */
  gapThreads: ReadonlyMap<string, Thread[]>;
  /** Names that count as @mentions when rendering bodies. */
  participantNames: string[];
}

export function deriveViewerData(
  deck: Deck,
  rawSlides: readonly Slide[],
  comments: readonly Comment[],
  viewer: Viewer,
): ViewerData {
  const slides = [...rawSlides].sort((a, b) => a.position - b.position);
  const threads = buildThreads(comments);
  const names = new Set(
    [...deck.participants, deck.owner, ...comments.map((c) => c.author)].map((a) => a.name),
  );
  return {
    deck,
    slides,
    slideIndex: new Map(slides.map((slide, index) => [slide.id, index])),
    viewer,
    isOwner: viewer.kind === 'owner',
    canComment: viewer.kind === 'owner' || viewer.role === 'comment',
    canInsertSlides:
      viewer.kind === 'owner' && (deck.source === 'onedrive' || deck.source === 'sharepoint'),
    threads,
    threadById: new Map(threads.map((thread) => [thread.id, thread])),
    threadsBySlide: groupThreadsBySlide(threads, slides),
    gapThreads: gapThreadsByGap(threads),
    participantNames: [...names],
  };
}

export const ViewerDataContext = createContext<ViewerData | null>(null);

export function useViewerData(): ViewerData {
  const data = useContext(ViewerDataContext);
  if (!data) throw new Error('useViewerData must be used inside <ViewerStoreProvider>');
  return data;
}
