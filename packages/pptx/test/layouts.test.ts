import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { Archive, REL } from '../src/archive';
import { LayoutResolver, readBackground } from '../src/layouts';
import { NO_TEXT_DEFAULTS } from '../src/text';
import { parseXml } from '../src/xml';

/** One master unit is 1/576 inch = 1587.5 EMU. */
const UNIT = 914400 / 576;

const rels = (entries: Array<[type: string, target: string]>) =>
  '<Relationships>' +
  entries
    .map(
      ([type, target], index) =>
        `<Relationship Id="rId${index + 1}" Type="${type}" Target="${target}"/>`,
    )
    .join('') +
  '</Relationships>';

const placeholder = (id: number, ph: string, extra = '') =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Platzhalter ${id}"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr>${extra}</p:sp>`;

const xfrm = (x: number, y: number, cx: number, cy: number) =>
  `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm></p:spPr>`;

const lstStyle = (attrs: string, sz?: number) =>
  `<p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr ${attrs}>${sz ? `<a:defRPr sz="${sz}"/>` : ''}</a:lvl1pPr></a:lstStyle><a:p/></p:txBody>`;

const guideList = (guides: string) =>
  `<p:extLst><p:ext uri="{27BBF7A9-308A-43DC-89C8-2F10F3537804}"><p15:sldGuideLst>${guides}</p15:sldGuideLst></p:ext></p:extLst>`;

const theme =
  '<a:theme><a:themeElements><a:clrScheme name="T">' +
  '<a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:accent1><a:srgbClr val="2563EB"/></a:accent1>' +
  '</a:clrScheme></a:themeElements></a:theme>';

const master =
  '<p:sldMaster><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>' +
  placeholder(2, '<p:ph type="title"/>', xfrm(100, 200, 3000, 400)) +
  placeholder(
    3,
    '<p:ph type="body" idx="1"/>',
    xfrm(100, 800, 3000, 2000) + lstStyle('marL="0"', 2400),
  ) +
  '</p:spTree></p:cSld>' +
  '<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle>' +
  '<p:bodyStyle><a:lvl1pPr algn="l"><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle></p:txStyles>' +
  guideList('<p15:guide id="1" pos="576"/>') +
  '</p:sldMaster>';

const layout =
  '<p:sldLayout><p:cSld name="Titel und Inhalt"><p:spTree>' +
  placeholder(2, '<p:ph type="title"/>', lstStyle('algn="ctr"')) +
  placeholder(3, '<p:ph idx="1"/>', xfrm(500, 900, 2000, 1500) + lstStyle('', 2000)) +
  '</p:spTree></p:cSld>' +
  guideList('<p15:guide id="2" orient="horz" pos="288"/>') +
  '</p:sldLayout>';

const darkLayout =
  '<p:sldLayout><p:cSld name="Dunkel"><p:bg><p:bgPr><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></p:bgPr></p:bg>' +
  '<p:spTree/></p:cSld></p:sldLayout>';

async function openArchive(): Promise<Archive> {
  const zip = new JSZip();
  const files: Record<string, string> = {
    'ppt/slides/slide1.xml': '<p:sld/>',
    'ppt/slides/_rels/slide1.xml.rels': rels([
      [REL.slideLayout, '../slideLayouts/slideLayout1.xml'],
    ]),
    'ppt/slides/slide2.xml': '<p:sld/>',
    'ppt/slides/_rels/slide2.xml.rels': rels([
      [REL.slideLayout, '../slideLayouts/slideLayout1.xml'],
    ]),
    'ppt/slides/slide3.xml': '<p:sld/>',
    'ppt/slides/_rels/slide3.xml.rels': rels([
      [REL.slideLayout, '../slideLayouts/slideLayout2.xml'],
    ]),
    'ppt/slides/slide4.xml': '<p:sld/>',
    'ppt/slideLayouts/slideLayout1.xml': layout,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels([
      [REL.slideMaster, '../slideMasters/slideMaster1.xml'],
    ]),
    'ppt/slideLayouts/slideLayout2.xml': darkLayout,
    'ppt/slideLayouts/_rels/slideLayout2.xml.rels': rels([
      [REL.slideMaster, '../slideMasters/slideMaster1.xml'],
    ]),
    'ppt/slideMasters/slideMaster1.xml': master,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels([[REL.theme, '../theme/theme1.xml']]),
    'ppt/theme/theme1.xml': theme,
  };
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return Archive.open(await zip.generateAsync({ type: 'uint8array' }));
}

