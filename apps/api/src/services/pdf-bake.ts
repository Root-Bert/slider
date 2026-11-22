import {
  degrees,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFPage,
} from '@cantoo/pdf-lib';
import type { ReaderMark, ReaderRect } from '@slider/shared';
import { badRequest } from '../http/errors';

/*
 * What was filled in on a PDF, baked into a copy of it: the file's form fields get their values
 * (they stay fields), text, ticks and signatures are drawn onto their pages. The file in Cloud
 * stays as it came. Places are fractions of the page as it is shown – turned by its `/Rotate`,
 * cut to its CropBox, as pdf.js shows it in the browser.
 */

/** A point of the page as shown (fractions from its top left) in the page's own space. */
export function pagePoint(
  box: { x: number; y: number; width: number; height: number },
  rotation: number,
  fx: number,
  fy: number,
): { x: number; y: number } {
  const { x, y, width: w, height: h } = box;
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: x + fy * w, y: y + fx * h };
    case 180:
      return { x: x + w - fx * w, y: y + fy * h };
    case 270:
      return { x: x + w - fy * w, y: y + h - fx * h };
    default:
      return { x: x + fx * w, y: y + h - fy * h };
  }
}

interface Shown {
  page: PDFPage;
  box: { x: number; y: number; width: number; height: number };
  rotation: number;
  /** The page's width and height as shown. */
  width: number;
  height: number;
}

function shown(page: PDFPage): Shown {
  const box = page.getCropBox();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const across = rotation === 90 || rotation === 270;
  return {
    page,
    box,
    rotation,
    width: across ? box.height : box.width,
    height: across ? box.width : box.height,
  };
}

/** Text the standard font can write: what it cannot becomes „?“. */
function writable(font: PDFFont, text: string): string {
  let out = '';
  for (const char of text) {
    try {
      font.encodeText(char);
      out += char;
    } catch {
      out += '?';
    }
  }
  return out;
}

function drawText(on: Shown, font: PDFFont, rect: ReaderRect, text: string, size: number) {
  const lineHeight = size * 1.2;
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    // The first baseline one size down from the box's top, as the browser sets it.
    const fy = rect.y + (index * lineHeight + size * 0.95) / on.height;
    const at = pagePoint(on.box, on.rotation, rect.x + 2 / on.width, fy);
    on.page.drawText(writable(font, line), {
      x: at.x,
      y: at.y,
      size,
      font,
      color: rgb(0.08, 0.08, 0.1),
      rotate: degrees(on.rotation),
    });
  });
}

function drawCheck(on: Shown, rect: ReaderRect) {
  const point = (fx: number, fy: number) =>
    pagePoint(on.box, on.rotation, rect.x + fx * rect.w, rect.y + fy * rect.h);
  const thickness = Math.max(1, Math.min(rect.w * on.width, rect.h * on.height) * 0.12);
  const a = point(0.18, 0.55);
  const b = point(0.42, 0.8);
  const c = point(0.84, 0.2);
  const color = rgb(0.08, 0.08, 0.1);
  on.page.drawLine({ start: a, end: b, thickness, color });
  on.page.drawLine({ start: b, end: c, thickness, color });
}

async function drawSignature(doc: PDFDocument, on: Shown, rect: ReaderRect, image: string) {
  const png = await doc.embedPng(Buffer.from(image.slice(image.indexOf(',') + 1), 'base64'));
  // Its bottom left corner as shown, turned with the page so it stands upright.
  const at = pagePoint(on.box, on.rotation, rect.x, rect.y + rect.h);
  on.page.drawImage(png, {
    x: at.x,
    y: at.y,
    width: rect.w * on.width,
    height: rect.h * on.height,
    rotate: degrees(on.rotation),
  });
}

/** „Fit to the box“ (size 0) set as Reader shows it (the `fontSize` of `Field` in the viewer). */
function fitSize(field: PDFTextField | PDFDropdown | PDFOptionList, lines: boolean) {
  const da = field.acroField.getDefaultAppearance() ?? '';
  if (/[1-9][\d.]*\s+Tf/.test(da)) return;
  const height = field.acroField.getWidgets()[0]?.getRectangle().height ?? 0;
  field.setFontSize(lines ? 10 : Math.max(6, Math.min(12, height * 0.6)));
}

function fillField(doc: PDFDocument, name: string, value: string | boolean, font: PDFFont) {
  const field = doc.getForm().getFieldMaybe(name);
  if (!field) return false;
  try {
    if (field instanceof PDFTextField) {
      field.setText(typeof value === 'string' ? writable(font, value) : '');
      fitSize(field, field.isMultiline());
      field.updateAppearances(font);
    } else if (field instanceof PDFCheckBox) {
      if (value === true || (typeof value === 'string' && value !== '' && value !== 'Off'))
        field.check();
      else field.uncheck();
    } else if (field instanceof PDFRadioGroup) {
      if (typeof value === 'string' && field.getOptions().includes(value)) field.select(value);
      else field.clear();
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      if (typeof value === 'string' && value !== '') field.select(value);
      else field.clear();
      // The file is saved without redrawing every field: the picked one is drawn here.
      fitSize(field, field instanceof PDFOptionList);
      field.updateAppearances(font);
    } else return false;
    return true;
  } catch {
    // A field the file built in a way pdf-lib cannot write: left as it is.
    return false;
  }
}

/** The PDF with `marks` baked in. */
export async function bakePdf(
  bytes: Uint8Array,
  marks: readonly ReaderMark[],
): Promise<Uint8Array> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw badRequest('Dieses PDF lässt sich nicht ausgefüllt speichern. Die Datei ist beschädigt.');
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages().map(shown);
  let fields = false;
  for (const mark of marks) {
    if (mark.kind === 'field') {
      fields = fillField(doc, mark.name, mark.value, font) || fields;
      continue;
    }
    const on = pages[mark.page];
    if (!on) continue;
    if (mark.kind === 'text') drawText(on, font, mark.rect, mark.text, mark.size);
    else if (mark.kind === 'check') drawCheck(on, mark.rect);
    else await drawSignature(doc, on, mark.rect, mark.image);
  }
  // A form also described as XFA shows that in some readers – without the values.
  if (fields) doc.getForm().deleteXFA();
  return doc.save({ updateFieldAppearances: false });
}
