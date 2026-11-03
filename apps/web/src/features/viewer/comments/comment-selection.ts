import { createContext, useContext, type MouseEvent } from 'react';

export interface CommentSelection {
  /** Threads selected under the slides (by thread id), for actions on several at once. */
  selected: ReadonlySet<string>;
  /**
   * A click on a card with ⌘/Ctrl or Shift, or any click while some are selected: toggles it (as
   * the decks in "Präsentationen" do) and says so; false – the card opens as usual.
   */
  onModifiedClick: (
    threadId: string,
    event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
  ) => boolean;
  /**
   * Right click on a card (capture phase): on one of several selected, the selection's actions
   * open instead of its own – as on the decks in "Präsentationen". ⇧ keeps the browser's menu.
   */
  onContextMenuCapture: (threadId: string, event: MouseEvent) => void;
}

const NONE: CommentSelection = {
  selected: new Set(),
  onModifiedClick: () => false,
  onContextMenuCapture: () => {},
};

export const CommentSelectionContext = createContext<CommentSelection>(NONE);

export const useCommentSelection = () => useContext(CommentSelectionContext);
