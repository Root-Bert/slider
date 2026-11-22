import { useMemo } from 'react';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { useBoardOwner } from './board-owner';
import { MaterialChatView } from './MaterialChat';
import { openSource } from './material-chat';
import { useBoard } from './useBoard';

/**
 * The AI's chat over the slides, opened by a click on its avatar: the material page's chat (✨
 * there), as one of the presentation's side panels – it reads the material and puts what it
 * makes on the board just the same. A presentation's only (its open flag is the viewer's).
 */
export function AiChatPanel() {
  const { aiChatOpen } = useViewerState();
  const { canComment } = useBoardOwner();
  // Asking spends the workspace's AI: not for Betrachter, as on the material page.
  if (!aiChatOpen || !canComment) return null;
  return <OpenAiChat />;
}

function OpenAiChat() {
  const { aiAuthor } = useBoardOwner();
  const dispatch = useViewerDispatch();
  const { board } = useBoard();
  const byId = useMemo(
    () => new Map(board.materials.map((file) => [file.id, file])),
    [board.materials],
  );
  return (
    <MaterialChatView
      ai={aiAuthor}
      byId={byId}
      openSource={openSource}
      onClose={() => dispatch({ type: 'aiChatSet', open: false })}
    />
  );
}
