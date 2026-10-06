import type { ParsedParagraph, ParsedRun } from './types';
import { solidFillOf, type ColorScheme } from './colors';
import { attr, boolAttr, child, children, intAttr, type XmlElement } from './xml';

/** Paragraph defaults a shape inherits from its own list style or its placeholder chain. */
export interface TextDefaults {
  sizePt: number | null;
  align: ParsedParagraph['align'] | null;
}

export const NO_TEXT_DEFAULTS: TextDefaults = { sizePt: null, align: null };

const ALIGNMENTS: Record<string, ParsedParagraph['align']> = {
  l: 'left',
  ctr: 'center',
  r: 'right',
  just: 'justify',
  dist: 'justify',
};

/**
 * Reads the first-level defaults of a list style (`a:lstStyle`, `p:titleStyle`, `p:bodyStyle`).
 * Only `a:lvl1pPr` is considered – nested bullet levels are out of scope for previews.
 */
export function readListStyleDefaults(listStyle: XmlElement | undefined): TextDefaults {
  const level1 = child(listStyle, 'a:lvl1pPr');
  return {
    sizePt: hundredthsToPoints(intAttr(child(level1, 'a:defRPr'), 'sz')),
    align: ALIGNMENTS[attr(level1, 'algn') ?? ''] ?? null,
  };
}

/** Fills the gaps of `primary` with values from `fallback`. */
export function mergeTextDefaults(primary: TextDefaults, fallback: TextDefaults): TextDefaults {
  return { sizePt: primary.sizePt ?? fallback.sizePt, align: primary.align ?? fallback.align };
}

/** Converts a `p:txBody` / `a:txBody` into rich paragraphs. */
export function readParagraphs(
  txBody: XmlElement | undefined,
  inherited: TextDefaults,
  scheme: ColorScheme,
): ParsedParagraph[] {
  if (!txBody) return [];
  const defaults = mergeTextDefaults(readListStyleDefaults(child(txBody, 'a:lstStyle')), inherited);
  return children(txBody, 'a:p').map((paragraph) => ({
    align: ALIGNMENTS[attr(child(paragraph, 'a:pPr'), 'algn') ?? ''] ?? defaults.align ?? 'left',
    runs: readRuns(paragraph, defaults, scheme),
  }));
}

function readRuns(paragraph: XmlElement, defaults: TextDefaults, scheme: ColorScheme): ParsedRun[] {
  const runs: ParsedRun[] = [];
  for (const element of paragraph.children) {
    if (element.name === 'a:br') {
      runs.push({ text: '\n', sizePt: defaults.sizePt, bold: false, italic: false, color: null });
      continue;
    }
    // Text fields (`a:fld`, e.g. slide numbers) carry their last rendered value like a run.
    if (element.name !== 'a:r' && element.name !== 'a:fld') continue;
    const properties = child(element, 'a:rPr');
    runs.push({
      text: child(element, 'a:t')?.text ?? '',
      sizePt: hundredthsToPoints(intAttr(properties, 'sz')) ?? defaults.sizePt,
      bold: boolAttr(properties, 'b') ?? false,
      italic: boolAttr(properties, 'i') ?? false,
      color: solidFillOf(properties, scheme),
    });
  }
  return runs;
}

/** Plain text of paragraphs, joined with `\n`. */
export function paragraphsToText(paragraphs: ParsedParagraph[]): string {
  return paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');
}

/** Plain text of any element containing `a:p` paragraphs (comment bodies, table cells). */
export function plainText(txBody: XmlElement | undefined): string {
  return children(txBody, 'a:p')
    .map((paragraph) =>
      paragraph.children
        .map((element) => (element.name === 'a:br' ? '\n' : (child(element, 'a:t')?.text ?? '')))
        .join(''),
    )
    .join('\n');
}

function hundredthsToPoints(value: number | undefined): number | null {
  return value === undefined ? null : value / 100;
}
