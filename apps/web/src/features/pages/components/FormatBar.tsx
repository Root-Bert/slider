import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { mergeRegister } from '@lexical/utils';
import { $getSelection, $isRangeSelection, BLUR_COMMAND, COMMAND_PRIORITY_LOW } from 'lexical';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RichFormatToolbar } from '@/lib/rich-format';

/** How far above the selected words the bar floats. */
const GAP = 10;
/** How near the window's edge it may come. */
const EDGE = 8;

/**
 * The format bar over the words selected in Bearbeiten – Figma's and Notion's floating bar, the
 * one a Sender message has (`RichFormatToolbar`): bold, italic, underlined, struck
 * through, code, lists, a quote, headings, a link.
 */
export function FormatBar() {
  const [editor] = useLexicalComposerContext();
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  // While a link's address is typed the text loses its selection: the bar stays where it was.
  const linking = useRef(false);

  useEffect(() => {
    const place = () => {
      const selection = window.getSelection();
      const root = editor.getRootElement();
      if (!selection || selection.rangeCount === 0 || !root?.contains(selection.anchorNode)) {
        return null;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return null;
      return { left: rect.left + rect.width / 2, top: rect.top - GAP };
    };
    const follow = () =>
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        const words =
          editor.isEditable() &&
          $isRangeSelection(selection) &&
          !selection.isCollapsed() &&
          document.activeElement === editor.getRootElement();
        if (!words && linking.current) return;
        setAt(words ? place() : null);
      });
    const onScroll = () => setAt((was) => (was ? place() : was));
    window.addEventListener('scroll', onScroll, true);
    return mergeRegister(
      editor.registerUpdateListener(follow),
      editor.registerEditableListener(follow),
      editor.registerCommand(
        BLUR_COMMAND,
        () => {
          if (!linking.current) setAt(null);
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      () => window.removeEventListener('scroll', onScroll, true),
    );
  }, [editor]);

  // Kept on the screen: a page as wide as the window has words picked at its very edge.
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element || !at) return;
    const half = element.offsetWidth / 2 + EDGE;
    element.style.left = `${Math.min(Math.max(at.left, half), window.innerWidth - half)}px`;
  }, [at]);

  if (!at) return null;
  return createPortal(
    <div
      ref={bar}
      data-popover-panel=""
      className="glass-elevated fixed z-(--z-raised) rounded-panel"
      style={{ left: at.left, top: at.top, transform: 'translate(-50%, -100%)' }}
    >
      <RichFormatToolbar
        chat
        onLinking={(on) => {
          linking.current = on;
        }}
      />
    </div>,
    document.body,
  );
}
