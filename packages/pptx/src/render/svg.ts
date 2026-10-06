import type { Rect } from '@slider/shared';
import { EMU_PER_INCH, EMU_PER_POINT } from '../transform';
import type { ParsedParagraph, ParsedShape, ParsedSlide } from '../types';
import { escapeXml, imageMimeType, num, safeColor, toBase64 } from './encoding';

/**
 * Preview renderer: turns a parsed slide into a self-contained SVG. It approximates PowerPoint
 * (rectangles for fills, wrapped HTML text, images, simple tables) and is meant for quick
 * previews and annotation backdrops; pixel-faithful rendering is a separate LibreOffice adapter.
 */

export const RENDER_WIDTH = 1920;

const DEFAULT_FONT_SIZE_PT = 18;
const DEFAULT_TABLE_FONT_SIZE_PT = 14;
const DEFAULT_TEXT_COLOR = '#000000';
const FONT_FAMILY = 'Inter, Arial, sans-serif';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/** PowerPoint's default text box insets: 0.1" left/right, 0.05" top/bottom. */
const INSET_X_EMU = EMU_PER_INCH * 0.1;
const INSET_Y_EMU = EMU_PER_INCH * 0.05;

export type ImageLoader = (path: string) => Promise<Uint8Array | null>;

interface Canvas {
  width: number;
  height: number;
  /** Pixels per EMU. */
  scale: number;
}

export async function renderSlideSvg(
  slide: ParsedSlide,
  size: { cx: number; cy: number },
  loadImage: ImageLoader,
): Promise<string> {
  const scale = RENDER_WIDTH / size.cx;
  const canvas: Canvas = { width: RENDER_WIDTH, height: Math.round(size.cy * scale), scale };
  const background = safeColor(slide.background) ?? '#ffffff';

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">`,
    `<rect width="${canvas.width}" height="${canvas.height}" fill="${background}"/>`,
  ];
  for (const shape of slide.shapes) {
    parts.push(await renderShape(shape, canvas, loadImage));
  }
  parts.push('</svg>');
  return parts.filter(Boolean).join('');
}

async function renderShape(
  shape: ParsedShape,
  canvas: Canvas,
  loadImage: ImageLoader,
): Promise<string> {
  const box = toPixels(shape.bbox, canvas);
  if (box.width <= 0 || box.height <= 0) return '';
  switch (shape.kind) {
    case 'picture':
      return renderPicture(shape, box, loadImage);
    case 'table':
      return renderTable(shape, box, canvas);
    case 'connector':
      // Connectors need line geometry (flips, arrow heads) the parser does not keep yet.
      return '';
    default:
      return renderFill(shape, box) + renderText(shape, box, canvas);
  }
}

interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function toPixels(rect: Rect, canvas: Canvas): PixelBox {
  return {
    x: rect.x * canvas.width,
    y: rect.y * canvas.height,
    width: rect.w * canvas.width,
    height: rect.h * canvas.height,
  };
}

const boxAttributes = (box: PixelBox): string =>
  `x="${num(box.x)}" y="${num(box.y)}" width="${num(box.width)}" height="${num(box.height)}"`;

function renderFill(shape: ParsedShape, box: PixelBox): string {
  const fill = safeColor(shape.fill);
  return fill ? `<rect ${boxAttributes(box)} fill="${fill}"/>` : '';
}

async function renderPicture(
  shape: ParsedShape,
  box: PixelBox,
  loadImage: ImageLoader,
): Promise<string> {
  const mimeType = shape.imagePath ? imageMimeType(shape.imagePath) : null;
  const bytes = shape.imagePath && mimeType ? await loadImage(shape.imagePath) : null;
  if (!mimeType || !bytes) {
    return `<rect ${boxAttributes(box)} fill="#f3f4f6" stroke="#d1d5db" stroke-width="2"/>`;
  }
  const href = `data:${mimeType};base64,${toBase64(bytes)}`;
  return `<image ${boxAttributes(box)} preserveAspectRatio="none" href="${href}"/>`;
}

function renderText(shape: ParsedShape, box: PixelBox, canvas: Canvas): string {
  if (!shape.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text !== ''))) {
    return '';
  }
  const pxPerPoint = EMU_PER_POINT * canvas.scale;
  // Title placeholders are vertically centred in PowerPoint's default masters; body text is top-aligned.
  const isTitle = shape.placeholder === 'title' || shape.placeholder === 'ctrTitle';
  const containerStyle = [
    'width:100%',
    'height:100%',
    'box-sizing:border-box',
    `padding:${num(INSET_Y_EMU * canvas.scale)}px ${num(INSET_X_EMU * canvas.scale)}px`,
    'display:flex',
    'flex-direction:column',
    `justify-content:${isTitle ? 'center' : 'flex-start'}`,
    'overflow:hidden',
    `font-family:${FONT_FAMILY}`,
    `color:${DEFAULT_TEXT_COLOR}`,
    'line-height:1.2',
    'white-space:pre-wrap',
    'overflow-wrap:break-word',
  ].join(';');
  const paragraphs = shape.paragraphs
    .map((paragraph) => renderParagraph(paragraph, pxPerPoint))
    .join('');
  return foreignObject(
    box,
    `<div xmlns="${XHTML_NS}" style="${containerStyle}">${paragraphs}</div>`,
  );
}

function renderParagraph(paragraph: ParsedParagraph, pxPerPoint: number): string {
  const paragraphSize = (paragraph.runs[0]?.sizePt ?? DEFAULT_FONT_SIZE_PT) * pxPerPoint;
  const runs = paragraph.runs
    .map((run) => {
      const style = [`font-size:${num((run.sizePt ?? DEFAULT_FONT_SIZE_PT) * pxPerPoint)}px`];
      if (run.bold) style.push('font-weight:700');
      if (run.italic) style.push('font-style:italic');
      const color = safeColor(run.color);
      if (color) style.push(`color:${color}`);
      return `<span style="${style.join(';')}">${escapeXml(run.text)}</span>`;
    })
    .join('');
  const style = `margin:0;min-height:1.2em;text-align:${paragraph.align};font-size:${num(paragraphSize)}px`;
  return `<p style="${style}">${runs}</p>`;
}

function renderTable(shape: ParsedShape, box: PixelBox, canvas: Canvas): string {
  const rows = shape.tableRows ?? [];
  if (rows.length === 0) return '';
  const fontSize = num(DEFAULT_TABLE_FONT_SIZE_PT * EMU_PER_POINT * canvas.scale);
  const padding = num(INSET_X_EMU * canvas.scale);
  const cellStyle = `border:1px solid #9ca3af;padding:${padding}px;vertical-align:top;overflow-wrap:break-word`;
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell) => {
          const weight = rowIndex === 0 ? ';font-weight:700;background:#f3f4f6' : '';
          return `<td style="${cellStyle}${weight}">${escapeXml(cell)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  const tableStyle = `width:100%;height:100%;border-collapse:collapse;table-layout:fixed;font-family:${FONT_FAMILY};font-size:${fontSize}px;color:${DEFAULT_TEXT_COLOR};white-space:pre-wrap`;
  return foreignObject(
    box,
    `<table xmlns="${XHTML_NS}" style="${tableStyle}"><tbody>${body}</tbody></table>`,
  );
}

const foreignObject = (box: PixelBox, content: string): string =>
  `<foreignObject ${boxAttributes(box)}>${content}</foreignObject>`;
