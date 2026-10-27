import { OdpDocument, OdpError, isOdpBytes, type OdpSlide } from '@slider/odp';
import { textHash, type ParsedShape, type ParsedShapeKind, type ParsedSlide } from '@slider/pptx';
import type { EditableElementKind } from '@slider/shared';
import { notAPowerPoint } from '../http/errors';
import { isPdfBytes } from '../sources/safe-fetch';
import type { DeckFileExtension } from '../storage/blob-storage';
import { PAGE_PATH } from './pdf-pages';
import type { PptxDocument } from './pptx';

/*
 * An ODP (OpenDocument presentation, from Nextcloud or an upload) as a deck that stays an ODP
 * and can be edited in Slider (BER-177). For the import it reads like a PDF review deck: every
 * slide a page without a PowerPoint id (matched by what it shows), its elements the boxes.
 * LibreOffice draws its pictures – ODP is LibreOffice's own format, so they are exact.
 */

const EMU_PER_CM = 360_000;

/** What a revision's original is stored as, told by its bytes. */
export const deckFileExtension = (bytes: Uint8Array): DeckFileExtension =>
  isPdfBytes(bytes) ? 'pdf' : isOdpBytes(bytes) ? 'odp' : 'pptx';

export const isOdpKey = (key: string | null): boolean => key?.endsWith('.odp') ?? false;

const SHAPE_KIND: Record<EditableElementKind, ParsedShapeKind> = {
  text: 'text',
  shape: 'text',
  image: 'picture',
  table: 'table',
  group: 'other',
  other: 'other',
};

/**
 * An ODP as Slider keeps it: every element with an id, without links LibreOffice could follow
 * out of the file. A file that is no readable presentation is `not_a_powerpoint`.
 */
export async function prepareOdp(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    const document = await OdpDocument.open(bytes);
    document.ensureIds();
    document.removeExternalLinks();
    return document.changed ? await document.toBytes() : bytes;
  } catch (error) {
    if (error instanceof OdpError) {
      throw notAPowerPoint(
        error.code === 'unsupported'
          ? 'Das ist keine Präsentation – Slider öffnet ODP-Präsentationen, aber keine Texte oder Tabellen im ODF-Format.'
          : 'Slider konnte die Präsentation nicht lesen – ist sie beschädigt oder passwortgeschützt?',
      );
    }
    throw error;
  }
}

/** The slide's elements as box-mode shapes (`slide_versions.shapes`). */
export function odpShapes(slide: OdpSlide): ParsedShape[] {
  return slide.elements
    .filter((element) => element.bbox.w > 0 || element.bbox.h > 0)
    .map((element) => ({
      id: element.id,
      name: element.name,
      kind: SHAPE_KIND[element.kind],
      bbox: element.bbox,
      text: element.paragraphs?.join('\n') ?? '',
      paragraphs: [],
      imagePath: null,
      fill: null,
      placeholder: element.role,
    }));
}

export function odpParsedSlide(slide: OdpSlide): ParsedSlide {
  const shapes = odpShapes(slide);
  return {
    // No PowerPoint id: `PAGE_PATH` makes it a page that is matched by its content (`isPdfPage`).
    sldId: 0,
    index: slide.index,
    path: `${PAGE_PATH}${slide.index + 1}`,
    hidden: slide.hidden,
    title: slide.title,
    layoutName: null,
    textHash: textHash(shapes.map((shape) => shape.text).join('\n')),
    contentHash: slide.fingerprint,
    creationId: null,
    shapes,
    groups: [],
    background: null,
    guides: [],
  };
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The SVG preview that stands in until (or when) LibreOffice draws the slide: its texts. */
function previewSvg(slide: ParsedSlide, width: number, height: number): string {
  const texts = slide.shapes
    .filter((shape) => shape.text)
    .map((shape) => {
      const size = Math.max(6, Math.min(shape.bbox.h * height * 0.6, height / 12));
      const first = shape.text.split('\n')[0] ?? '';
      return `<text x="${(shape.bbox.x * width).toFixed(1)}" y="${(shape.bbox.y * height + size).toFixed(1)}" font-family="sans-serif" font-size="${size.toFixed(1)}">${escapeXml(first)}</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><desc>odp ${slide.contentHash}</desc><rect width="100%" height="100%" fill="#ffffff"/>${texts}</svg>`;
}

/** The SVG that stands in for a slide LibreOffice does not draw (a hidden one): its texts. */
export function odpPreviewSvg(slide: OdpSlide, size: { width: number; height: number }): string {
  const width = 960;
  return previewSvg(odpParsedSlide(slide), width, Math.round((width * size.height) / size.width));
}

/** An ODP as the import reads a deck. */
export async function openOdpDeck(bytes: Uint8Array): Promise<PptxDocument> {
  let document: OdpDocument;
  try {
    document = await OdpDocument.open(bytes);
  } catch (error) {
    if (error instanceof OdpError)
      throw notAPowerPoint('Slider konnte die Präsentation nicht lesen.');
    throw error;
  }
  const size = document.pageSize();
  const width = 960;
  const height = Math.round((width * size.height) / size.width);
  return {
    presentation: {
      size: { cx: Math.round(size.width * EMU_PER_CM), cy: Math.round(size.height * EMU_PER_CM) },
      slides: document.slides().map(odpParsedSlide),
      sections: [],
      comments: [],
      author: null,
    },
    renderSlideSvg: async (slide) => previewSvg(slide, width, height),
  };
}
