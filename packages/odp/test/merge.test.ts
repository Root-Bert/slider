import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OdpDocument, mergeSlide, renameStyles, sameSlide } from '../src';

const DEMO = new Uint8Array(readFileSync(new URL('./fixtures/demo.odp', import.meta.url)));

const open = async () => {
  const document = await OdpDocument.open(DEMO);
  document.ensureIds();
  return document;
};

/** Slide 2 (Agenda): title sl3, a list of four points sl4. */
const agenda = async () => (await open()).slideXml(1);

const replace = (xml: string, from: string, to: string) => {
  expect(xml).toContain(from);
  return xml.replace(from, to);
};

describe('merging two changes of a slide', () => {
  it('takes changes of different elements from both', async () => {
    const base = await agenda();
    const ours = replace(base, '>Agenda<', '>Heute<');
    const theirs = replace(base, 'svg:y="5.071cm"', 'svg:y="6cm"');
    const merged = mergeSlide(base, ours, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.xml).toContain('>Heute<');
    expect(merged.xml).toContain('svg:y="6cm"');
  });

  it('takes different attributes of one element from both', async () => {
    const base = await agenda();
    const ours = replace(base, 'presentation:style-name="pr4"', 'presentation:style-name="aiBig"');
    const theirs = replace(base, '>Agenda<', '>Heute<');
    const merged = mergeSlide(base, ours, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.xml).toContain('presentation:style-name="aiBig"');
    expect(merged.xml).toContain('>Heute<');
  });

  it('takes different points of one list from both', async () => {
    const base = await agenda();
    const ours = replace(base, '>Umsatz nach Region<', '>Umsatz je Region<');
    const theirs = replace(
      base,
      '>Nächste Schritte und Verantwortlichkeiten<',
      '>Nächste Schritte<',
    );
    const merged = mergeSlide(base, ours, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.xml).toContain('>Umsatz je Region<');
    expect(merged.xml).toContain('>Nächste Schritte<');
  });

  it('is a conflict when both change the same thing differently – and fine when alike', async () => {
    const base = await agenda();
    const ours = replace(base, '>Agenda<', '>Heute<');
    expect(mergeSlide(base, ours, replace(base, '>Agenda<', '>Plan<'))).toEqual({
      xml: null,
      conflicts: [{ elementId: 'sl3', name: 'Title 1', what: 'text' }],
    });
    expect(mergeSlide(base, ours, ours).xml).toContain('>Heute<');

    const wider = replace(base, 'svg:width="29.209cm"', 'svg:width="20cm"');
    const narrower = replace(base, 'svg:width="29.209cm"', 'svg:width="10cm"');
    expect(mergeSlide(base, wider, narrower).conflicts).toEqual([
      { elementId: 'sl3', name: 'Title 1', what: 'svg:width' },
    ]);
  });

  it('keeps elements both added, and removes what one removed and the other left', async () => {
    const base = await agenda();
    const box = (id: string, text: string) =>
      `<draw:frame draw:name="${id}" svg:width="5cm" svg:height="2cm" svg:x="1cm" svg:y="1cm" xml:id="${id}"><draw:text-box><text:p>${text}</text:p></draw:text-box></draw:frame>`;
    const notes = '<presentation:notes';
    const ours = replace(base, notes, `${box('aiA1', 'Von A')}${notes}`);
    const theirs = replace(base, notes, `${box('aiB1', 'Von B')}${notes}`);
    const both = mergeSlide(base, ours, theirs);
    expect(both.conflicts).toEqual([]);
    expect(both.xml).toContain('>Von A<');
    expect(both.xml).toContain('>Von B<');
    // Each keeps its place before the notes.
    expect(both.xml!.indexOf('Von B')).toBeLessThan(both.xml!.indexOf(notes));
    expect(both.xml!.indexOf('Von A')).toBeLessThan(both.xml!.indexOf(notes));

    const title = /<draw:frame draw:name="Title 1".*?<\/draw:frame>/.exec(base)![0];
    const removed = mergeSlide(base, base.replace(title, ''), theirs);
    expect(removed.xml).not.toContain('Title 1');
    expect(removed.xml).toContain('>Von B<');

    // Removed by one, changed by the other: a conflict.
    expect(
      mergeSlide(base, base.replace(title, ''), replace(base, '>Agenda<', '>Plan<')).conflicts,
    ).toEqual([{ elementId: 'sl3', name: 'Title 1', what: '<draw:frame>' }]);
  });

  it('does not mind how the XML is written: attribute order, entities, whitespace between elements', async () => {
    const base = await agenda();
    const ours = replace(
      replace(base, '><draw:frame draw:name="Content 2"', '>\n  <draw:frame draw:name="Content 2"'),
      'svg:width="29.209cm" svg:height="3.681cm"',
      'svg:height="3.681cm" svg:width="29.209cm"',
    ).replace('>Agenda<', '>Agenda &amp; Ziele<');
    expect(
      sameSlide(
        base,
        base.replace(
          'svg:width="29.209cm" svg:height="3.681cm"',
          'svg:height="3.681cm" svg:width="29.209cm"',
        ),
      ),
    ).toBe(true);
    const theirs = replace(base, '>Umsatz nach Region<', '>Umsatz je Region<');
    const merged = mergeSlide(base, ours, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.xml).toContain('>Agenda &amp; Ziele<');
    expect(merged.xml).toContain('>Umsatz je Region<');
  });

  it('follows elements one side moved, and calls moves both ways a conflict', async () => {
    const base = await agenda();
    const title = /<draw:frame draw:name="Title 1".*?<\/draw:frame>/.exec(base)![0];
    const content = /<draw:frame draw:name="Content 2".*?<\/draw:frame>/.exec(base)![0];
    const swapped = base.replace(title, '§').replace(content, title).replace('§', content);
    const merged = mergeSlide(base, swapped, replace(base, '>Agenda<', '>Plan<'));
    expect(merged.conflicts).toEqual([]);
    expect(merged.xml!.indexOf('Content 2')).toBeLessThan(merged.xml!.indexOf('Title 1'));
    expect(merged.xml).toContain('>Plan<');
  });
});

