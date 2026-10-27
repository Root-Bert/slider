/** A picture's media type and size in pixels, read from its header; `null` if unknown. */
export function imageSize(
  bytes: Uint8Array,
): { mediaType: string; width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && ascii(12, 4) === 'IHDR') {
    return { mediaType: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 10 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) {
    return {
      mediaType: 'image/gif',
      width: view.getUint16(6, true),
      height: view.getUint16(8, true),
    };
  }
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') {
      const uint24 = (offset: number) =>
        (bytes[offset] as number) |
        ((bytes[offset + 1] as number) << 8) |
        ((bytes[offset + 2] as number) << 16);
      return { mediaType: 'image/webp', width: 1 + uint24(24), height: 1 + uint24(27) };
    }
    if (chunk === 'VP8 ') {
      return {
        mediaType: 'image/webp',
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    if (chunk === 'VP8L') {
      const bits = view.getUint32(21, true);
      return {
        mediaType: 'image/webp',
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >> 14) & 0x3fff),
      };
    }
    return null;
  }
  if (bytes.length >= 4 && view.getUint16(0) === 0xffd8) {
    // JPEG: walk the segments to the first frame header (SOF0–SOF15, not DHT/JPG/DAC).
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1] as number;
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      const length = view.getUint16(offset + 2);
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return {
          mediaType: 'image/jpeg',
          width: view.getUint16(offset + 7),
          height: view.getUint16(offset + 5),
        };
      }
      offset += 2 + length;
    }
  }
  return null;
}
