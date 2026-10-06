import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { openPptx, PptxError } from '../src';
import { buildPptx } from './fixtures/build-pptx';

async function expectPptxError(input: Uint8Array, code: PptxError['code']): Promise<void> {
  const error: unknown = await openPptx(input).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(PptxError);
  expect((error as PptxError).code).toBe(code);
}

async function rezip(files: Record<string, string>, base?: Uint8Array): Promise<Uint8Array> {
  const zip = base ? await JSZip.loadAsync(base) : new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('invalid input', () => {
  it('rejects random bytes as not_pptx', async () => {
    const random = Uint8Array.from({ length: 2048 }, (_, index) => (index * 7919 + 13) % 256);
    await expectPptxError(random, 'not_pptx');
  });

  it('rejects a zip without ppt/presentation.xml as not_pptx', async () => {
    await expectPptxError(await rezip({ 'word/document.xml': '<w:document/>' }), 'not_pptx');
  });

  it('detects password-protected files by their OLE compound file header', async () => {
    const ole = new Uint8Array(1024);
    ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    await expectPptxError(ole, 'encrypted');
  });

  it('reports malformed XML as corrupt', async () => {
    const valid = await buildPptx({ slides: [{ title: 'A' }] });
    await expectPptxError(
      await rezip({ 'ppt/slides/slide1.xml': '<p:sld><p:cSld></p:sld>' }, valid),
      'corrupt',
    );
  });

  it('reports a slide list pointing at a missing part as corrupt', async () => {
    const valid = await buildPptx({ slides: [{ title: 'A' }] });
    const zip = await JSZip.loadAsync(valid);
    zip.remove('ppt/slides/slide1.xml');
    await expectPptxError(await zip.generateAsync({ type: 'uint8array' }), 'corrupt');
  });

  it('accepts ArrayBuffer input', async () => {
    const bytes = await buildPptx({ slides: [{ title: 'A' }] });
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    await expect(openPptx(buffer)).resolves.toBeDefined();
  });
});
