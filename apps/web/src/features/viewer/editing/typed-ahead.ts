/**
 * What was typed into a new frame before its element was there (`KindChooser` → `useInsertFrame`):
 * kept by the new element's id until whoever goes on with it takes it – the text editor (typed
 * on at the caret), a picture's photo search or its description (`FormatBar`).
 */
const pending = new Map<string, string>();

export const typedAhead = {
  put(elementId: string, text: string) {
    pending.set(elementId, text);
  },
  has(elementId: string): boolean {
    return pending.has(elementId);
  },
  peek(elementId: string): string {
    return pending.get(elementId) ?? '';
  },
  take(elementId: string): string {
    const text = pending.get(elementId) ?? '';
    pending.delete(elementId);
    return text;
  },
};
