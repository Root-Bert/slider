import { useEffect, useEffectEvent, type RefObject } from 'react';
import { isTypingTarget } from '@/lib/dom';
import { typesCharacter } from '@/lib/keyboard';

/** The search fields typing anywhere goes into now (`useTypeIntoField`). */
const fields = new Set<RefObject<HTMLInputElement | null>>();

/**
 * A key that writes such a field: a character typed with the focus outside a field – not Space,
 * not ⌘ keys, not in a dialog.
 */
const writesField = (event: KeyboardEvent): boolean =>
  !event.defaultPrevented &&
  !event.isComposing &&
  !isTypingTarget(event.target) &&
  typesCharacter(event) &&
  event.key !== ' ' &&
  !(event.target instanceof Element && event.target.closest('dialog'));

/**
 * Whether `event` goes into a search field open now (`useTypeIntoField`): not the editor's then –
 * a picked text box is not typed in. Asked by the editor's own keys, whichever listener runs first.
 */
export const typedIntoField = (event: KeyboardEvent): boolean =>
  writesField(event) && [...fields].some((field) => field.current !== null);

/**
 * While `active`, typing with the focus outside a field writes `fieldRef`'s search: the key goes on
 * into the field, the caret at its end; the viewer's letter shortcuts and the editor skip it.
 * Space and ⌘ keys stay the editor's. `before` sees each key first – `true`: it took it.
 */
export function useTypeIntoField(
  fieldRef: RefObject<HTMLInputElement | null>,
  active: boolean,
  before?: (event: KeyboardEvent) => boolean,
) {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || isTypingTarget(event.target)) return;
    if (before?.(event) || !writesField(event)) return;
    const field = fieldRef.current;
    if (!field) return;
    event.stopPropagation();
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  });
  useEffect(() => {
    if (!active) return;
    fields.add(fieldRef);
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    // Capture: before the viewer's shortcuts.
    window.addEventListener('keydown', listener, true);
    return () => {
      fields.delete(fieldRef);
      window.removeEventListener('keydown', listener, true);
    };
  }, [active, fieldRef]);
}
