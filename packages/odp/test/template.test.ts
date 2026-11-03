import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { OdpDocument, blankOdp } from '../src';

/** A 1×1 PNG. */
const PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

const frame = (id: string, x: string, inner: string, style = '') =>
  `<draw:frame xml:id="${id}"${style} draw:layer="layout" svg:x="${x}" svg:y="1cm" svg:width="10cm" svg:height="3cm">${inner}</draw:frame>`;

/** A presentation with two slides: one with a title, text and a picture, one plain. */
async function designed() {
  const document = await OdpDocument.open(await blankOdp(new Date('2026-01-01')));
  document.addOwnStyles(
    '<style:style style:name="gr9" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#ff0000"/></style:style>' +
      '<style:style style:name="T9" style:family="text"><style:text-properties fo:font-size="40pt"/></style:style>' +
      '<style:style style:name="T8" style:family="text"><style:text-properties fo:font-size="24pt"/></style:style>' +
      '<style:style style:name="T7" style:family="text"><style:text-properties fo:font-size="14pt"/></style:style>',
  );
  // Text boxes beside: a subtitle and two of text, in letters of their own.
  const texts = ['Unter', 'Erster Text', 'Zweiter Text']
    .map((text, at) =>
      frame(
        `body${at + 1}`,
        `${at + 2}cm`,
        `<draw:text-box><text:p><text:span text:style-name="${['T8', 'T6', 'T7'][at]}">${text}</text:span></text:p></draw:text-box>`,
      ),
    )
    .join('');
  document.insertSlide(
    1,
    `<draw:page xml:id="page2" draw:name="b" draw:master-page-name="Default">${frame('title1', '1cm', '<draw:text-box><text:p><text:span text:style-name="T9">Titel</text:span></text:p></draw:text-box>', ' draw:style-name="gr9"')}${frame('deco1', '12cm', '<draw:text-box><text:p>Fest</text:p></draw:text-box>')}${frame('pic1', '1cm', '<draw:image xlink:href="Pictures/x.png"/>')}${texts}</draw:page>`,
    { trusted: true },
  );
  document.ensureIds();
  const [first, second] = document.pageIds();
  return { document, first: first!, second: second! };
}

