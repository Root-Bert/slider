/**
 * A minimal valid PDF with `pageCount` 16:9 pages (or `size` in points), each with a red bar on
 * the left – enough for pdf.js to render without any fonts.
 */
export function makePdf(
  pageCount: number,
  size: { width: number; height: number } = { width: 960, height: 540 },
): Uint8Array {
  const content = '1 0 0 rg 0 0 300 540 re f';
  const pageIds = Array.from({ length: pageCount }, (_, i) => 4 + i);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ...pageIds.map(
      () =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size.width} ${size.height}] /Contents 3 0 R >>`,
    ),
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [i, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

/** A page of {@link makeSlidesPdf}: lines of text (Helvetica) and filled boxes, in points. */
export interface PdfPage {
  texts: { text: string; x: number; y: number; size: number }[];
  boxes?: { x: number; y: number; w: number; h: number; rgb: [number, number, number] }[];
}

/**
 * A PDF of 960 × 540 pt slides with real text and filled boxes – what a deck exported from
 * Keynote or Google Slides looks like to pdf.js. `y` counts from the top.
 */
export function makeSlidesPdf(pages: PdfPage[]): Uint8Array<ArrayBuffer> {
  const objects: string[] = [];
  const add = (object: string) => objects.push(object);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(''); // the page tree, filled in below
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds: number[] = [];
  for (const page of pages) {
    const ops = [
      ...(page.boxes ?? []).map(
        (b) =>
          `${b.rgb.map((c) => (c / 255).toFixed(3)).join(' ')} rg ${b.x} ${540 - b.y - b.h} ${b.w} ${b.h} re f`,
      ),
      '0 0 0 rg',
      ...page.texts.map(
        (t) => `BT /F1 ${t.size} Tf ${t.x} ${540 - t.y - t.size} Td (${t.text}) Tj ET`,
      ),
    ].join('\n');
    add(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
    const contents = objects.length;
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contents} 0 R >>`,
    );
    pageIds.push(objects.length);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [i, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
