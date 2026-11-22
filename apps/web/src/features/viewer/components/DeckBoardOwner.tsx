import { useCallback, useMemo, type ReactNode } from 'react';
import { BoardOwnerContext, DECK_WORDING, type BoardOwner } from '../board/board-owner';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { useViewerToast } from '../state/viewer-toast';

/**
 * The presentation as the owner of its board („Material“): what `board/` asks of its page, from
 * the viewer's stores – the deck's id, who may do what, the viewer's toast, and the material
 * page's and its side panel's flags in the viewer's state.
 */
export function DeckBoardOwner({ children }: { children: ReactNode }) {
  const { deck, canComment, canManage, viewer, aiAuthor } = useViewerData();
  const { materialOpen, boardPanelOpen } = useViewerState();
  const dispatch = useViewerDispatch();
  const toast = useViewerToast();
  const setOpen = useCallback(
    (open: boolean) => dispatch({ type: 'materialSet', open }),
    [dispatch],
  );
  const setPanelOpen = useCallback(
    (open: boolean) => dispatch({ type: 'boardPanelSet', open }),
    [dispatch],
  );
  const owner = useMemo<BoardOwner>(
    () => ({
      kind: 'deck',
      id: deck.id,
      canComment,
      canManage,
      viewer: viewer.author,
      aiAuthor,
      toast,
      open: materialOpen,
      setOpen,
      panelOpen: boardPanelOpen,
      setPanelOpen,
      template: !!deck.template,
      wording: DECK_WORDING,
    }),
    [
      deck.id,
      deck.template,
      canComment,
      canManage,
      viewer.author,
      aiAuthor,
      toast,
      materialOpen,
      setOpen,
      boardPanelOpen,
      setPanelOpen,
    ],
  );
  return <BoardOwnerContext value={owner}>{children}</BoardOwnerContext>;
}
