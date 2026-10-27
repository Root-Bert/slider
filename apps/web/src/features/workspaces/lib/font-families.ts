import {
  OFFICE_FONT_SUBSTITUTES,
  OFFICE_FONTS,
  type OfficeFont,
  type WorkspaceFont,
} from '@slider/shared';
import { workspaceCssFamily } from '@/lib/workspace-fonts';
import { cssFamily, officeFontStyles } from '@/features/viewer';

export type MaterialView = 'grid' | 'list';

/** One face of a family: regular, italic, bold or bold italic. */
export interface FontStyle {
  weight: 400 | 700;
  italic: boolean;
}

/**
 * A font family on the workspace page: one Slider brings along (drawn alike by LibreOffice and
 * the editor on every server) or one the workspace uploaded or took from a review's file.
 */
export interface FontFamily {
  family: string;
  source: 'slider' | 'workspace';
  /** The CSS `font-family` it is drawn in. */
  css: string;
  /** In the usual order: regular, italic, bold, bold italic. */
  faces: FontStyle[];
  /** Uploaded files together; `null` for Slider's. */
  sizeBytes: number | null;
  /** Office fonts it stands in for (Carlito: Calibri, Calibri Light). */
  standsIn: string[];
  /** The review it came embedded in, taken over from its file; `null`: uploaded or Slider's. */
  takenFrom: string | null;
}

const FACE_LABELS = ['Normal', 'Kursiv', 'Fett', 'Fett kursiv'];
const faceIndex = (face: FontStyle) => (face.weight === 700 ? 2 : 0) + (face.italic ? 1 : 0);
export const faceLabel = (face: FontStyle) => FACE_LABELS[faceIndex(face)] as string;
const inOrder = <T extends FontStyle>(faces: readonly T[]) =>
  faces.toSorted((a, b) => faceIndex(a) - faceIndex(b));

/** The workspace's fonts grouped by family, each family's faces in the usual order. */
export function groupFamilies(fonts: readonly WorkspaceFont[]): FontFamily[] {
  const families = new Map<string, WorkspaceFont[]>();
  for (const font of fonts) families.set(font.family, [...(families.get(font.family) ?? []), font]);
  return [...families].map(([family, faces]) => ({
    family,
    source: 'workspace',
    css: workspaceCssFamily(family),
    faces: inOrder(faces).map(({ weight, italic }) => ({ weight, italic })),
    sizeBytes: faces.reduce((total, face) => total + face.sizeBytes, 0),
    standsIn: [],
    takenFrom: faces.find((face) => face.sourceFile)?.sourceFile ?? null,
  }));
}

/** Slider's own fonts – every office font but the symbol one, which has no letters to show. */
export function sliderFamilies(): FontFamily[] {
  return OFFICE_FONTS.filter((font) => font !== 'OpenSymbol').map((font: OfficeFont) => ({
    family: font,
    source: 'slider',
    css: cssFamily(font),
    faces: inOrder(officeFontStyles(font)),
    sizeBytes: null,
    standsIn: Object.entries(OFFICE_FONT_SUBSTITUTES)
      .filter(([, twin]) => twin === font)
      .map(([name]) => name),
    takenFrom: null,
  }));
}

/** A whole number from a name – the same font always gets the same look. */
export function hashName(name: string): number {
  let hash = 2166136261;
  for (const char of name) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619);
  return hash >>> 0;
}

/**
 * The poster layouts (`FontPoster`): a giant "Ag", a giant initial, a waterfall, a glyph table,
 * the name set upright along the edge.
 */
export const POSTER_LAYOUTS = 5;

/** A font's poster: which of the layouts, and whether it is printed on paper (about one in three). */
export function posterLook(family: Pick<FontFamily, 'family'>) {
  const hash = hashName(family.family);
  return {
    layout: hash % POSTER_LAYOUTS,
    paper: Math.floor(hash / POSTER_LAYOUTS) % 3 === 0,
  };
}

/** A family's key: the same name may be one of Slider's and uploaded too. */
export const familyKey = (family: Pick<FontFamily, 'source' | 'family'>) =>
  `${family.source}:${family.family}`;
