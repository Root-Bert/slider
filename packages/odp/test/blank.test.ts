import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { OdpDocument, blankOdp, isOdpBytes } from '../src';

describe('blankOdp', () => {
  it('is a different ODP each time with one empty 16:9 slide the editor can work on', async () => {
    const bytes = await blankOdp(new Date('2026-10-27T10:00:00Z'));
    expect(isOdpBytes(bytes)).toBe(true);
    const document = await OdpDocument.open(bytes);
    expect(document.pageSize()).toEqual({ width: 28, height: 15.75 });
    const slides = document.slides();
    expect(slides).toHaveLength(1);
    expect(slides[0]).toMatchObject({ hidden: false, elements: [] });
    document.ensureIds();
    expect(isOdpBytes(await document.toBytes())).toBe(true);

    // Picture links are declared – an undeclared `xlink:href` is no picture to LibreOffice – and
    // a deck written before without it gets it on its next edit.
    const contentOf = async (odp: Uint8Array) =>
      (await (await JSZip.loadAsync(odp)).file('content.xml')!.async('string')).slice(0, 2000);
    expect(await contentOf(bytes)).toContain('xmlns:xlink=');
    const old = await JSZip.loadAsync(bytes);
    const xml = await old.file('content.xml')!.async('string');
    old.file('content.xml', xml.replace(/ xmlns:xlink="[^"]*"/, ''));
    const healed = await OdpDocument.open(await old.generateAsync({ type: 'uint8array' }));
    expect(healed.ensureIds()).toBeGreaterThan(0);
    expect(await contentOf(await healed.toBytes())).toContain('xmlns:xlink=');

    // Its font reads as LibreOffice draws it: frames without a parent style take „standard“
    // (Inter here, LibreOffice's own Liberation Sans in decks written before it was there), and
    // a font name content.xml does not declare means nothing to LibreOffice. Its letters are
    // kerned; a deck that says nothing of kerning is not (LibreOffice's default, `kerning`).
    const fontsOf = async (odp: Uint8Array) => {
      const zip = await JSZip.loadAsync(odp);
      const xml = await zip.file('content.xml')!.async('string');
      zip.file(
        'content.xml',
        xml
          .replace(
            '</office:automatic-styles>',
            '<style:style style:name="T1" style:family="text"><style:text-properties style:font-name="Inter"/></style:style><style:style style:name="g" style:family="graphic"><style:graphic-properties draw:stroke="none" draw:fill="none"/></style:style></office:automatic-styles>',
          )
          .replace(
            /(<draw:page [^>]*?)\/>/,
            '$1><draw:frame draw:style-name="g" draw:name="A" svg:x="1cm" svg:y="1cm" svg:width="20cm" svg:height="3cm"><draw:text-box><text:p><text:span>plain</text:span><text:span text:style-name="T1"> named</text:span></text:p></draw:text-box></draw:frame></draw:page>',
          ),
      );
      const document = await OdpDocument.open(await zip.generateAsync({ type: 'uint8array' }));
      const runs = document.slides()[0]!.elements[0]!.live!.paragraphs[0]!.runs;
      return [...new Set(runs.map((run) => run.font + (run.kerning === false ? ' unkerned' : '')))];
    };
    expect(await fontsOf(bytes)).toEqual(['Inter']);
    const before = await JSZip.loadAsync(bytes);
    const styles = await before.file('styles.xml')!.async('string');
    before.file(
      'styles.xml',
      styles
        .replace(/<style:style style:name="standard"[\s\S]*?<\/style:style>/, '')
        .replaceAll(' style:letter-kerning="true"', ''),
    );
    expect(await fontsOf(await before.generateAsync({ type: 'uint8array' }))).toEqual([
      'Liberation Sans unkerned',
    ]);

    // Is a different file each time.
    const a = await blankOdp(new Date('2026-10-27T10:00:00Z'));
    const b = await blankOdp(new Date('2026-10-27T10:00:01Z'));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);

    // A text box put in declares the `loext:` its text styles use (`loext:opacity`) – else the
    // AI's next styles copied from them are refused („Unknown namespace in loext:opacity“).
    const added = await OdpDocument.open(a);
    added.ensureIds();
    added.apply([
      {
        type: 'addElement',
        pageId: added.slides()[0]!.pageId!,
        elementId: 'sl-text1',
        kind: 'text',
        box: { x: 0.1, y: 0.1, w: 0.5, h: 0.2 },
        fill: null,
        stroke: null,
        paragraphs: [
          {
            runs: [
              {
                text: 'Hallo',
                font: 'Inter',
                size: 20,
                color: '#112233',
                bold: false,
                italic: false,
                underline: false,
              },
            ],
            align: 'left',
          },
        ],
      },
    ]);
    const content = await (
      await JSZip.loadAsync(await added.toBytes())
    )
      .file('content.xml')!
      .async('string');
    expect(content).toContain('loext:opacity');
    expect(content).toContain('xmlns:loext=');
    // Such styles made on a copy and carried into the deck itself (the AI's change made with the
    // editor's operations): taken there too, the namespace declared.
    const deck = await OdpDocument.open(b);
    deck.addOwnStyles(
      '<style:style style:name="slT1" style:family="text"><style:text-properties fo:color="#112233" loext:opacity="100%"/></style:style>',
    );
    const own = await (
      await JSZip.loadAsync(await deck.toBytes())
    )
      .file('content.xml')!
      .async('string');
    expect(own).toContain('xmlns:loext=');
  });
});
