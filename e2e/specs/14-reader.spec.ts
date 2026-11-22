import { expect, shot, test } from '../support';

/** A one-page PDF with one text field, „name“, built by hand: no PDF library in the suite. */
function formPdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] /DA (/Helv 0 Tf 0 g) /DR << /Font << /Helv 6 0 R >> >> >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 6 0 R >> >> /Annots [5 0 R] >>',
    null,
    '<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /Rect [60 600 300 624] /F 4 /P 3 0 R /DA (/Helv 12 Tf 0 g) >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const text = 'BT /F1 24 Tf 60 760 Td (Antrag auf Mitgliedschaft) Tj ET';
  objects[3] = `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
  let pdf = '%PDF-1.7\n';
  const offsets = objects.map((body, index) => {
    const at = pdf.length;
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

test('Reader keeps what is filled in, for everyone, and a comment on the page takes replies', async ({
  page,
}) => {
  const [workspace] = (await (await page.request.get('/api/workspaces')).json()) as {
    id: string;
  }[];
  const imported = await page.request.post(
    `/api/workspaces/${workspace!.id}/pdfs/import?name=Antrag.pdf`,
    { headers: { 'content-type': 'application/pdf' }, data: formPdf() },
  );
  expect(imported.status()).toBe(201);
  const pdf = (await imported.json()) as { id: string };

  await page.goto(`/w/${workspace!.id}/pdfs`);
  await expect(page.getByText('Antrag', { exact: true })).toBeVisible();

  await page.goto(`/r/${pdf.id}`);
  const field = page.getByRole('textbox', { name: 'name' });
  await field.fill('Anna Weber');
  await field.blur();
  await expect
    .poll(async () => {
      const opened = (await (await page.request.get(`/api/pdfs/${pdf.id}`)).json()) as {
        marks: { id: string; value?: unknown }[];
      };
      return opened.marks.find((mark) => mark.id === 'field:name')?.value;
    })
    .toBe('Anna Weber');

  const commented = await page.request.post(`/api/pdfs/${pdf.id}/comments`, {
    data: {
      id: crypto.randomUUID(),
      parentId: null,
      body: 'Bitte mit Datum',
      anchor: { page: 0, rect: { x: 0.1, y: 0.25, w: 0.4, h: 0.04 } },
    },
  });
  expect(commented.status()).toBe(201);

  // Another tab sees it as it stands: filled in, the comment at its place.
  const other = await page.context().newPage();
  await other.goto(`/r/${pdf.id}`);
  await expect(other.getByRole('textbox', { name: 'name' })).toHaveValue('Anna Weber');
  await other.locator('[data-thread]').first().click();
  const reply = other.getByRole('textbox', { name: 'Antwort senden' });
  await reply.fill('Mach ich');
  await reply.press('Enter');
  await expect(page.getByText('Mach ich')).toBeVisible();
  await shot(page, 'reader-comment');
});
