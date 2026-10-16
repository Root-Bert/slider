import type { DeckSync, DeletedSlide, SyncSummary } from '@slider/shared';
import { createContext, useContext } from 'react';
import type { Thread } from '../comments/lib/comment-selectors';
import type { SlideBadge } from '../revisions/lib/revision-changes';

/** A new revision the viewer should be told about (notice in the version pill). */
export interface RevisionAnnouncement {
  revisionNumber: number;
  summary: SyncSummary | null;
}

/** What the current revision changed and how the automatic update is doing (BER-107/109). */
export interface RevisionData {
  revisionNumber: number;
  /** Fresh from the status poll, falling back to the deck's own `sync`. */
  sync: DeckSync | null;
  /** Link import (OneDrive, SharePoint, URL) that updates itself; uploads get new versions by hand. */
  isLinked: boolean;
  /** Badges of the latest revision per slide id (only slides that changed). */
  badges: ReadonlyMap<string, SlideBadge>;
  /** When a slide's content last changed, for "Geändert seit Kommentar". */
  modifiedAt: ReadonlyMap<string, string>;
  /** Slides of earlier revisions that are gone, in their old order. */
  deletedSlides: readonly DeletedSlide[];
  /** Threads per deleted slide id (live from the comment list, so replies show up at once). */
  deletedThreads: ReadonlyMap<string, Thread[]>;
  announcement: RevisionAnnouncement | null;
  dismissAnnouncement: () => void;
}

export const RevisionDataContext = createContext<RevisionData | null>(null);

export function useRevisionData(): RevisionData {
  const data = useContext(RevisionDataContext);
  if (!data) throw new Error('useRevisionData must be used inside <RevisionProvider>');
  return data;
}
