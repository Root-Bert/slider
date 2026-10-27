/*
 * The fonts slides are drawn in, alike by Slider's LibreOffice and by the browser (the live
 * editor): free fonts metric-compatible with Office's, and the names a file uses for them, and
 * the most used Google Fonts, under their own names. LibreOffice always replaces the Office names
 * (its font replacement table, set in the profile Slider runs it with), the browser does the
 * same – so a line breaks in both at the same word.
 */

/** The most used Google Fonts (scripts/google-fonts.py), drawn as themselves. */
export const GOOGLE_FONTS = [
  'Roboto',
  'Open Sans',
  'Noto Sans',
  'Montserrat',
  'Inter',
  'Lato',
  'Poppins',
  'Roboto Condensed',
  'Oswald',
  'Raleway',
  'Nunito',
  'Ubuntu',
  'Rubik',
  'Work Sans',
  'PT Sans',
  'Playfair Display',
  'Merriweather',
  'Lora',
  'Noto Serif',
  'Roboto Mono',
] as const;

export const OFFICE_FONTS = [
  'Carlito',
  'Caladea',
  'Liberation Sans',
  'Liberation Serif',
  'Liberation Mono',
  'DejaVu Sans',
  'OpenSymbol',
  ...GOOGLE_FONTS,
] as const;
export type OfficeFont = (typeof OFFICE_FONTS)[number];

/** Font names in files and the office font that stands in for each. */
export const OFFICE_FONT_SUBSTITUTES: Readonly<Record<string, OfficeFont>> = {
  Calibri: 'Carlito',
  'Calibri Light': 'Carlito',
  Cambria: 'Caladea',
  Arial: 'Liberation Sans',
  Helvetica: 'Liberation Sans',
  'Helvetica Neue': 'Liberation Sans',
  'Times New Roman': 'Liberation Serif',
  Times: 'Liberation Serif',
  'Courier New': 'Liberation Mono',
  Courier: 'Liberation Mono',
};

/** Fonts whose characters LibreOffice maps to other ones (Wingdings bullets): no plain text. */
export const SYMBOL_FONTS = ['symbol', 'wingdings', 'wingdings 2', 'wingdings 3', 'webdings'];

const WEIGHT_SUFFIX =
  /\s+(?:(?:extra|ultra|semi|demi)[\s-]?)?(?:thin|hairline|light|regular|book|medium|bold|heavy|black)(?:\s+italic)?$/;
const MONO = /mono|courier|consol|menlo|monaco|typewriter|\bcode\b|fixed/i;
const SERIF =
  /serif|roman|times|garamond|georgia|cambria|caslon|baskerville|bodoni|palatino|antiqua|century|minion|didot|playfair|merriweather|lora|slab|rockwell|charter|cochin|hoefler|bookman|libertine|frank ruhl/i;

/**
 * The office font LibreOffice and the browser draw a file's font name in, `null` for a symbol
 * font (left to LibreOffice). An office font stays itself, Office's fonts take their twins
 * (`OFFICE_FONT_SUBSTITUTES`), and any other font – one a server may or may not have – a free
 * one of its kind, guessed from its name: monospaced, serif, else sans (Liberation, metric-
 * compatible with Courier, Times and Helvetica/Arial). So a slide looks the same on every
 * server and in the browser, instead of in whatever the computer falls back to.
 */
export function officeFontFor(name: string): OfficeFont | null {
  const trimmed = name.trim().replace(/^['"]|['"]$/g, '');
  const lower = trimmed.toLowerCase();
  if (SYMBOL_FONTS.includes(lower) || lower === 'opensymbol' || lower === 'starsymbol') {
    return lower === 'opensymbol' ? 'OpenSymbol' : null;
  }
  const own = OFFICE_FONTS.find((font) => font.toLowerCase() === lower);
  if (own) return own;
  // A cut of one of them named as a family of its own ("Montserrat SemiBold"): the family.
  const family = lower.replace(WEIGHT_SUFFIX, '');
  const cut = family !== lower && OFFICE_FONTS.find((font) => font.toLowerCase() === family);
  if (cut) return cut;
  const twin = Object.entries(OFFICE_FONT_SUBSTITUTES).find(
    ([font]) => font.toLowerCase() === lower,
  );
  if (twin) return twin[1];
  if (MONO.test(trimmed)) return 'Liberation Mono';
  if (SERIF.test(trimmed) && !/sans/i.test(trimmed)) return 'Liberation Serif';
  return 'Liberation Sans';
}
