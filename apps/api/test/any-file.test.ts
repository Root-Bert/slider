import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it, vi } from 'vitest';
import { imageSize, toDeckBytes } from '../src/import/any-file';
import { pdfMakerOf } from '../src/import/pdf-maker';
import {
  ConversionFailed,
  ConversionTimedOut,
  createLibreOfficeDocumentPdf,
  findSoffice,
} from '../src/import/libreoffice';
import { openPdfDeck } from '../src/import/pdf-deck';
import { silentLogger } from '../src/logger';
import { makePdf } from './pdf';
import { storedZip } from './zip';

const png = (width: number, height: number) => {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#e53';
  context.fillRect(0, 0, width, height);
  return new Uint8Array(canvas.toBuffer('image/png'));
};

/** An uncompressed 24-bit BMP (`BITMAPINFOHEADER`), every pixel orange. */
const bmp = (width: number, height: number) => {
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const bytes = new Uint8Array(54 + rowBytes * height);
  const view = new DataView(bytes.buffer);
  bytes.set([0x42, 0x4d]);
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) bytes.set([0x33, 0x55, 0xee], 54 + y * rowBytes + x * 3);
  }
  return bytes;
};

/** A Word document with one paragraph. */
const DOCX = storedZip({
  '[Content_Types].xml':
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  '_rels/.rels':
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml':
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body><w:p><w:r><w:t>Hallo</w:t></w:r></w:p></w:body></w:document>',
});

describe('toDeckBytes', () => {
  it('keeps PowerPoints and PDFs as they are', async () => {
    const pdf = makePdf(1);
    expect(await toDeckBytes('Q4.pdf', pdf, null)).toBe(pdf);
    const pptx = storedZip({ 'ppt/presentation.xml': '<p:presentation/>' });
    expect(await toDeckBytes('Q4.pptx', pptx, null)).toBe(pptx);
  });

  it('turns a picture into a one-page PDF of its shape', async () => {
    const deck = await toDeckBytes('Entwurf.png', png(400, 300), null);
    const { presentation } = await openPdfDeck(deck);
    expect(presentation.slides).toHaveLength(1);
    expect(presentation.size.cx / presentation.size.cy).toBeCloseTo(4 / 3, 2);
  });

  it('reads the size of every kind of picture from its header, and refuses giant ones', async () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp'] as const) {
      const canvas = createCanvas(123, 45);
      canvas.getContext('2d').fillRect(0, 0, 123, 45);
      const bytes = new Uint8Array(await canvas.encode(mime.slice(6) as 'png'));
      expect(imageSize(bytes), mime).toEqual({ width: 123, height: 45 });
    }
    // A PNG header claiming 30000 × 30000 pixels: refused before anything is decoded.
    const giant = png(10, 10);
    new DataView(giant.buffer).setUint32(16, 30_000);
    new DataView(giant.buffer).setUint32(20, 30_000);
    await expect(toDeckBytes('Riesig.png', giant, null)).rejects.toMatchObject({
      code: 'not_a_powerpoint',
    });
  });

  it('takes a real BMP, but not a text that just starts with "BM"', async () => {
    const picture = bmp(40, 30);
    expect(imageSize(picture)).toEqual({ width: 40, height: 30 });
    const { presentation } = await openPdfDeck(await toDeckBytes('Skizze.bmp', picture, null));
    expect(presentation.slides).toHaveLength(1);

    // A CSV of car makers is no picture – it goes to LibreOffice by its name, not "zu groß".
    const csv = new TextEncoder().encode('BMW,Audi,VW,Mercedes\n1,2,3,4\n');
    expect(imageSize(csv)).toBeNull();
    const documentPdf = vi.fn(async () => makePdf(1));
    expect(await toDeckBytes('Autos.csv', csv, documentPdf)).toEqual(makePdf(1));
    expect(documentPdf).toHaveBeenCalledWith(csv, 'csv');
    // Without a document name it is just not a file Slider opens.
    await expect(toDeckBytes('Autos', csv, documentPdf)).rejects.toMatchObject({
      code: 'not_a_powerpoint',
      message: expect.stringMatching(/kann Slider nicht öffnen/),
    });

    // A BMP header that claims far more pixels than the file holds is no picture either.
    const lying = bmp(4, 4);
    new DataView(lying.buffer).setInt32(18, 30_000, true);
    new DataView(lying.buffer).setInt32(22, 30_000, true);
    await expect(toDeckBytes('Kaputt.bmp', lying, null)).rejects.toMatchObject({
      message: expect.stringMatching(/kann Slider nicht öffnen/),
    });
  });

  it('tells a broken document from a conversion that could not run', async () => {
    const failing = (error: Error) => vi.fn(async () => Promise.reject(error));
    await expect(
      toDeckBytes('Bericht.docx', DOCX, failing(new ConversionFailed('LibreOffice exited with 1'))),
    ).rejects.toMatchObject({
      status: 400,
      code: 'not_a_powerpoint',
      message: expect.stringMatching(/beschädigt oder passwortgeschützt/),
    });
    await expect(
      toDeckBytes('Bericht.docx', DOCX, failing(new ConversionTimedOut(120_000))),
    ).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/zu lange/) });
    const missing = Object.assign(new Error('spawn soffice ENOENT'), { code: 'ENOENT' });
    await expect(toDeckBytes('Bericht.docx', DOCX, failing(missing))).rejects.toMatchObject({
      status: 503,
      message: expect.stringMatching(/gerade nicht umwandeln/),
    });
  });

  it('hands Word, Excel and text to LibreOffice, and turns down the rest', async () => {
    const documentPdf = vi.fn(async () => makePdf(1));
    expect(await toDeckBytes('Bericht.docx', DOCX, documentPdf)).toEqual(makePdf(1));
    expect(documentPdf).toHaveBeenCalledWith(DOCX, 'docx');
    expect(pdfMakerOf(await toDeckBytes('Bericht.docx', DOCX, documentPdf))).toBe('libreoffice');
    // A PDF as it came was made by nobody Slider knows.
    expect(pdfMakerOf(await toDeckBytes('Q4.pdf', makePdf(1), documentPdf))).toBeNull();

    await expect(toDeckBytes('Bericht.docx', DOCX, null)).rejects.toMatchObject({
      code: 'not_a_powerpoint',
      message: expect.stringMatching(/kann dieser Server nicht/),
    });
    await expect(
      toDeckBytes('Film.mov', new Uint8Array([0, 0, 0, 20]), documentPdf),
    ).rejects.toMatchObject({ code: 'not_a_powerpoint' });
  });

  it('converts a real Word document with LibreOffice, when installed', async () => {
    const soffice = await findSoffice();
    if (!soffice) return;
    const documentPdf = createLibreOfficeDocumentPdf({ binary: soffice, log: silentLogger });
    const { presentation } = await openPdfDeck(
      await toDeckBytes('Bericht.docx', DOCX, documentPdf),
    );
    expect(presentation.slides).toHaveLength(1);
  }, 60_000);
});
