/** Keyboard (and wheel) modifier checks, one spelling for the whole app. */

interface Modifiers {
  metaKey: boolean;
  ctrlKey: boolean;
}

/** ⌘ on Apple platforms, Ctrl elsewhere – either one counts (also a trackpad pinch's `ctrlKey`). */
export const isModKey = (event: Modifiers): boolean => event.metaKey || event.ctrlKey;

/** ⌘/Ctrl + Enter: sends a comment or saves an edit. */
export const isModEnter = (event: Modifiers & { key: string }): boolean =>
  event.key === 'Enter' && isModKey(event);

/**
 * A key that types a character. ⌥ (Apple) and AltGr (Ctrl+Alt elsewhere) type characters too –
 * "@" is ⌥L or AltGr+Q on a German keyboard –, ⌘ and Ctrl alone don't.
 */
export const typesCharacter = (event: Modifiers & { key: string; altKey: boolean }): boolean =>
  event.key.length === 1 && !event.metaKey && (!event.ctrlKey || event.altKey);
