import type { AccentColor, Author, Comment, Deck, Slide, Viewer } from '@slider/shared';
import { createContext, useContext } from 'react';
import {
  buildThreads,
  gapThreadsByGap,
  groupThreadsBySlide,
  type Thread,
} from '../comments/lib/comment-selectors';
import { withColorOverride } from '../lib/color-overrides';
import { mentions } from '../comments/lib/mentions';

/** Server data of the open deck plus everything derived from it once per fetch. */
export interface ViewerData {
  deck: Deck;
  /** Sorted by position; without slides hidden in PowerPoint unless they are shown (H). */
  slides: Slide[];
  slideIndex: ReadonlyMap<string, number>;
  /** Slides hidden in PowerPoint, shown or not – the switch for them only shows when there are any. */
  hiddenSlideCount: number;
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
  /**
   * Who `@` suggests (BER-105): everyone in the deck but the viewer – participants first, then
   * everyone else with access (also from a workspace the viewer isn't in), PowerPoint authors too.
   */
  mentionable: Author[];
  /** Threads where a comment @mentions the viewer – "mich erwähnt". */
  mentionedThreadIds: ReadonlySet<string>;
}

export function deriveViewerData(
  rawDeck: Deck,
  rawSlides: readonly Slide[],
  rawComments: readonly Comment[],
  viewer: Viewer,
  /** Colours the viewer picked for others (`color-overrides`); never applied to the viewer. */
  colorOverrides: Readonly<Record<string, AccentColor>> = {},
  /** Everyone who can open the deck (`/decks/:id/people`), on top of those who commented. */
  rawMembers: readonly Author[] = [],
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
  const members = recolor
    ? rawMembers.map((person) => withColorOverride(person, overrides))
    : rawMembers;
  const people = new Map<string, Author>();
  for (const person of [deck.owner, ...deck.participants, ...comments.map((c) => c.author)])
    if (!people.has(person.id)) people.set(person.id, person);
  // A member who commented in PowerPoint is listed under that name already.
  const known = new Set([...people.values()].map((person) => person.name.toLowerCase()));
  for (const person of members)
    if (!people.has(person.id) && !known.has(person.name.toLowerCase()))
      people.set(person.id, person);
  const names = [...new Set([...people.values()].map((person) => person.name))];
  const ownName = viewer.author.name;
  return {
    deck,
    slides,
    slideIndex: new Map(slides.map((slide, index) => [slide.id, index])),
    hiddenSlideCount: slides.filter((slide) => slide.hidden).length,
    viewer,
    canManage: deck.permissions.canManage,
    canComment: deck.permissions.canComment,
    threads,
    threadById: new Map(threads.map((thread) => [thread.id, thread])),
    threadsBySlide: groupThreadsBySlide(threads, slides),
    gapThreads: gapThreadsByGap(threads),
    participantNames: names,
    mentionable: [...people.values()].filter((person) => person.id !== viewer.author.id),
    mentionedThreadIds: new Set(
      threads
        .filter((thread) =>
          [thread.root, ...thread.replies].some(
            (comment) =>
              comment.author.id !== viewer.author.id && mentions(comment.body, ownName, names),
          ),
        )
        .map((thread) => thread.id),
    ),
  };
}

/**
 * The deck as it shows while slides hidden in PowerPoint stay out of sight: they and their
 * comments leave the track, the minimap and the counts. A deck with nothing but hidden slides
 * keeps them – an empty viewer would help nobody.
 */
export function withoutHiddenSlides(data: ViewerData): ViewerData {
  if (data.hiddenSlideCount === 0) return data;
  const slides = data.slides.filter((slide) => !slide.hidden);
  if (slides.length === 0) return data;
  return {
    ...data,
    slides,
    slideIndex: new Map(slides.map((slide, index) => [slide.id, index])),
    threadsBySlide: groupThreadsBySlide(data.threads, slides),
  };
}

/**
 * The slide that takes over when `slideId` is hidden: the next one still shown, else the one
 * before it. `null` when `slideId` is not in `all` (gone with a new revision).
 */
export function nearestShownSlideId(
  all: readonly Slide[],
  shown: ReadonlyMap<string, number>,
  slideId: string,
): string | null {
  const index = all.findIndex((slide) => slide.id === slideId);
  if (index === -1) return null;
  const after = all.slice(index).find((slide) => shown.has(slide.id));
  const before = all.slice(0, index).findLast((slide) => shown.has(slide.id));
  return (after ?? before)?.id ?? null;
}

export const ViewerDataContext = createContext<ViewerData | null>(null);

export function useViewerData(): ViewerData {
  const data = useContext(ViewerDataContext);
  if (!data) throw new Error('useViewerData must be used inside <ViewerStoreProvider>');
  return data;
}
