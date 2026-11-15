import { useMemo } from 'react';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { MaterialChatView } from './MaterialChat';
import { openSource } from './material-chat';
import { useBoard } from './useBoard';

/**
 * The AI's chat over the slides, opened by a click on its avatar: the material page's chat (✨
 * there), as one of the presentation's side panels – it reads the material and puts what it
 * makes on the board just the same.
 */
export function AiChatPanel() {
  const { aiChatOpen } = useViewerState();
  const { canComment } = useViewerData();
  // Asking spends the workspace's AI: not for Betrachter, as on the material page.
  if (!aiChatOpen || !canComment) return null;
  return <OpenAiChat />;
}

function OpenAiChat() {
  const { deck, aiAuthor } = useViewerData();
  const dispatch = useViewerDispatch();
  const { board } = useBoard();
  const byId = useMemo(
    () => new Map(board.materials.map((file) => [file.id, file])),
    [board.materials],
  );
  return (
    <MaterialChatView
      deckId={deck.id}
      ai={aiAuthor}
      byId={byId}
      openSource={openSource}
      onClose={() => dispatch({ type: 'aiChatSet', open: false })}
    />
  );
}
