import type { AccentColor, Comment, Deck, Slide, Viewer } from '@slider/shared';
import { createContext, useContext } from 'react';
import {
  buildThreads,
  gapThreadsByGap,
  groupThreadsBySlide,
  type Thread,
} from '../lib/comment-selectors';
import { withColorOverride } from '../lib/color-overrides';

/** Server data of the open deck plus everything derived from it once per fetch. */
export interface ViewerData {
  deck: Deck;
  /** Sorted by position. */
  slides: Slide[];
  slideIndex: ReadonlyMap<string, number>;
  viewer: Viewer;
  /** Rename, share, new versions, sync – from `deck.permissions` (BER-129). */
  canManage: boolean;
  /** Write comments, reply and resolve; `viewer`s (a deck was shared with them) only look. */
  canComment: boolean;
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
  rawDeck: Deck,
  rawSlides: readonly Slide[],
  rawComments: readonly Comment[],
  viewer: Viewer,
  /** Colours the viewer picked for others (`color-overrides`); never applied to the viewer. */
  colorOverrides: Readonly<Record<string, AccentColor>> = {},
): ViewerData {
  const { [viewer.author.id]: _, ...overrides } = colorOverrides;
  const recolor = Object.keys(overrides).length > 0;
  const deck: Deck = recolor
    ? {
        ...rawDeck,
        owner: withColorOverride(rawDeck.owner, overrides),
        participants: rawDeck.participants.map((person) => withColorOverride(person, overrides)),
      }
    : rawDeck;
  const comments = recolor
    ? rawComments.map((comment) =>
        overrides[comment.author.id]
          ? { ...comment, author: withColorOverride(comment.author, overrides) }
          : comment,
      )
    : rawComments;
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
    canManage: deck.permissions.canManage,
    canComment: deck.permissions.canComment,
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
