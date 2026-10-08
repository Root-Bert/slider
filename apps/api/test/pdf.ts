/**
 * A minimal valid PDF with `pageCount` 16:9 pages, each with a red bar on the left – enough for
 * pdf.js to render without any fonts.
 */
export function makePdf(pageCount: number): Uint8Array {
  const content = '1 0 0 rg 0 0 300 540 re f';
  const pageIds = Array.from({ length: pageCount }, (_, i) => 4 + i);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ...pageIds.map(() => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Contents 3 0 R >>'),
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
