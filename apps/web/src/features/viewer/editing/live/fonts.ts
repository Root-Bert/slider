import {
  GOOGLE_FONTS,
  OFFICE_FONTS,
  officeFontFor,
  type LiveElement,
  type OfficeFont,
  type WorkspaceFont,
} from '@slider/shared';
import { loadWorkspaceFonts, workspaceCssFamily } from '@/lib/workspace-fonts';

/*
 * The fonts live elements are drawn in: the ones Slider's LibreOffice draws with (Carlito,
 * Caladea, Liberation, DejaVu, the Google Fonts), served from `/fonts/office`, under names of
 * their own – a font of the same name installed on the computer is never used. A file's font names map to them as
 * LibreOffice maps them (`officeFontFor`: Office's to their twins, any other to a free font of
 * its kind). Each face gets the vertical metrics LibreOffice lays out with (hhea ascent and
 * descent, no line gap).
 */

interface FontFiles {
  /** Files in `/fonts/office`: regular, bold, italic, bold italic (`null`: synthesised). */
  files: [string, string | null, string | null, string | null];
  upm: number;
  ascent: number;
  descent: number;
}

const FONTS: Record<OfficeFont, FontFiles> = {
  Carlito: {
    files: ['Carlito-Regular', 'Carlito-Bold', 'Carlito-Italic', 'Carlito-BoldItalic'],
    upm: 2048,
    ascent: 1536,
    descent: 512,
  },
  Caladea: {
    files: ['Caladea-Regular', 'Caladea-Bold', 'Caladea-Italic', 'Caladea-BoldItalic'],
    upm: 1000,
    ascent: 950,
    descent: 222,
  },
  'Liberation Sans': {
    files: [
      'LiberationSans-Regular',
      'LiberationSans-Bold',
      'LiberationSans-Italic',
      'LiberationSans-BoldItalic',
    ],
    upm: 2048,
    ascent: 1854,
    descent: 434,
  },
  'Liberation Serif': {
    files: [
      'LiberationSerif-Regular',
      'LiberationSerif-Bold',
      'LiberationSerif-Italic',
      'LiberationSerif-BoldItalic',
    ],
    upm: 2048,
    ascent: 1825,
    descent: 443,
  },
  'Liberation Mono': {
    files: [
      'LiberationMono-Regular',
      'LiberationMono-Bold',
      'LiberationMono-Italic',
      'LiberationMono-BoldItalic',
    ],
    upm: 2048,
    ascent: 1705,
    descent: 615,
  },
  'DejaVu Sans': {
    files: ['DejaVuSans', 'DejaVuSans-Bold', 'DejaVuSans-Oblique', 'DejaVuSans-BoldOblique'],
    upm: 2048,
    ascent: 1901,
    descent: 483,
  },
  OpenSymbol: { files: ['opens___', null, null, null], upm: 2048, ascent: 1420, descent: 442 },
  Roboto: {
    files: ['Roboto-Regular', 'Roboto-Bold', 'Roboto-Italic', 'Roboto-BoldItalic'],
    upm: 2048,
    ascent: 1900,
    descent: 500,
  },
  'Open Sans': {
    files: ['OpenSans-Regular', 'OpenSans-Bold', 'OpenSans-Italic', 'OpenSans-BoldItalic'],
    upm: 2048,
    ascent: 2189,
    descent: 600,
  },
  'Noto Sans': {
    files: ['NotoSans-Regular', 'NotoSans-Bold', 'NotoSans-Italic', 'NotoSans-BoldItalic'],
    upm: 1000,
    ascent: 1069,
    descent: 293,
  },
  Montserrat: {
    files: ['Montserrat-Regular', 'Montserrat-Bold', 'Montserrat-Italic', 'Montserrat-BoldItalic'],
    upm: 1000,
    ascent: 968,
    descent: 251,
  },
  Inter: {
    files: ['Inter-Regular', 'Inter-Bold', 'Inter-Italic', 'Inter-BoldItalic'],
    upm: 2048,
    ascent: 1984,
    descent: 494,
  },
  Lato: {
    files: ['Lato-Regular', 'Lato-Bold', 'Lato-Italic', 'Lato-BoldItalic'],
    upm: 2000,
    ascent: 1974,
    descent: 426,
  },
  Poppins: {
    files: ['Poppins-Regular', 'Poppins-Bold', 'Poppins-Italic', 'Poppins-BoldItalic'],
    upm: 1000,
    ascent: 1050,
    descent: 350,
  },
  'Roboto Condensed': {
    files: [
      'RobotoCondensed-Regular',
      'RobotoCondensed-Bold',
      'RobotoCondensed-Italic',
      'RobotoCondensed-BoldItalic',
    ],
    upm: 2048,
    ascent: 1900,
    descent: 500,
  },
  Oswald: {
    files: ['Oswald-Regular', 'Oswald-Bold', null, null],
    upm: 1000,
    ascent: 1193,
    descent: 289,
  },
  Raleway: {
    files: ['Raleway-Regular', 'Raleway-Bold', 'Raleway-Italic', 'Raleway-BoldItalic'],
    upm: 1000,
    ascent: 940,
    descent: 234,
  },
  Nunito: {
    files: ['Nunito-Regular', 'Nunito-Bold', 'Nunito-Italic', 'Nunito-BoldItalic'],
    upm: 1000,
    ascent: 1011,
    descent: 353,
  },
  Ubuntu: {
    files: ['Ubuntu-Regular', 'Ubuntu-Bold', 'Ubuntu-Italic', 'Ubuntu-BoldItalic'],
    upm: 1000,
    ascent: 932,
    descent: 189,
  },
  Rubik: {
    files: ['Rubik-Regular', 'Rubik-Bold', 'Rubik-Italic', 'Rubik-BoldItalic'],
    upm: 1000,
    ascent: 935,
    descent: 250,
  },
  'Work Sans': {
    files: ['WorkSans-Regular', 'WorkSans-Bold', 'WorkSans-Italic', 'WorkSans-BoldItalic'],
    upm: 1000,
    ascent: 930,
    descent: 243,
  },
  'PT Sans': {
    files: ['PTSans-Regular', 'PTSans-Bold', 'PTSans-Italic', 'PTSans-BoldItalic'],
    upm: 1000,
    ascent: 1018,
    descent: 276,
  },
  'Playfair Display': {
    files: [
      'PlayfairDisplay-Regular',
      'PlayfairDisplay-Bold',
      'PlayfairDisplay-Italic',
      'PlayfairDisplay-BoldItalic',
    ],
    upm: 1000,
    ascent: 1082,
    descent: 251,
  },
  Merriweather: {
    files: [
      'Merriweather-Regular',
      'Merriweather-Bold',
      'Merriweather-Italic',
      'Merriweather-BoldItalic',
    ],
    upm: 2000,
    ascent: 1968,
    descent: 546,
  },
  Lora: {
    files: ['Lora-Regular', 'Lora-Bold', 'Lora-Italic', 'Lora-BoldItalic'],
    upm: 1000,
    ascent: 1006,
    descent: 274,
  },
  'Noto Serif': {
    files: ['NotoSerif-Regular', 'NotoSerif-Bold', 'NotoSerif-Italic', 'NotoSerif-BoldItalic'],
    upm: 1000,
    ascent: 1069,
    descent: 293,
  },
  'Roboto Mono': {
    files: ['RobotoMono-Regular', 'RobotoMono-Bold', 'RobotoMono-Italic', 'RobotoMono-BoldItalic'],
    upm: 2048,
    ascent: 2146,
    descent: 555,
  },
  'Source Sans 3': {
    files: [
      'SourceSans3-Regular',
      'SourceSans3-Bold',
      'SourceSans3-Italic',
      'SourceSans3-BoldItalic',
    ],
    upm: 1000,
    ascent: 1024,
    descent: 400,
  },
  'Nunito Sans': {
    files: ['NunitoSans-Regular', 'NunitoSans-Bold', 'NunitoSans-Italic', 'NunitoSans-BoldItalic'],
    upm: 1000,
    ascent: 1011,
    descent: 353,
  },
  'Fira Sans': {
    files: ['FiraSans-Regular', 'FiraSans-Bold', 'FiraSans-Italic', 'FiraSans-BoldItalic'],
    upm: 1000,
    ascent: 935,
    descent: 265,
  },
  Barlow: {
    files: ['Barlow-Regular', 'Barlow-Bold', 'Barlow-Italic', 'Barlow-BoldItalic'],
    upm: 1000,
    ascent: 1000,
    descent: 200,
  },
  'Barlow Condensed': {
    files: [
      'BarlowCondensed-Regular',
      'BarlowCondensed-Bold',
      'BarlowCondensed-Italic',
      'BarlowCondensed-BoldItalic',
    ],
    upm: 1000,
    ascent: 1000,
    descent: 200,
  },
  'DM Sans': {
    files: ['DMSans-Regular', 'DMSans-Bold', 'DMSans-Italic', 'DMSans-BoldItalic'],
    upm: 1000,
    ascent: 992,
    descent: 310,
  },
  Manrope: {
    files: ['Manrope-Regular', 'Manrope-Bold', null, null],
    upm: 2000,
    ascent: 2132,
    descent: 600,
  },
  'IBM Plex Sans': {
    files: [
      'IBMPlexSans-Regular',
      'IBMPlexSans-Bold',
      'IBMPlexSans-Italic',
      'IBMPlexSans-BoldItalic',
    ],
    upm: 1000,
    ascent: 1025,
    descent: 275,
  },
  Karla: {
    files: ['Karla-Regular', 'Karla-Bold', 'Karla-Italic', 'Karla-BoldItalic'],
    upm: 2000,
    ascent: 1834,
    descent: 504,
  },
  'Titillium Web': {
    files: [
      'TitilliumWeb-Regular',
      'TitilliumWeb-Bold',
      'TitilliumWeb-Italic',
      'TitilliumWeb-BoldItalic',
    ],
    upm: 1000,
    ascent: 1133,
    descent: 388,
  },
  'Josefin Sans': {
    files: [
      'JosefinSans-Regular',
      'JosefinSans-Bold',
      'JosefinSans-Italic',
      'JosefinSans-BoldItalic',
    ],
    upm: 1000,
    ascent: 750,
    descent: 250,
  },
  'Libre Franklin': {
    files: [
      'LibreFranklin-Regular',
      'LibreFranklin-Bold',
      'LibreFranklin-Italic',
      'LibreFranklin-BoldItalic',
    ],
    upm: 1000,
    ascent: 966,
    descent: 246,
  },
  Mulish: {
    files: ['Mulish-Regular', 'Mulish-Bold', 'Mulish-Italic', 'Mulish-BoldItalic'],
    upm: 1000,
    ascent: 1005,
    descent: 250,
  },
  Quicksand: {
    files: ['Quicksand-Regular', 'Quicksand-Bold', null, null],
    upm: 1000,
    ascent: 1000,
    descent: 250,
  },
  Archivo: {
    files: ['Archivo-Regular', 'Archivo-Bold', 'Archivo-Italic', 'Archivo-BoldItalic'],
    upm: 1000,
    ascent: 878,
    descent: 210,
  },
  'Space Grotesk': {
    files: ['SpaceGrotesk-Regular', 'SpaceGrotesk-Bold', null, null],
    upm: 1000,
    ascent: 984,
    descent: 292,
  },
  Outfit: {
    files: ['Outfit-Regular', 'Outfit-Bold', null, null],
    upm: 1000,
    ascent: 1000,
    descent: 260,
  },
  'Plus Jakarta Sans': {
    files: [
      'PlusJakartaSans-Regular',
      'PlusJakartaSans-Bold',
      'PlusJakartaSans-Italic',
      'PlusJakartaSans-BoldItalic',
    ],
    upm: 1000,
    ascent: 1038,
    descent: 222,
  },
  Lexend: {
    files: ['Lexend-Regular', 'Lexend-Bold', null, null],
    upm: 1000,
    ascent: 1000,
    descent: 250,
  },
  Figtree: {
    files: ['Figtree-Regular', 'Figtree-Bold', 'Figtree-Italic', 'Figtree-BoldItalic'],
    upm: 1000,
    ascent: 950,
    descent: 250,
  },
  'Red Hat Display': {
    files: [
      'RedHatDisplay-Regular',
      'RedHatDisplay-Bold',
      'RedHatDisplay-Italic',
      'RedHatDisplay-BoldItalic',
    ],
    upm: 1000,
    ascent: 1018,
    descent: 305,
  },
  Sora: { files: ['Sora-Regular', 'Sora-Bold', null, null], upm: 1000, ascent: 970, descent: 290 },
  Urbanist: {
    files: ['Urbanist-Regular', 'Urbanist-Bold', 'Urbanist-Italic', 'Urbanist-BoldItalic'],
    upm: 2000,
    ascent: 1900,
    descent: 500,
  },
  'Public Sans': {
    files: ['PublicSans-Regular', 'PublicSans-Bold', 'PublicSans-Italic', 'PublicSans-BoldItalic'],
    upm: 2000,
    ascent: 1900,
    descent: 450,
  },
  Jost: {
    files: ['Jost-Regular', 'Jost-Bold', 'Jost-Italic', 'Jost-BoldItalic'],
    upm: 1000,
    ascent: 1070,
    descent: 375,
  },
  'Be Vietnam Pro': {
    files: [
      'BeVietnamPro-Regular',
      'BeVietnamPro-Bold',
      'BeVietnamPro-Italic',
      'BeVietnamPro-BoldItalic',
    ],
    upm: 1000,
    ascent: 1000,
    descent: 265,
  },
  'Hanken Grotesk': {
    files: [
      'HankenGrotesk-Regular',
      'HankenGrotesk-Bold',
      'HankenGrotesk-Italic',
      'HankenGrotesk-BoldItalic',
    ],
    upm: 1000,
    ascent: 1000,
    descent: 303,
  },
  Geist: {
    files: ['Geist-Regular', 'Geist-Bold', 'Geist-Italic', 'Geist-BoldItalic'],
    upm: 1000,
    ascent: 1005,
    descent: 295,
  },
  'Bricolage Grotesque': {
    files: ['BricolageGrotesque-Regular', 'BricolageGrotesque-Bold', null, null],
    upm: 1000,
    ascent: 930,
    descent: 270,
  },
  'Instrument Sans': {
    files: [
      'InstrumentSans-Regular',
      'InstrumentSans-Bold',
      'InstrumentSans-Italic',
      'InstrumentSans-BoldItalic',
    ],
    upm: 1000,
    ascent: 970,
    descent: 250,
  },
  Cabin: {
    files: ['Cabin-Regular', 'Cabin-Bold', 'Cabin-Italic', 'Cabin-BoldItalic'],
    upm: 2000,
    ascent: 1930,
    descent: 500,
  },
  'Exo 2': {
    files: ['Exo2-Regular', 'Exo2-Bold', 'Exo2-Italic', 'Exo2-BoldItalic'],
    upm: 1000,
    ascent: 999,
    descent: 201,
  },
  Kanit: {
    files: ['Kanit-Regular', 'Kanit-Bold', 'Kanit-Italic', 'Kanit-BoldItalic'],
    upm: 1000,
    ascent: 1100,
    descent: 395,
  },
  Asap: {
    files: ['Asap-Regular', 'Asap-Bold', 'Asap-Italic', 'Asap-BoldItalic'],
    upm: 1000,
    ascent: 934,
    descent: 212,
  },
  'Bebas Neue': {
    files: ['BebasNeue-Regular', null, null, null],
    upm: 1000,
    ascent: 900,
    descent: 300,
  },
  Anton: { files: ['Anton-Regular', null, null, null], upm: 2048, ascent: 2409, descent: 674 },
  'Archivo Black': {
    files: ['ArchivoBlack-Regular', null, null, null],
    upm: 1000,
    ascent: 878,
    descent: 210,
  },
  'Fjalla One': {
    files: ['FjallaOne-Regular', null, null, null],
    upm: 2048,
    ascent: 2066,
    descent: 508,
  },
  Teko: { files: ['Teko-Regular', 'Teko-Bold', null, null], upm: 1000, ascent: 958, descent: 475 },
  Dosis: {
    files: ['Dosis-Regular', 'Dosis-Bold', null, null],
    upm: 1000,
    ascent: 1027,
    descent: 237,
  },
  Comfortaa: {
    files: ['Comfortaa-Regular', 'Comfortaa-Bold', null, null],
    upm: 1000,
    ascent: 881,
    descent: 234,
  },
  'Varela Round': {
    files: ['VarelaRound-Regular', null, null, null],
    upm: 1000,
    ascent: 918,
    descent: 286,
  },
  Fredoka: {
    files: ['Fredoka-Regular', 'Fredoka-Bold', null, null],
    upm: 1000,
    ascent: 974,
    descent: 236,
  },
  Righteous: {
    files: ['Righteous-Regular', null, null, null],
    upm: 2048,
    ascent: 2017,
    descent: 526,
  },
  'Source Serif 4': {
    files: [
      'SourceSerif4-Regular',
      'SourceSerif4-Bold',
      'SourceSerif4-Italic',
      'SourceSerif4-BoldItalic',
    ],
    upm: 1000,
    ascent: 1036,
    descent: 335,
  },
  'PT Serif': {
    files: ['PTSerif-Regular', 'PTSerif-Bold', 'PTSerif-Italic', 'PTSerif-BoldItalic'],
    upm: 1000,
    ascent: 1039,
    descent: 286,
  },
  'Libre Baskerville': {
    files: [
      'LibreBaskerville-Regular',
      'LibreBaskerville-Bold',
      'LibreBaskerville-Italic',
      'LibreBaskerville-BoldItalic',
    ],
    upm: 1000,
    ascent: 970,
    descent: 270,
  },
  'EB Garamond': {
    files: ['EBGaramond-Regular', 'EBGaramond-Bold', 'EBGaramond-Italic', 'EBGaramond-BoldItalic'],
    upm: 1000,
    ascent: 1007,
    descent: 298,
  },
  'Cormorant Garamond': {
    files: [
      'CormorantGaramond-Regular',
      'CormorantGaramond-Bold',
      'CormorantGaramond-Italic',
      'CormorantGaramond-BoldItalic',
    ],
    upm: 1000,
    ascent: 924,
    descent: 287,
  },
  'Crimson Pro': {
    files: ['CrimsonPro-Regular', 'CrimsonPro-Bold', 'CrimsonPro-Italic', 'CrimsonPro-BoldItalic'],
    upm: 1024,
    ascent: 918,
    descent: 220,
  },
  Bitter: {
    files: ['Bitter-Regular', 'Bitter-Bold', 'Bitter-Italic', 'Bitter-BoldItalic'],
    upm: 1000,
    ascent: 935,
    descent: 265,
  },
  'Roboto Slab': {
    files: ['RobotoSlab-Regular', 'RobotoSlab-Bold', null, null],
    upm: 2048,
    ascent: 2146,
    descent: 555,
  },
  'Zilla Slab': {
    files: ['ZillaSlab-Regular', 'ZillaSlab-Bold', 'ZillaSlab-Italic', 'ZillaSlab-BoldItalic'],
    upm: 1000,
    ascent: 944,
    descent: 256,
  },
  Arvo: {
    files: ['Arvo-Regular', 'Arvo-Bold', 'Arvo-Italic', 'Arvo-BoldItalic'],
    upm: 2048,
    ascent: 1968,
    descent: 506,
  },
  'DM Serif Display': {
    files: ['DMSerifDisplay-Regular', null, 'DMSerifDisplay-Italic', null],
    upm: 1000,
    ascent: 1036,
    descent: 335,
  },
  Spectral: {
    files: ['Spectral-Regular', 'Spectral-Bold', 'Spectral-Italic', 'Spectral-BoldItalic'],
    upm: 1000,
    ascent: 1059,
    descent: 463,
  },
  Alegreya: {
    files: ['Alegreya-Regular', 'Alegreya-Bold', 'Alegreya-Italic', 'Alegreya-BoldItalic'],
    upm: 1000,
    ascent: 1016,
    descent: 345,
  },
  Vollkorn: {
    files: ['Vollkorn-Regular', 'Vollkorn-Bold', 'Vollkorn-Italic', 'Vollkorn-BoldItalic'],
    upm: 1000,
    ascent: 952,
    descent: 441,
  },
  Literata: {
    files: ['Literata-Regular', 'Literata-Bold', 'Literata-Italic', 'Literata-BoldItalic'],
    upm: 1000,
    ascent: 1177,
    descent: 308,
  },
  Fraunces: {
    files: ['Fraunces-Regular', 'Fraunces-Bold', 'Fraunces-Italic', 'Fraunces-BoldItalic'],
    upm: 2000,
    ascent: 1956,
    descent: 510,
  },
  Newsreader: {
    files: ['Newsreader-Regular', 'Newsreader-Bold', 'Newsreader-Italic', 'Newsreader-BoldItalic'],
    upm: 2000,
    ascent: 1470,
    descent: 530,
  },
  'Frank Ruhl Libre': {
    files: ['FrankRuhlLibre-Regular', 'FrankRuhlLibre-Bold', null, null],
    upm: 1000,
    ascent: 957,
    descent: 334,
  },
  'Abril Fatface': {
    files: ['AbrilFatface-Regular', null, null, null],
    upm: 1000,
    ascent: 1058,
    descent: 291,
  },
  Cinzel: {
    files: ['Cinzel-Regular', 'Cinzel-Bold', null, null],
    upm: 1000,
    ascent: 976,
    descent: 372,
  },
  'Instrument Serif': {
    files: ['InstrumentSerif-Regular', null, 'InstrumentSerif-Italic', null],
    upm: 1000,
    ascent: 990,
    descent: 310,
  },
  'Source Code Pro': {
    files: [
      'SourceCodePro-Regular',
      'SourceCodePro-Bold',
      'SourceCodePro-Italic',
      'SourceCodePro-BoldItalic',
    ],
    upm: 1000,
    ascent: 984,
    descent: 273,
  },
  'Fira Code': {
    files: ['FiraCode-Regular', 'FiraCode-Bold', null, null],
    upm: 2000,
    ascent: 1980,
    descent: 644,
  },
  'JetBrains Mono': {
    files: [
      'JetBrainsMono-Regular',
      'JetBrainsMono-Bold',
      'JetBrainsMono-Italic',
      'JetBrainsMono-BoldItalic',
    ],
    upm: 1000,
    ascent: 1020,
    descent: 300,
  },
  'IBM Plex Mono': {
    files: [
      'IBMPlexMono-Regular',
      'IBMPlexMono-Bold',
      'IBMPlexMono-Italic',
      'IBMPlexMono-BoldItalic',
    ],
    upm: 1000,
    ascent: 1025,
    descent: 275,
  },
  'Space Mono': {
    files: ['SpaceMono-Regular', 'SpaceMono-Bold', 'SpaceMono-Italic', 'SpaceMono-BoldItalic'],
    upm: 1000,
    ascent: 1120,
    descent: 361,
  },
  Inconsolata: {
    files: ['Inconsolata-Regular', 'Inconsolata-Bold', null, null],
    upm: 1000,
    ascent: 859,
    descent: 190,
  },
  'Dancing Script': {
    files: ['DancingScript-Regular', 'DancingScript-Bold', null, null],
    upm: 1000,
    ascent: 920,
    descent: 280,
  },
  Caveat: {
    files: ['Caveat-Regular', 'Caveat-Bold', null, null],
    upm: 1000,
    ascent: 960,
    descent: 300,
  },
  Pacifico: {
    files: ['Pacifico-Regular', null, null, null],
    upm: 1000,
    ascent: 1303,
    descent: 453,
  },
  Lobster: { files: ['Lobster-Regular', null, null, null], upm: 1000, ascent: 1000, descent: 250 },
  'Permanent Marker': {
    files: ['PermanentMarker-Regular', null, null, null],
    upm: 1024,
    ascent: 1136,
    descent: 325,
  },
  'Indie Flower': {
    files: ['IndieFlower-Regular', null, null, null],
    upm: 1024,
    ascent: 994,
    descent: 500,
  },
  'Great Vibes': {
    files: ['GreatVibes-Regular', null, null, null],
    upm: 1000,
    ascent: 851,
    descent: 401,
  },
  'Amatic SC': {
    files: ['AmaticSC-Regular', 'AmaticSC-Bold', null, null],
    upm: 1000,
    ascent: 1016,
    descent: 245,
  },
  Satisfy: { files: ['Satisfy-Regular', null, null, null], upm: 1024, ascent: 957, descent: 501 },
};