describe('LayoutResolver', () => {
  it('reads name, theme, master background and the guides of master and layout', async () => {
    const context = await new LayoutResolver(await openArchive()).forSlide('ppt/slides/slide1.xml');
    expect(context.name).toBe('Titel und Inhalt');
    expect(context.background).toBe('#ffffff');
    expect(Object.fromEntries(context.scheme)).toEqual({
      dk1: '#000000',
      lt1: '#ffffff',
      dk2: '#1f2937',
      accent1: '#2563eb',
    });
    expect(context.guides).toEqual([
      { orientation: 'vertical', emu: 576 * UNIT },
      { orientation: 'horizontal', emu: 288 * UNIT },
    ]);
  });

  it('prefers the layout background', async () => {
    const context = await new LayoutResolver(await openArchive()).forSlide('ppt/slides/slide3.xml');
    expect(context.name).toBe('Dunkel');
    expect(context.background).toBe('#1f2937');
    expect(context.guides).toEqual([{ orientation: 'vertical', emu: 576 * UNIT }]);
  });

  it('caches one context per layout', async () => {
    const resolver = new LayoutResolver(await openArchive());
    const first = await resolver.forSlide('ppt/slides/slide1.xml');
    expect(await resolver.forSlide('ppt/slides/slide2.xml')).toBe(first);
    expect(await resolver.forSlide('ppt/slides/slide3.xml')).not.toBe(first);
  });

  it('takes the title box from the master and its alignment from the layout', async () => {
    const context = await new LayoutResolver(await openArchive()).forSlide('ppt/slides/slide1.xml');
    expect(context.resolvePlaceholder({ type: 'title', idx: null })).toEqual({
      box: { x: 100, y: 200, w: 3000, h: 400 },
      text: { sizePt: 44, align: 'center' },
    });
    // A centred title shares the title placeholder and the title style.
    expect(context.resolvePlaceholder({ type: 'ctrTitle', idx: null })).toEqual({
      box: { x: 100, y: 200, w: 3000, h: 400 },
      text: { sizePt: 44, align: 'center' },
    });
  });

  it('matches a content placeholder by idx, then by its type family', async () => {
    const context = await new LayoutResolver(await openArchive()).forSlide('ppt/slides/slide1.xml');
    const expected = {
      box: { x: 500, y: 900, w: 2000, h: 1500 },
      text: { sizePt: 20, align: 'left' },
    };
    expect(context.resolvePlaceholder({ type: 'body', idx: '1' })).toEqual(expected);
    // `obj` belongs to the body family; idx 7 is on no layout placeholder.
    expect(context.resolvePlaceholder({ type: 'obj', idx: '7' })).toEqual(expected);
  });

  it('falls back to the body style for placeholders neither layout nor master has', async () => {
    const context = await new LayoutResolver(await openArchive()).forSlide('ppt/slides/slide1.xml');
    expect(context.resolvePlaceholder({ type: 'sldNum', idx: '12' })).toEqual({
      box: null,
      text: { sizePt: 28, align: 'left' },
    });
  });

  it('knows nothing for a slide without a layout', async () => {
    const context = await new LayoutResolver(await openArchive()).forSlide('ppt/slides/slide4.xml');
    expect(context.name).toBeNull();
    expect(context.background).toBeNull();
    expect(context.scheme.size).toBe(0);
    expect(context.guides).toEqual([]);
    expect(context.resolvePlaceholder({ type: 'title', idx: null })).toEqual({
      box: null,
      text: NO_TEXT_DEFAULTS,
    });
  });
});

describe('readBackground', () => {
  const scheme = new Map([
    ['lt1', '#ffffff'],
    ['accent1', '#2563eb'],
  ]);
  const cSld = (bg: string) => parseXml(`<p:cSld>${bg}<p:spTree/></p:cSld>`);

  it('reads a solid background fill', () => {
    expect(
      readBackground(
        cSld('<p:bg><p:bgPr><a:solidFill><a:srgbClr val="0F172A"/></a:solidFill></p:bgPr></p:bg>'),
        scheme,
      ),
    ).toBe('#0f172a');
  });

  it('reads the colour of a background reference', () => {
    expect(
      readBackground(
        cSld('<p:bg><p:bgRef idx="1001"><a:schemeClr val="accent1"/></p:bgRef></p:bg>'),
        scheme,
      ),
    ).toBe('#2563eb');
  });

  it('is null for gradients, pictures and no background', () => {
    expect(readBackground(cSld('<p:bg><p:bgPr><a:gradFill/></p:bgPr></p:bg>'), scheme)).toBeNull();
    expect(readBackground(cSld(''), scheme)).toBeNull();
    expect(readBackground(undefined, scheme)).toBeNull();
  });
});
