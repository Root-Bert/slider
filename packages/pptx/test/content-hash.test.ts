import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { fingerprintFromParsed, matchSlides, openPptx } from '../src';
import { buildPptx, type DeckSpec } from './fixtures/build-pptx';
import { defined } from './helpers';

const DECK: DeckSpec = { slides: [{ title: 'Umsatz', body: ['Pro Quartal'] }] };

const SLIDE = 'ppt/slides/slide1.xml';
const SLIDE_RELS = 'ppt/slides/_rels/slide1.xml.rels';

const chartXml = (value: number) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
  `<c:chart><c:plotArea><c:barChart><c:ser><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>${value}</c:v></c:pt>` +
  '</c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>';

const GRAPHIC_FRAME =
  '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="Diagramm 8"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>' +
  '<p:xfrm><a:off x="1000000" y="2000000"/><a:ext cx="4000000" cy="3000000"/></p:xfrm>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
  '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId99"/>' +
  '</a:graphicData></a:graphic></p:graphicFrame>';

/** The deck with a bar chart on slide 1 whose single value is `value`. */
async function withChart(value: number, relId = 'rId99'): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await buildPptx(DECK));
  const slide = await defined(zip.file(SLIDE)).async('string');
  zip.file(
    SLIDE,
    slide.replace('</p:spTree>', `${GRAPHIC_FRAME.replace('rId99', relId)}</p:spTree>`),
  );
  const rels = await defined(zip.file(SLIDE_RELS)).async('string');
  zip.file(
    SLIDE_RELS,
    rels.replace(
      '</Relationships>',
      `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>`,
    ),
  );
  zip.file('ppt/charts/chart1.xml', chartXml(value));
  return zip.generateAsync({ type: 'uint8array' });
}

async function analyse(bytes: Uint8Array) {
  const pkg = await openPptx(bytes);
  const slide = defined(pkg.presentation.slides[0]);
  const svg = await pkg.renderSlideSvg(slide);
  return { slide, svg, fp: fingerprintFromParsed(slide, { key: 's', renderHash: svg }) };
}

describe('slide content hash', () => {
  it('sees a chart data change the SVG preview cannot, and matching calls it modified', async () => {
    const before = await analyse(await withChart(10));
    const after = await analyse(await withChart(25));
    expect(after.svg).toBe(before.svg);
    expect(after.slide.contentHash).not.toBe(before.slide.contentHash);
    expect(matchSlides([before.fp], [after.fp])[0]?.status).toBe('modified');
  });

  it('is stable across saves: same content, renamed relationship ids', async () => {
    const a = await analyse(await withChart(10, 'rId99'));
    const b = await analyse(await withChart(10, 'rId42'));
    expect(b.slide.contentHash).toBe(a.slide.contentHash);
    expect(matchSlides([a.fp], [b.fp])[0]?.status).toBe('unchanged');
  });

  it('ignores comments added to the slide', async () => {
    const plain = (await openPptx(await buildPptx(DECK))).presentation.slides[0];
    const commented = (
      await openPptx(
        await buildPptx({
          slides: [{ ...defined(DECK.slides[0]), comments: [{ author: 'Lena', text: 'Hm?' }] }],
        }),
      )
    ).presentation.slides[0];
    expect(defined(commented).contentHash).toBe(defined(plain).contentHash);
  });

  it('reads the p14:creationId', async () => {
    const pkg = await openPptx(
      await buildPptx({ slides: [{ title: 'A', creationId: 2105233623 }, { title: 'B' }] }),
    );
    expect(pkg.presentation.slides.map((s) => s.creationId)).toEqual([2105233623, null]);
  });
});