/** The office font a file's font name is drawn in (a symbol font: OpenSymbol). */
export const officeFont = (name: string): OfficeFont => officeFontFor(name) ?? 'OpenSymbol';

/** The CSS family of an office font. */
export const cssFamily = (font: OfficeFont) => `"Slider ${font}"`;

/** Ascent and descent in em, as LibreOffice measures the font. */
export const fontMetrics = (font: OfficeFont) => ({
  ascent: FONTS[font].ascent / FONTS[font].upm,
  descent: FONTS[font].descent / FONTS[font].upm,
});

/**
 * The fonts the editor offers for text: names LibreOffice draws alike on every Slider server,
 * each under its own name – the twins of Office's fonts (Carlito, Caladea, Liberation), never
 * Microsoft's names (`freeFontName`). A text in one of those shows its name as the current one.
 */
export const EDITOR_FONTS = [
  'Carlito',
  'Caladea',
  'Liberation Sans',
  'Liberation Serif',
  'Liberation Mono',
  'DejaVu Sans',
  ...GOOGLE_FONTS,
].sort((a, b) => a.localeCompare(b));

/**
 * The deck's workspace's own fonts, by family (any case): LibreOffice draws a family the
 * workspace has in itself (`fontSubstituteFor`), so the editor does too – with its metrics.
 * Set from the editor state ({@link setWorkspaceFonts}).
 */
