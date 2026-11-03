import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { OdpDocument, blankOdp, type OdpDesign } from '../src';

const DEMO = new Uint8Array(readFileSync(new URL('./fixtures/demo.odp', import.meta.url)));

/** The demo deck with its styles.xml changed by `edit`. */
async function demoWithStyles(edit: (xml: string) => string): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(DEMO);
  const xml = await zip.file('styles.xml')!.async('string');
  const changed = edit(xml);
  expect(changed).not.toBe(xml);
  zip.file('styles.xml', changed);
  return zip.generateAsync({ type: 'uint8array' });
}

const designOf = async (bytes: Uint8Array): Promise<Map<string, OdpDesign>> =>
  new Map([['haus', await (await OdpDocument.open(bytes)).design()]]);

const masterOf = (document: OdpDocument, index: number) =>
  /draw:master-page-name="([^"]*)"/.exec(document.slideXml(index))?.[1];

describe('a template’s layout taken into a deck', () => {
  it('brings a layout’s master page, styles and pictures along once, a differing master of the same name under its own', async () => {
    const deck = await OdpDocument.open(await blankOdp(new Date('2026-01-01')));
    deck.ensureIds();
    const [first] = deck.pageIds();
    const designs = await designOf(DEMO);
    deck.apply(
      [
        {
          type: 'addSlide',
          like: first!,
          newPageId: 'sl-titel',
          after: first!,
          design: { id: 'haus', layout: 0 },
        },
      ],
      new Map(),
      designs,
    );

    const reopened = await OdpDocument.open(await deck.toBytes());
    expect(reopened.masterPages().map((page) => page.name)).toEqual(['Default', 'Title_20_Slide']);
    expect(masterOf(reopened, 1)).toBe('Title_20_Slide');
    // Its placeholders, in the template's look.
    expect(reopened.slideXml(1)).toContain('presentation:style-name="Title_20_Slide-title"');
    expect(reopened.styleCatalog().join('\n')).toContain('Title_20_Slide-title');
    // Every picture its styles show is in the package.
    const template = await OdpDocument.open(DEMO);
    const shown = (await template.pictures())
      .filter((picture) => picture.usedBy.some((user) => !user.startsWith('slide ')))
      .map((picture) => picture.path);
    const have = new Set((await reopened.pictures()).map((picture) => picture.path));
    for (const path of shown) expect(have.has(path)).toBe(true);
    // The blank deck declared fewer prefixes: the template's come along, or the pictures' links
    // would mean nothing.
    const styles = await (
      await JSZip.loadAsync(await deck.toBytes())
    )
      .file('styles.xml')!
      .async('string');
    expect(/<office:document-styles[^>]*xmlns:xlink=/.test(styles)).toBe(true);

    // Again: the same master page, not a second one.
    reopened.apply(
      [
        {
          type: 'addSlide',
          like: first!,
          newPageId: 'sl-noch-einmal',
          after: 'sl-titel',
          design: { id: 'haus', layout: 0 },
        },
      ],
      new Map(),
      designs,
    );
    expect(reopened.masterPages()).toHaveLength(2);
    expect(masterOf(reopened, 2)).toBe('Title_20_Slide');
    // Keeps a master page of the same name that differs, the new one under its own.
    {
      const deck = await OdpDocument.open(DEMO);
      deck.ensureIds();
      const [first] = deck.pageIds();
      const other = await demoWithStyles((xml) =>
        xml.replace(
          '<style:master-page style:name="Title_20_Slide"',
          '<style:master-page style:name="Title_20_Slide" draw:style-name-other="x"',
        ),
      );
      deck.apply(
        [
          {
            type: 'addSlide',
            like: first!,
            newPageId: 'sl-neu',
            after: first!,
            design: { id: 'haus', layout: 0 },
          },
        ],
        new Map(),
        await designOf(other),
      );
      const reopened = await OdpDocument.open(await deck.toBytes());
      const pages = reopened.masterPages();
      expect(pages).toHaveLength(3);
      const taken = pages[2]!.name;
      expect(taken).toMatch(/^Title_20_Slide_[0-9a-f]{8}$/);
      expect(pages[2]!.displayName).toBe('Title Slide (2)');
      expect(masterOf(reopened, 1)).toBe(taken);
      // Its presentation styles go with its name.
      expect(reopened.slideXml(1)).toContain(`presentation:style-name="${taken}-title"`);
      expect(reopened.styleCatalog().join('\n')).toContain(`${taken}-outline1`);

      // Taken again: found by its name, nothing more comes in.
      reopened.apply(
        [
          {
            type: 'addSlide',
            like: first!,
            newPageId: 'sl-noch-einmal',
            after: 'sl-neu',
            design: { id: 'haus', layout: 0 },
          },
        ],
        new Map(),
        await designOf(other),
      );
      expect(reopened.masterPages()).toHaveLength(3);
      expect(masterOf(reopened, 2)).toBe(taken);
    }
  });

  it('refuses a template of another page shape or without the layout', async () => {
    const deck = await OdpDocument.open(await blankOdp(new Date('2026-01-01')));
    deck.ensureIds();
    const [first] = deck.pageIds();
    const square = await demoWithStyles((xml) =>
      xml.replaceAll('fo:page-width="33.867cm"', 'fo:page-width="19.05cm"'),
    );
    const outcome = deck.applyWhatFits(
      [
        {
          type: 'addSlide',
          like: first!,
          newPageId: 'sl-neu',
          after: first!,
          design: { id: 'haus', layout: 0 },
        },
      ],
      new Map(),
      await designOf(square),
    );
    expect(outcome.applied).toEqual([]);
    expect(outcome.reason).toContain('anderes Seitenformat');
    expect(deck.masterPages()).toHaveLength(1);
    // Refuses a layout the template no longer has.
    {
      const deck = await OdpDocument.open(await blankOdp(new Date('2026-01-01')));
      deck.ensureIds();
      const [first] = deck.pageIds();
      const outcome = deck.applyWhatFits(
        [
          {
            type: 'addSlide',
            like: first!,
            newPageId: 'sl-neu',
            after: first!,
            design: { id: 'weg', layout: 0 },
          },
        ],
        new Map(),
        await designOf(DEMO),
      );
      expect(outcome.reason).toContain('gibt es in der Vorlage nicht mehr');
    }
  });
});
