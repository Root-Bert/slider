import { closePdf, drawPage, openPdfFile } from './pdf';

/** Sharp enough for paper: 150 dpi. */
const PRINT_SCALE = 150 / 72;

/**
 * Prints the PDF as it leaves Reader – everything filled in baked in: each page drawn as a
 * picture into a part of the page only the printer sees, the browser's print opened, the part
 * gone after. No frame carries it: the page's policy names none (`frame-src 'none'` in the API's
 * `http/csp.ts`) – only reported while `ENFORCE_CSP` is off, but a frame would break once it is on.
 */
export async function printPdf(bytes: ArrayBuffer, title: string) {
  const doc = await openPdfFile(bytes);
  const host = document.createElement('div');
  host.className = 'reader-print-host';
  const sheets = document.createElement('div');
  sheets.className = 'reader-print';
  host.append(sheets);
  const urls: string[] = [];
  const page0 = await doc.getPage(1);
  const first = page0.getViewport({ scale: 1 });
  const style = document.createElement('style');
  style.textContent = `@page { size: ${first.width}pt ${first.height}pt; margin: 0 }`;
  try {
    for (let index = 1; index <= doc.numPages; index += 1) {
      const page = await doc.getPage(index);
      const canvas = document.createElement('canvas');
      await drawPage(page, canvas, PRINT_SCALE, { ratio: 1, forms: true }).promise;
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const image = document.createElement('img');
      image.src = url;
      image.alt = '';
      sheets.append(image);
      page.cleanup();
    }
    document.head.append(style);
    document.body.append(host);
    await Promise.all([...sheets.querySelectorAll('img')].map((image) => image.decode()));
    const before = document.title;
    document.title = title;
    await new Promise<void>((done) => {
      const after = () => {
        window.removeEventListener('afterprint', after);
        done();
      };
      window.addEventListener('afterprint', after);
      window.print();
      // Browsers whose print does not wait: the part stays a moment for the dialog to read it.
      window.setTimeout(after, 60_000);
    });
    document.title = before;
  } finally {
    host.remove();
    style.remove();
    for (const url of urls) URL.revokeObjectURL(url);
    void closePdf(doc);
  }
}
