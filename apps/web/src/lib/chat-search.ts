import { useEffect, useLayoutEffect, useRef, type MouseEvent, type RefObject } from 'react';

/**
 * A chat's own search (`ViewSearch` „Chat durchsuchen“, right above it): typed into, the chat
 * shows only the messages the words stand in, each place marked; a click on one shows it in the
 * whole chat again. Agents' chats and conversations alike.
 */

const fold = (text: string) => text.toLocaleLowerCase('de');
/** The words looked for, each on its own: „wetter 7“ finds „Nummer 7 über das Wetter“. */
const wordsOf = (query: string) => fold(query).split(/\s+/).filter(Boolean);

/** Every word looked for stands in `text`, in any order (case does not count). */
export function chatMatches(text: string, query: string) {
  const words = wordsOf(query);
  const folded = fold(text);
  return words.length > 0 && words.every((word) => folded.includes(word));
}

/** The marked places' name in CSS (`::highlight(chat-search)`, `styles/index.css`). */
const MARKED = 'chat-search';

/**
 * Marks every place a word looked for stands under `box` – without touching what React drew (CSS Custom
 * Highlight): mentions, links and an answer's markdown stay as they are. Follows what changes
 * under it (an answer being written, older messages coming in) while the search is on.
 */
export function useMarkedMatches(box: RefObject<HTMLElement | null>, query: string) {
  useEffect(() => {
    const root = box.current;
    const words = wordsOf(query);
    if (!root || words.length === 0 || typeof CSS === 'undefined' || !('highlights' in CSS)) return;
    const mark = () => {
      const ranges: Range[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = fold(node.nodeValue ?? '');
        // Folding may change a text's length (rare letters): such a node keeps no mark.
        if (text.length !== node.nodeValue?.length) continue;
        for (const word of words) {
          for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) {
            const range = new Range();
            range.setStart(node, at);
            range.setEnd(node, at + word.length);
            ranges.push(range);
          }
        }
      }
      CSS.highlights.set(MARKED, new Highlight(...ranges));
    };
    mark();
    const watch = new MutationObserver(mark);
    watch.observe(root, { subtree: true, childList: true, characterData: true });
    return () => {
      watch.disconnect();
      CSS.highlights.delete(MARKED);
    };
  }, [box, query]);
}

/**
 * A hit clicked (not a link or button in it, no text being picked): the search goes and the
 * whole chat shows again, that message in its middle. Each message carries `data-message`.
 */
export function useShowHit(
  list: RefObject<HTMLElement | null>,
  searching: boolean,
  clear: () => void,
) {
  const asked = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = asked.current;
    if (searching || !id) return;
    asked.current = null;
    list.current
      ?.querySelector(`[data-message="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: 'center' });
  }, [searching, list]);
  return (id: string) =>
    searching
      ? (event: MouseEvent) => {
          if ((event.target as Element).closest('a, button, input, textarea')) return;
          if (window.getSelection()?.isCollapsed === false) return;
          asked.current = id;
          clear();
        }
      : undefined;
}
