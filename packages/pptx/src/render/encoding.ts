/** Escapes text for XML character data and attribute values. */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** Only plain `#rrggbb` colours ever reach the markup. */
export function safeColor(color: string | null | undefined): string | null {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null;
}

/** Compact number formatting for coordinates and sizes (max. 2 decimals). */
export const num = (value: number): string => String(Math.round(value * 100) / 100);

/** Image formats browsers render inside SVG; anything else (EMF, WMF, TIFF, …) is skipped. */
const IMAGE_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

export function imageMimeType(path: string): string | null {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return IMAGE_MIME_TYPES[extension] ?? null;
}

const BASE64_CHUNK = 0x8000;

/** Base64 that works in Node (Buffer) and in browsers (btoa). */
export function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK));
  }
  return btoa(binary);
}