let own = new Map<string, { family: string; ascent: number; descent: number }>();

/** The workspace's fonts the editor draws and offers; loads their faces. */
export function setWorkspaceFonts(fonts: readonly WorkspaceFont[]): void {
  const next = new Map<string, { family: string; ascent: number; descent: number }>();
  // The regular face's metrics stand for the family, else the first face's.
  const ordered = [...fonts].sort(
    (a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic),
  );
  for (const font of ordered) {
    const key = font.family.toLowerCase();
    if (next.has(key)) continue;
    next.set(key, {
      family: font.family,
      ascent: font.ascent / font.upm,
      descent: font.descent / font.upm,
    });
  }
  own = next;
  loadWorkspaceFonts(fonts);
}

const ownFont = (name: string) =>
  own.get(
    name
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .toLowerCase(),
  ) ?? null;

/** The CSS `font-family` a file's font name is drawn in: the workspace's own, else an office font. */
export function fontCss(name: string): string {
  const mine = ownFont(name);
  const office = cssFamily(officeFont(name));
  return mine ? `${workspaceCssFamily(mine.family)}, ${office}` : office;
}

/** Ascent and descent in em of a file's font name, as LibreOffice measures the font it draws. */
export function metricsFor(name: string): { ascent: number; descent: number } {
  const mine = ownFont(name);
  return mine ? { ascent: mine.ascent, descent: mine.descent } : fontMetrics(officeFont(name));
}