describe('styles of a change going in again', () => {
  it('keeps a style that is there as it is, renames one whose name is taken by another', async () => {
    const document = await open();
    const mine =
      '<style:style style:name="aiBig" style:family="presentation" style:parent-style-name="pr4"><style:graphic-properties draw:fill="none"/></style:style>';
    const theirs = mine.replace('draw:fill="none"', 'draw:fill="solid"');
    expect(document.addOwnStyles(theirs)).toEqual(new Map());
    // The same again: nothing to rename.
    expect(document.addOwnStyles(theirs)).toEqual(new Map());
    const renames = document.addOwnStyles(mine);
    expect(renames).toEqual(new Map([['aiBig', 'aiBig-2']]));
    expect(document.stylesXml(['aiBig', 'aiBig-2']).xml).toEqual([
      theirs,
      mine.replace('"aiBig"', '"aiBig-2"'),
    ]);

    const slide = renameStyles(
      '<draw:page><draw:frame presentation:style-name="aiBig" draw:name="aiBig"/></draw:page>',
      renames,
    );
    expect(slide).toBe(
      '<draw:page><draw:frame presentation:style-name="aiBig-2" draw:name="aiBig"/></draw:page>',
    );
    expect(renameStyles(mine, renames, { own: true })).toBe(mine.replace('"aiBig"', '"aiBig-2"'));
  });

  it('gives the ids an AI request adds a prefix of its own', async () => {
    const document = await open();
    document.idPrefix = 'aiX';
    const id = document.duplicateSlide(0);
    expect(id).toMatch(/^aiX\d+$/);
    expect(document.slides()[1]!.elements.every((element) => element.id.startsWith('aiX'))).toBe(
      true,
    );
  });
});
