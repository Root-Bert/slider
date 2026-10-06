const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Lower-cases and collapses whitespace so cosmetic edits do not change a slide's text hash. */
export function normaliseText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * FNV-1a (32 bit) over the UTF-8 bytes of `text`, as 8 hex digits. Not cryptographic – it only
 * needs to be stable and cheap, and it runs unchanged in Node and the browser.
 */
export function fnv1a32(text: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export const textHash = (text: string): string => fnv1a32(normaliseText(text));
