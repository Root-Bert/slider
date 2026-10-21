import { describe, expect, it } from 'vitest';
import { normaliseGuides, readExtGuides, readViewPropsGuides } from '../src/guides';
import { parseXml } from '../src/xml';

/** One master unit is 1/576 inch = 1587.5 EMU. */
const UNIT = 914400 / 576;

describe('readExtGuides', () => {
  it('reads the slide guide list from the extension list, defaulting to vertical', () => {
    const master = parseXml(
      '<p:sldMaster><p:cSld/><p:extLst><p:ext uri="{27BBF7A9-308A-43DC-89C8-2F10F3537804}">' +
        '<p15:sldGuideLst><p15:guide id="1" pos="576"/><p15:guide id="2" orient="horz" pos="288"/>' +
        '<p15:guide id="3"/></p15:sldGuideLst></p:ext></p:extLst></p:sldMaster>',
    );
    expect(readExtGuides(master)).toEqual([
      { orientation: 'vertical', emu: 576 * UNIT },
      { orientation: 'horizontal', emu: 288 * UNIT },
      { orientation: 'vertical', emu: 0 },
    ]);
  });

  it('skips the notes guide list of the presentation', () => {
    const presentation = parseXml(
      '<p:presentation><p:extLst>' +
        '<p:ext uri="a"><p15:notesGuideLst><p15:guide id="9" pos="10"/></p15:notesGuideLst></p:ext>' +
        '<p:ext uri="b"><p15:sldGuideLst><p15:guide id="1" orient="horz" pos="100"/></p15:sldGuideLst></p:ext>' +
        '</p:extLst></p:presentation>',
    );
    expect(readExtGuides(presentation)).toEqual([{ orientation: 'horizontal', emu: 100 * UNIT }]);
  });

  it('is empty without an extension list', () => {
    expect(readExtGuides(parseXml('<p:sldLayout/>'))).toEqual([]);
    expect(readExtGuides(null)).toEqual([]);
  });
});

describe('readViewPropsGuides', () => {
  it('reads the guides of older files from viewProps.xml', () => {
    const viewProps = parseXml(
      '<p:viewPr><p:slideViewPr><p:cSldViewPr><p:cViewPr/>' +
        '<p:guideLst><p:guide orient="horz" pos="2160"/><p:guide pos="2880"/></p:guideLst>' +
        '</p:cSldViewPr></p:slideViewPr></p:viewPr>',
    );
    expect(readViewPropsGuides(viewProps)).toEqual([
      { orientation: 'horizontal', emu: 2160 * UNIT },
      { orientation: 'vertical', emu: 2880 * UNIT },
    ]);
  });

  it('is empty without a guide list', () => {
    expect(readViewPropsGuides(parseXml('<p:viewPr><p:slideViewPr/></p:viewPr>'))).toEqual([]);
    expect(readViewPropsGuides(undefined)).toEqual([]);
  });
});

describe('normaliseGuides', () => {
  const size = { cx: 12192000, cy: 6858000 };

  it('normalises vertical guides to the width and horizontal ones to the height', () => {
    const [vertical, horizontal] = normaliseGuides(
      [
        { orientation: 'vertical', emu: 6096000 },
        { orientation: 'horizontal', emu: 1714500 },
      ],
      size,
    );
    expect(vertical?.orientation).toBe('vertical');
    expect(vertical?.position).toBeCloseTo(0.5);
    expect(horizontal?.orientation).toBe('horizontal');
    expect(horizontal?.position).toBeCloseTo(0.25);
  });

  it('keeps the slide edges and drops guides off the slide', () => {
    const guides = normaliseGuides(
      [
        { orientation: 'vertical', emu: 0 },
        { orientation: 'vertical', emu: size.cx },
        { orientation: 'vertical', emu: -1 },
        { orientation: 'vertical', emu: size.cx + 1 },
        { orientation: 'horizontal', emu: size.cy * 2 },
      ],
      size,
    );
    expect(guides).toEqual([
      { orientation: 'vertical', position: 0 },
      { orientation: 'vertical', position: 1 },
    ]);
  });

  it('merges duplicates from master and layout but keeps both directions', () => {
    const guides = normaliseGuides(
      [
        { orientation: 'vertical', emu: 3048000 },
        { orientation: 'vertical', emu: 3048000.4 },
        { orientation: 'horizontal', emu: 3048000 * (size.cy / size.cx) },
      ],
      size,
    );
    expect(guides).toHaveLength(2);
    expect(guides.map((guide) => guide.orientation)).toEqual(['vertical', 'horizontal']);
  });

  it('is empty for no guides', () => {
    expect(normaliseGuides([], size)).toEqual([]);
  });
});