/** The fonts the editor offers: {@link EDITOR_FONTS} and the workspace's own. */
export function editorFonts(): string[] {
  const names = new Map<string, string>(EDITOR_FONTS.map((name) => [name.toLowerCase(), name]));
  for (const [key, font] of own) names.set(key, font.family);
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

const FACES: [weight: number, style: 'normal' | 'italic'][] = [
  [400, 'normal'],
  [700, 'normal'],
  [400, 'italic'],
  [700, 'italic'],
];

const percent = (share: number) => `${Number((share * 100).toFixed(4))}%`;

/** The faces of an office font that have files of their own – the others are synthesised. */
export const officeFontStyles = (font: OfficeFont) =>
  FACES.filter((_, i) => FONTS[font].files[i]).map(([weight, style]) => ({
    weight: weight as 400 | 700,
    italic: style === 'italic',
  }));

const registered = new Set<OfficeFont>();

/**
 * Registers the office fonts' faces through the FontFace API, for pages without the editor's
 * `office-fonts.css` (the workspace's fonts page). Not loaded here: the browser fetches a face
 * once text on the page uses it.
 */
export function registerOfficeFonts(base = '/fonts/office'): void {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;
  for (const name of OFFICE_FONTS) {
    if (registered.has(name)) continue;
    registered.add(name);
    const font = FONTS[name];
    FACES.forEach(([weight, style], i) => {
      const file = font.files[i];
      if (!file) return;
      document.fonts.add(
        new FontFace(`Slider ${name}`, `url(${base}/${file}.woff2) format('woff2')`, {
          weight: String(weight),
          style,
          display: 'block',
          ascentOverride: percent(font.ascent / font.upm),
          descentOverride: percent(font.descent / font.upm),
          lineGapOverride: '0%',
        }),
      );
    });
  }
}

/**
 * `@font-face` rules for every office font, the files under `base`. The editor loads them as
 * `office-fonts.css` (a stylesheet of the app's own: the page allows no inline styles).
 */
export function officeFontFaces(base = '/fonts/office'): string {
  return OFFICE_FONTS.flatMap((name) => {
    const font = FONTS[name];
    return FACES.flatMap(([weight, style], i) => {
      const file = font.files[i];
      if (!file) return [];
      return [
        `@font-face{font-family:'Slider ${name}';src:url('${base}/${file}.woff2') format('woff2');` +
          `font-weight:${weight};font-style:${style};font-display:block;` +
          `ascent-override:${percent(font.ascent / font.upm)};` +
          `descent-override:${percent(font.descent / font.upm)};line-gap-override:0%}`,
      ];
    });
  }).join('\n');
}

/** The CSS `font` of each face a text is drawn in: its runs', marks' and bullets'. */
function facesOf(live: LiveElement): string[] {
  const faces = new Set<string>();
  const add = (font: string, bold = false, italic = false) =>
    faces.add(`${italic ? 'italic' : 'normal'} ${bold ? 700 : 400} 16px ${fontCss(font)}`);
  for (const paragraph of live.paragraphs) {
    for (const style of [paragraph.mark, ...paragraph.runs])
      add(style.font, style.bold, style.italic);
    if (paragraph.bullet?.font) add(paragraph.bullet.font);
  }
  return [...faces];
}

/** Whether a text's faces are loaded: drawn now, it lays out as it will stay. */
export function fontsLoaded(live: LiveElement): boolean {
  if (typeof document === 'undefined' || !document.fonts) return true;
  return facesOf(live).every((face) => document.fonts.check(face));
}

/**
 * Loads a text's faces (`font-display: block` would only load them once drawn, laid out in
 * another font meanwhile). Settles once all are there, or failed.
 */
export function loadFonts(live: LiveElement): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  return Promise.allSettled(facesOf(live).map((face) => document.fonts.load(face))).then(
    () => undefined,
  );
}
