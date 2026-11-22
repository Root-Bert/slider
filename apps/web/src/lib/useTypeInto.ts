import { useEffect, type RefObject } from 'react';
import { isTypingTarget } from './dom';
import { typesCharacter } from './keyboard';

/**
 * While `active`, a character typed with the focus on no field (a chat just picked in the side
 * bar, the page itself) writes into `fieldRef`: focused, the caret at its end, the key goes on in
 * there. Not Space (it presses what is focused), not ⌘ keys, not over a dialog or menu, not while
 * the field waits (`readOnly`). The chat composers' – Sender's and an agent's.
 */
export function useTypeInto(fieldRef: RefObject<HTMLTextAreaElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isTypingTarget(event.target)) return;
      if (!typesCharacter(event) || event.key === ' ') return;
      if (document.querySelector('dialog[open], [role="menu"]')) return;
      const field = fieldRef.current;
      if (!field || field.readOnly || field.disabled) return;
      field.focus({ preventScroll: true });
      field.setSelectionRange(field.value.length, field.value.length);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, fieldRef]);
}