describe('toTemplate', () => {
  it('turns slides into layouts with placeholders and guides', async () => {
    const { document, first, second } = await designed();
    const middle = { orientation: 'vertical', position: 0.5 } as const;
    document.toTemplate([
      { pageId: first, name: 'Leer', placeholders: {}, guides: [middle] },
      {
        pageId: second,
        name: 'Titel und Bild',
        placeholders: {
          title1: 'title',
          pic1: 'picture',
          body1: 'subtitle',
          body2: 'outline',
          body3: 'outline',
        },
        guides: [middle, { orientation: 'horizontal', position: 0.25 }],
      },
    ]);
    const bytes = await document.toBytes();
    const reopened = await OdpDocument.open(bytes);
    expect(reopened.isTemplate()).toBe(true);
    const masters = reopened.masterPages();
    expect(masters.map((master) => master.displayName)).toEqual(['Leer', 'Titel und Bild']);
    expect(masters[1]!.placeholders.map((p) => p.kind)).toEqual([
      'title',
      'picture',
      'subtitle',
      'outline',
      'outline',
    ]);
    expect(masters[1]!.placeholders[0]!.style).toBe(`${masters[1]!.name}-title`);
    // A second one of a kind keeps its own look over the first's.
    expect(masters[1]!.placeholders.map((p) => p.look !== null)).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(reopened.slides()).toHaveLength(1);
    // Each layout keeps its own guides; LibreOffice's snap lines (the whole file's) those all share.
    const guides = await reopened.guides();
    expect(guides).toHaveLength(1);
    expect(guides[0]).toMatchObject({ orientation: 'vertical' });
    expect(guides[0]!.position).toBeCloseTo(0.5, 3);

    // A deck made from it gets the placeholders to fill – and each slide its layout's guides.
    reopened.markAsPresentation();
    reopened.addSlide(1, { master: masters[1]!.name });
    const [onFirst, onSecond] = await reopened.slideGuides();
    expect(onFirst).toHaveLength(1);
    expect(onSecond!.map((guide) => guide.orientation)).toEqual(['vertical', 'horizontal']);
    expect(onSecond![1]!.position).toBeCloseTo(0.25, 3);
    // A template from before (its master pages carry no guides): every slide the snap lines.
    const zip = await JSZip.loadAsync(bytes);
    const styles = await zip.file('styles.xml')!.async('string');
    // LibreOffice finds a master page's presentation styles by its display name: they carry it,
    // with the frame's whole graphic look (its padding from „standard“ too).
    expect(styles).toMatch(
      /style:name="Slider_2-title" style:display-name="Titel und Bild-title" style:family="presentation"><style:graphic-properties [^>]*fo:padding-left="0.25cm"/,
    );
    zip.file('styles.xml', styles.replace(/ slider:guides="[^"]*"/g, ''));
    const old = await OdpDocument.open(await zip.generateAsync({ type: 'uint8array' }));
    old.addSlide(1, { master: masters[1]!.name });
    expect(old.layoutGuides()).toEqual([null, null]);
    expect(await old.slideGuides()).toEqual([guides, guides]);
    // Designed again: a layout added with the template editor's „Neue Folie“ shows none of its
    // master's decoration there – nor does it get any as a layout; one on that master keeps it.
    const redesigned = await OdpDocument.open(bytes);
    redesigned.markAsPresentation();
    redesigned.addSlide(1, { master: masters[1]!.name });
    redesigned.addSlide(2, { like: 1, empty: true });
    redesigned.ensureIds();
    const [, decorated, bare] = redesigned.pageIds();
    redesigned.toTemplate([
      { pageId: decorated!, name: 'Mit', placeholders: {}, guides: [] },
      { pageId: bare!, name: 'Leer', placeholders: {}, guides: [] },
    ]);
    const layoutStyles = await (
      await JSZip.loadAsync(await redesigned.toBytes())
    )
      .file('styles.xml')!
      .async('string');
    const layoutXml = (name: string) =>
      layoutStyles.match(
        new RegExp(
          `<style:master-page[^>]*style:display-name="${name}"[^>]*>.*?</style:master-page>`,
        ),
      )?.[0] ?? '';
    expect(layoutXml('Mit')).toContain('Fest');
    expect(layoutXml('Leer')).not.toContain('Fest');
    const slide = reopened.slideXml(1);
    expect(slide).toContain('presentation:class="title"');
    expect(slide).toContain('presentation:class="graphic"');
    expect(slide).not.toContain('Fest');
    // Its picture placeholder is a picture frame holding the grey placeholder, not an empty
    // placeholder: LibreOffice draws no picture of one – neither that nor the one swapped in.
    const picture = reopened.slides()[1]!.elements.find((element) => element.role === 'graphic');
    expect(picture).toMatchObject({ kind: 'image', movable: true, resizable: true });
    expect(slide).toMatch(/presentation:class="graphic"(?![^>]*presentation:placeholder)/);
    const swapped = { bytes: PNG, mediaType: 'image/png', width: 1, height: 1 };
    reopened.apply(
      [{ type: 'replaceImage', elementId: picture!.id, imageId: 'photo' }],
      new Map([['photo', swapped]]),
    );
    expect(reopened.slideXml(1)).toMatch(/<draw:image xlink:href="Pictures\/[0-9a-f]+\.png"/);
    // One made before (marked empty) is no longer once its picture is swapped.
    const legacy = await designed();
    legacy.document.insertSlide(
      2,
      `<draw:page xml:id="page3" draw:name="c" draw:master-page-name="Default">${frame('old1', '1cm', '<draw:image xlink:href="Pictures/x.png"/>', ' presentation:class="graphic" presentation:placeholder="true"')}</draw:page>`,
      { trusted: true },
    );
    legacy.document.apply(
      [{ type: 'replaceImage', elementId: 'old1', imageId: 'photo' }],
      new Map([['photo', swapped]]),
    );
    expect(legacy.document.slideXml(2)).not.toContain('presentation:placeholder');
    // Empty, it asks for what was typed in the layout, in the layout's look – typing starts there.
    const title = reopened.slides()[1]!.elements.find((element) => element.role === 'title');
    expect(title?.live).toMatchObject({ placeholder: true, prompt: 'Titel', fill: '#ff0000' });
    expect(title?.live?.paragraphs[0]).toMatchObject({ runs: [], mark: { size: 40 } });
    // Each text placeholder of a layout designed in Slider comes, each asking for its own text in
    // its own look – a subtitle does not stand for the text frames there.
    const asks = reopened
      .slides()[1]!
      .elements.filter((element) => element.live?.placeholder && element.role !== 'title')
      .map((element) => [
        element.role,
        element.live?.prompt,
        element.live?.paragraphs[0]?.mark.size,
      ]);
    expect(asks).toEqual([
      ['subtitle', 'Unter', 24],
      ['outline', 'Erster Text', expect.any(Number)],
      ['outline', 'Zweiter Text', 14],
    ]);
    // A master's own text from elsewhere („Click to edit Master title style“) asks for nothing.
    const demo = await OdpDocument.open(
      new Uint8Array(readFileSync(new URL('./fixtures/demo.odp', import.meta.url))),
    );
    const titled = demo
      .masterPages()
      .find((master) => master.placeholders.some((p) => p.kind === 'title'));
    demo.addSlide(0, { master: titled!.name });
    const empty = demo.slides()[0]!.elements.find((element) => element.role === 'title');
    expect(empty?.live?.placeholder).toBe(true);
    expect(empty?.live?.prompt).toBeUndefined();
  });
});
