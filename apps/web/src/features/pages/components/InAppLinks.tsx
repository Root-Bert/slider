import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';

/**
 * A link into the app on a page – a page, file or folder named in it, a live block's row, a
 * diagram – opens where one is, as every link in the app does: a page under this one is a level
 * deeper, back goes back. Lexical's `ClickableLinkPlugin` takes every `<a>` in the editor and
 * opens it in a new tab; this catches the click on the way down (capture), before it sees it.
 * ⌘/Ctrl/Shift/Alt or middle click and links out of the app stay with it – a new tab.
 */
export function InAppLinks() {
  const [editor] = useLexicalComposerContext();
  const navigate = useNavigate();
  useEffect(
    () =>
      editor.registerRootListener((root) => {
        if (!root) return;
        const onClick = (event: MouseEvent) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return;
          }
          const target = event.target instanceof Element ? event.target : null;
          const anchor = target?.closest('a[href]');
          if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank') return;
          if (!anchor.closest('[data-lexical-decorator]')) return;
          const url = new URL(anchor.href);
          if (url.origin !== window.location.origin) return;
          event.preventDefault();
          event.stopPropagation();
          void navigate(url.pathname + url.search + url.hash);
        };
        root.addEventListener('click', onClick, true);
        return () => root.removeEventListener('click', onClick, true);
      }),
    [editor, navigate],
  );
  return null;
}
