import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { masterDeck, openPptx } from '../src';
import { buildPptx, LAYOUT_NAMES } from './fixtures/build-pptx';

const TEMPLATE_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.template.main+xml';

/** The fixture deck with its content type and layout changed by `edit`. */
async function edited(edit: (zip: JSZip) => Promise<void>): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(
    await buildPptx({
      slides: [{ title: 'Erste' }, { title: 'Zweite' }],
      sections: [{ name: 'Alles', slides: [0, 1] }],
    }),
  );
  await edit(zip);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('masterDeck', () => {
  it('lists the layouts and draws one slide per layout instead of the deck’s own, refusing a package without', async () => {
    const read = await masterDeck(await edited(async () => {}));
    expect(read.template).toBe(false);
    expect(read.layouts.map((layout) => layout.name)).toEqual([
      LAYOUT_NAMES.title,
      LAYOUT_NAMES.content,
    ]);

    const deck = await openPptx(read.deck);
    expect(deck.presentation.slides.map((slide) => slide.layoutName)).toEqual([
      LAYOUT_NAMES.title,
      LAYOUT_NAMES.content,
    ]);
    expect(
      deck.presentation.slides.map((slide) => slide.shapes.map((shape) => shape.text)),
    ).toEqual([
      ['Titel', 'Untertitel'],
      ['Titel', 'Text'],
    ]);
    // Sections named the deck's own slides: gone with them.
    expect(deck.presentation.sections).toEqual([]);
    // The kept file still has its own slides.
    expect((await openPptx(read.file)).presentation.slides).toHaveLength(2);

    const bytes = await edited(async (zip) => {
      const presentation = await zip.file('ppt/presentation.xml')!.async('string');
      zip.file(
        'ppt/presentation.xml',
        presentation.replace(
          /<p:sldMasterIdLst>[\s\S]*?<\/p:sldMasterIdLst>/,
          '<p:sldMasterIdLst/>',
        ),
      );
    });
    await expect(masterDeck(bytes)).rejects.toThrow('no slide layouts');

    // The theme's colours – from a later master's theme when the first has none.
    expect(read.colors.get('accent1')).toMatch(/2563eb/i);
    const twoMasters = await JSZip.loadAsync(
      await buildPptx({
        slides: [{ title: 'Erste' }, { title: 'Zweite', foreignLayout: 'Fremd' }],
      }),
    );
    const masterRels = 'ppt/slideMasters/_rels/slideMaster1.xml.rels';
    const rels = await twoMasters.file(masterRels)!.async('string');
    twoMasters.file(masterRels, rels.replace(/<Relationship [^>]*theme1\.xml"\/>/, ''));
    const themeless = await masterDeck(await twoMasters.generateAsync({ type: 'uint8array' }));
    expect(themeless.colors.get('accent1')).toMatch(/2563eb/i);
  });

  it('keeps a template a template, draws it as a presentation, takes a layout’s own prompt', async () => {
    const read = await masterDeck(
      await edited(async (zip) => {
        const types = await zip.file('[Content_Types].xml')!.async('string');
        zip.file(
          '[Content_Types].xml',
          types.replace(
            /presentationml\.presentation\.main\+xml/,
            'presentationml.template.main+xml',
          ),
        );
        const path = Object.keys(zip.files).find((name) => /slideLayouts\/[^/]+\.xml$/.test(name))!;
        const layout = await zip.file(path)!.async('string');
        zip.file(
          path,
          layout
            .replace('<p:ph type="ctrTitle"/>', '<p:ph type="ctrTitle" hasCustomPrompt="1"/>')
            .replace('Click to edit Master title style', 'Name des Projekts'),
        );
      }),
    );
    const types = await (
      await JSZip.loadAsync(read.file)
    )
      .file('[Content_Types].xml')!
      .async('string');
    expect(types).toContain(TEMPLATE_TYPE);
    const deckTypes = await (
      await JSZip.loadAsync(read.deck)
    )
      .file('[Content_Types].xml')!
      .async('string');
    expect(deckTypes).not.toContain(TEMPLATE_TYPE);
    expect(read.template).toBe(true);
    const [title] = (await openPptx(read.deck)).presentation.slides;
    expect(title!.shapes.map((shape) => shape.text)).toEqual(['Name des Projekts', 'Untertitel']);
  });
});
