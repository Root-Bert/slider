import { deflateSync } from 'node:zlib';

/** Minimal PNG encoder (8-bit RGB, no filtering) for generating test and demo images. */

type Rgb = readonly [number, number, number];

export function createPng(width: number, height: number, pixel: (x: number, y: number) => Rgb) {
  const rowLength = 1 + width * 3;
  const raw = new Uint8Array(rowLength * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowLength] = 0; // filter type "none"
    for (let x = 0; x < width; x++) {
      raw.set(pixel(x, y), y * rowLength + 1 + x * 3);
    }
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8); // bit depth 8, colour type RGB, default compression/filter/interlace

  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const result = new Uint8Array(12 + data.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set(typeBytes, 4);
  result.set(data, 8);
  view.setUint32(8 + data.length, crc32(result.subarray(4, 8 + data.length)));
  return result;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** A 2×2 checkerboard PNG, small enough to compare byte for byte in tests. */
export const TINY_PNG = createPng(2, 2, (x, y) =>
  (x + y) % 2 === 0 ? [37, 99, 235] : [255, 255, 255],
);
