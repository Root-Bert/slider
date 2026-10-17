import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { openPptx, PptxError, withoutExternalLinks } from '../src';
import { buildPptx } from './fixtures/build-pptx';

const SLIDE_RELS = 'ppt/slides/_rels/slide1.xml.rels';
const IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

/** A built deck whose first slide's relationships get `extra` appended. */
async function deckWith(extra: string): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(
    await buildPptx({ slides: [{ title: 'Eins' }, { title: 'Zwei' }] }),
  );
  const rels = (await zip.file(SLIDE_RELS)?.async('string')) ?? '';
  zip.file(SLIDE_RELS, rels.replace('</Relationships>', `${extra}</Relationships>`));
  return zip.generateAsync({ type: 'uint8array' });
}

const relsOf = async (bytes: Uint8Array, path = SLIDE_RELS) =>
  (await (await JSZip.loadAsync(bytes)).file(path)?.async('string')) ?? '';

describe('withoutExternalLinks', () => {
  it('drops linked pictures, media and hyperlinks, keeps the package readable', async () => {
    const input = await deckWith(
      `<Relationship Id="rId90" Type="${IMAGE}" Target="http://169.254.169.254/latest/meta-data" TargetMode="External"/>` +
        `<Relationship Id="rId91" Type="${IMAGE}" Target="file:///etc/passwd" TargetMode="External"/>`,
    );
    const output = await withoutExternalLinks(input);
    const rels = await relsOf(output);
    expect(rels).not.toMatch(/169\.254|file:|External/);
    expect(rels).toMatch(/slideLayout/);

    const before = await openPptx(input);
    const after = await openPptx(output);
    expect(after.presentation.slides.map((slide) => slide.title)).toEqual(
      before.presentation.slides.map((slide) => slide.title),
    );
  });

  it('sees through XML and zip tricks', async () => {
    const input = await deckWith(
      // Entity-encoded mode, a `>` inside the target, a lower-case mode with a URL target,
      // a scheme-less network path and a prefixed element.
      `<Relationship Id="rId92" Type="${IMAGE}" Target="http://10.0.0.5/a?x=>" TargetMode="&#69;xternal"/>` +
        `<Relationship Id="rId93" Type="${IMAGE}" Target="http://10.0.0.5/b" TargetMode="external"/>` +
        `<Relationship Id="rId94" Type="${IMAGE}" Target="//10.0.0.5/share/c.png"/>` +
        `<x:Relationship xmlns:x="http://schemas.openxmlformats.org/package/2006/relationships" Id="rId95" Type="${IMAGE}" Target="https://10.0.0.5/d" TargetMode="External"/>`,
    );
    // A second rels part with an upper-case name.
    const zip = await JSZip.loadAsync(input);
    zip.file(
      'ppt/slides/_RELS/slide2.xml.RELS',
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${IMAGE}" Target="http://10.0.0.5/e" TargetMode="External"/></Relationships>`,
    );
    const output = await withoutExternalLinks(await zip.generateAsync({ type: 'uint8array' }));
    expect(await relsOf(output)).not.toMatch(/10\.0\.0\.5|rId9[2-5]/);
    expect(await relsOf(output, 'ppt/slides/_RELS/slide2.xml.RELS')).not.toMatch(/10\.0\.0\.5/);
  });

  it('refuses what is not a readable package', async () => {
    await expect(withoutExternalLinks(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(PptxError);
    const broken = await deckWith('<Relationship');
    await expect(withoutExternalLinks(broken)).rejects.toBeInstanceOf(PptxError);
  });
});
