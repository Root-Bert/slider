import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalEditable } from '@lexical/react/useLexicalEditable';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { mergeRegister } from '@lexical/utils';
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type NodeKey,
} from 'lexical';
import { useEffect } from 'react';

/**
 * A block that is not text (a live block, a table, what is kept as written): in Bearbeiten a
 * click picks it whole, ⌫ or Entf deletes it – as a picture in a text. Lesen does nothing.
 */
export function useBlockPick(nodeKey: NodeKey) {
  const [editor] = useLexicalComposerContext();
  const editable = useLexicalEditable();
  const [picked, setPicked, clearPicked] = useLexicalNodeSelection(nodeKey);

  useEffect(() => {
    if (!editable) return;
    const remove = (event: KeyboardEvent | null) => {
      const selection = $getSelection();
      if (!picked || !$isNodeSelection(selection)) return false;
      event?.preventDefault();
      $getNodeByKey(nodeKey)?.remove();
      return true;
    };
    return mergeRegister(
      editor.registerCommand(KEY_BACKSPACE_COMMAND, remove, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_DELETE_COMMAND, remove, COMMAND_PRIORITY_LOW),
    );
  }, [editor, editable, picked, nodeKey]);

  // Picked, a press elsewhere lets go of it first: else Lexical keeps the pick and wipes the caret
  // the press puts into the text (one had to click twice to type).
  useEffect(() => {
    const root = editor.getRootElement();
    if (!editable || !picked || !root) return;
    const press = (event: PointerEvent) => {
      if (event.shiftKey || editor.getElementByKey(nodeKey)?.contains(event.target as Node)) return;
      editor.update(
        () => {
          if ($isNodeSelection($getSelection())) $setSelection(null);
        },
        { discrete: true },
      );
    };
    root.addEventListener('pointerdown', press, true);
    return () => root.removeEventListener('pointerdown', press, true);
  }, [editor, editable, picked, nodeKey]);

  const pick = (event: { shiftKey: boolean }) => {
    if (!editable) return;
    if (!event.shiftKey) clearPicked();
    setPicked(true);
  };
  return { editable, picked: editable && picked, pick, editor };
}
