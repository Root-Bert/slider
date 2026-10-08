import type { Guide, Point, Rect } from '@slider/shared';

/**
 * Public result types of the PPTX parser (BER-93, BER-112, BER-113).
 * All geometry is normalised to the slide size (0–1).
 */

export interface ParsedPresentation {
  /** Slide size in EMU (`p:sldSz`). */
  size: { cx: number; cy: number };
  /** Slides in presentation order, including hidden ones. */
  slides: ParsedSlide[];
  /** `p14:sectionLst`; each section lists the `sldId`s it contains. */
  sections: { name: string; slideIds: number[] }[];
  /** PowerPoint comments (modern and legacy) across all slides. */
  comments: ParsedComment[];
}

export interface ParsedSlide {
  /** `p:sldId/@id` – PowerPoint's stable slide id. */
  sldId: number;
  /** 0-based position in `p:sldIdLst`. */
  index: number;
  /** Zip path, e.g. `ppt/slides/slide3.xml`. */
  path: string;
  /** `show="0"` on `p:sld`. */
  hidden: boolean;
  /** Text of the title / ctrTitle placeholder, if any. */
  title: string | null;
  layoutName: string | null;
  /** Normalised full text (lower-case, collapsed whitespace) hashed with FNV-1a, hex. */
  textHash: string;
  shapes: ParsedShape[];
  /** Solid background colour as `#rrggbb`, if one is set on slide, layout or master. */
  background: string | null;
  /** Drawing guides shown on the slide: the presentation's, its master's and its layout's. */
  guides: Guide[];
}

export type ParsedShapeKind = 'text' | 'picture' | 'table' | 'connector' | 'other';

export interface ParsedShape {
  /** `p:cNvPr/@id`, as string. */
  id: string;
  name: string;
  kind: ParsedShapeKind;
  /** Bounding box, normalised, after applying group transforms and placeholder inheritance. */
  bbox: Rect;
  /** Plain text, paragraphs joined with `\n`. */
  text: string;
  /** Rich text for rendering; empty for non-text shapes. */
  paragraphs: ParsedParagraph[];
  /** Zip path of the embedded image for pictures (e.g. `ppt/media/image1.png`). */
  imagePath: string | null;
  /** Solid fill as `#rrggbb`, if any. */
  fill: string | null;
  /** Placeholder type (`title`, `body`, `ctrTitle`, …), if this is a placeholder. */
  placeholder: string | null;
  /** Tables only: cell texts row by row (`text` holds the same, tab/newline separated). */
  tableRows?: string[][];
}

export interface ParsedParagraph {
  align: 'left' | 'center' | 'right' | 'justify';
  runs: ParsedRun[];
}

export interface ParsedRun {
  text: string;
  /** Font size in points, if specified on the run or inherited from the placeholder. */
  sizePt: number | null;
  bold: boolean;
  italic: boolean;
  /** `#rrggbb`, if specified. */
  color: string | null;
}

export type ParsedCommentAnchor =
  { type: 'slide' } | { type: 'point'; point: Point } | { type: 'shape'; shapeId: string };

export interface ParsedComment {
  /** Stable id for idempotent import: modern → comment GUID, legacy → `authorId:idx`. */
  externalId: string;
  format: 'modern' | 'legacy';
  /** `sldId` of the slide the comment belongs to. */
  sldId: number;
  author: { name: string; initials: string | null };
  createdAt: string | null;
  text: string;
  status: 'open' | 'done';
  anchor: ParsedCommentAnchor;
  /** Modern comments only; legacy comments are flat. */
  replies: ParsedReply[];
}

export interface ParsedReply {
  externalId: string;
  author: { name: string; initials: string | null };
  createdAt: string | null;
  text: string;
}

/** Thrown for encrypted (password protected), corrupt or non-PPTX input. */
export class PptxError extends Error {
  constructor(
    readonly code: 'encrypted' | 'corrupt' | 'not_pptx',
    message: string,
  ) {
    super(message);
    this.name = 'PptxError';
  }
}
