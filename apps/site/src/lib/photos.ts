/*
 * The website's photos, all from Unsplash and hotlinked from images.unsplash.com as its guidelines
 * ask (download_location was reported once when each was picked). Every photo shows its credit
 * „Foto von X auf Unsplash“ with referral links wherever it appears.
 */
export interface Photo {
  /** images.unsplash.com base without parameters. */
  raw: string;
  /** Unsplash's average colour: shown while the photo loads. */
  color: string;
  name: string;
  profile: string;
  page: string;
}

const UTM = 'utm_source=Slider&utm_medium=referral';
export const UNSPLASH_HOME = `https://unsplash.com/?${UTM}`;
export const referral = (url: string) => `${url}${url.includes('?') ? '&' : '?'}${UTM}`;

/** A crop of `width` px (doubled for sharp screens by the caller's srcset), imgix does the work. */
export function photoUrl(photo: Photo, width: number, ratio?: number): string {
  const size = ratio ? `&h=${Math.round(width / ratio)}&fit=crop&crop=faces,entropy` : '';
  return `${photo.raw}?auto=format&q=72&w=${width}${size}`;
}

export function photoSrcset(photo: Photo, width: number, ratio?: number): string {
  return [1, 2].map((x) => `${photoUrl(photo, width * x, ratio)} ${x}x`).join(', ');
}

const photo = (raw: string, color: string, name: string, user: string, page: string): Photo => ({
  raw: `https://images.unsplash.com/${raw}`,
  color,
  name,
  profile: `https://unsplash.com/@${user}`,
  page: `https://unsplash.com/photos/${page}`,
});

export const PHOTOS = {
  /** The office dog of the hero slide: a golden retriever among yellow flowers. */
  retriever: photo(
    'photo-1783441286539-e5a70da0b805',
    '#26260c',
    'Wojciech Wyszkowski',
    'fotodruk',
    'F99ck4IlmjA',
  ),
  collie: photo(
    'photo-1612865621039-a45bc11f06bd',
    '#d9c00c',
    'Ayla Verschueren',
    'moob',
    'XUdE_KGGkdA',
  ),
  pom: photo(
    'photo-1589652717406-1c69efaf1ff8',
    '#c0c0c0',
    'Cookie the Pom',
    'cookiethepom',
    'siNDDi9RpVY',
  ),
  reader: photo(
    'photo-1535930891776-0c2dfb7fda1a',
    '#260c26',
    'Jamie Street',
    'jamie452',
    'MoDcnVRN5JU',
  ),
  corgi: photo(
    'photo-1759914915077-1eaa86724311',
    '#26260c',
    'Alvan Nee',
    'alvannee',
    'pt7xfbhRLoQ',
  ),
  forest: photo(
    'photo-1781140435543-4e13447d9a0e',
    '#404040',
    'Omar Prestwich',
    'omarprestwich',
    'rjNB94O7CY4',
  ),
  rottweiler: photo(
    'photo-1656138899262-1faa4ae4bef6',
    '#c08c73',
    'Joash Viriah',
    'joashzn',
    '3jaTCoK-Vww',
  ),
  /** At home on the sofa: self-hosting on the pricing page. */
  sofa: photo(
    'photo-1636910825807-171715240043',
    '#262626',
    'Samantha Jean',
    'samanthadeestudio',
    'bR97ghyap64',
  ),
} satisfies Record<string, Photo>;

export type PhotoName = keyof typeof PHOTOS;
