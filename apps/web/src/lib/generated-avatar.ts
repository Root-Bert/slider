import { Avatar, Style } from '@dicebear/core';
import landscape from '@dicebear/styles/landscape.json';
import slice from '@dicebear/styles/slice.json';
import { GENERATED_AVATAR_GROUNDS } from './palette';

/** DiceBear "slice" with the "Bold Pop" preset: saturated grounds behind the bands. */
const style = new Style(slice);
/** DiceBear "landscape" (CC0, like "slice") with its own pastel skies: workspaces without a logo. */
const landscapeStyle = new Style(landscape);

const cache = new Map<string, string>();
const landscapeCache = new Map<string, string>();

/** Avatar for someone without a photo, seeded by their name so it is the same everywhere. */
export function generatedAvatar(name: string): string {
  const seed = name.trim().toLowerCase();
  let uri = cache.get(seed);
  if (!uri) {
    uri = new Avatar(style, { seed, backgroundColor: [...GENERATED_AVATAR_GROUNDS] }).toDataUri();
    cache.set(seed, uri);
  }
  return uri;
}

/** Picture of a workspace without a logo, seeded by its name like `generatedAvatar`. */
export function generatedLandscape(name: string): string {
  const seed = name.trim().toLowerCase();
  let uri = landscapeCache.get(seed);
  if (!uri) {
    uri = new Avatar(landscapeStyle, { seed }).toDataUri();
    landscapeCache.set(seed, uri);
  }
  return uri;
}
