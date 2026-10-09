import { Avatar, Style } from '@dicebear/core';
import slice from '@dicebear/styles/slice.json';

/** DiceBear "slice" with the "Bold Pop" preset: saturated grounds behind the bands. */
const style = new Style(slice);
const BOLD_POP = ['ff5d8f', 'ffb703', '43aa8b', '4d96ff', 'b57bff'];

const cache = new Map<string, string>();

/** Avatar for someone without a photo, seeded by their name so it is the same everywhere. */
export function generatedAvatar(name: string): string {
  const seed = name.trim().toLowerCase();
  let uri = cache.get(seed);
  if (!uri) {
    uri = new Avatar(style, { seed, backgroundColor: BOLD_POP }).toDataUri();
    cache.set(seed, uri);
  }
  return uri;
}
