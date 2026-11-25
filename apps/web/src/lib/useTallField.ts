import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Whether what is written in `fieldRef` runs past one line: then a composer gives the words the
 * whole width and its buttons a row of their own below. It stays so until the field is empty
 * again – a line that fits once the buttons are gone would send them back and forth.
 */
export function useTallField(fieldRef: RefObject<HTMLElement | null>, text: string) {
  const [tall, setTall] = useState(false);
  if (tall && !text) setTall(false);
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field || tall || !text) return;
    const line = parseFloat(getComputedStyle(field).lineHeight) || 18;
    if (text.includes('\n') || field.scrollHeight > line * 1.5) setTall(true);
  }, [fieldRef, text, tall]);
  return tall;
}
