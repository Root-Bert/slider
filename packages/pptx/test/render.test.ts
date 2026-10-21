import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseXml } from '../src/xml';
import { MAX_SLIDE_IMAGE_BYTES, renderSlideSvg } from '../src/render/svg';
import { openPptx, svgForRenderHash, type ParsedSlide } from '../src';
import { buildPptx } from './fixtures/build-pptx';
import { TINY_PNG } from './fixtures/png';
import { defined, openDeck } from './helpers';

const firstSlide = (slides: ParsedSlide[]): ParsedSlide => defined(slides[0], 'first slide');

describe('renderSlideSvg', () => {
  it('renders a 1920px wide, well-formed SVG with the slide background', async () => {
    const pptx = await openDeck({
      size: { cx: 9_144_000, cy: 6_858_000 },
      slides: [{ title: 'Hallo', background: '0F172A' }],
    });
    const svg = await pptx.renderSlideSvg(firstSlide(pptx.presentation.slides));

    expect(svg).toMatch(
      /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1920" height="1440" viewBox="0 0 1920 1440">/,
    );
    expect(svg).toContain('<rect width="1920" height="1440" fill="#0f172a"/>');
    expect(() => parseXml(svg)).not.toThrow();
  });

  it('renders text as wrapped XHTML with font sizes scaled from points', async () => {
    const pptx = await openDeck({ slides: [{ title: 'Agenda' }] });
    const svg = await pptx.renderSlideSvg(firstSlide(pptx.presentation.slides));

    // 44 pt on a 13.333 in (960 pt) wide slide rendered at 1920 px → 2 px per point
    expect(svg).toContain('<div xmlns="http://www.w3.org/1999/xhtml"');
    expect(svg).toContain('<span style="font-size:88px">Agenda</span>');
  });

  it('escapes text so slide content cannot inject markup', async () => {
    const pptx = await openDeck({
      slides: [{ title: '<script>alert("x")</script>', body: ['A & B', `" onload="evil()`] }],
    });
    const svg = await pptx.renderSlideSvg(firstSlide(pptx.presentation.slides));

    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(svg).toContain('A &amp; B');
    expect(svg).not.toContain('" onload="');
    expect(() => parseXml(svg)).not.toThrow();
  });

  it('drops characters XML does not allow, so the SVG stays well-formed', async () => {
    // Some generators write control characters as numeric references (`&#11;`), which the
    // parser decodes – they must not end up in the SVG, or browsers refuse the whole image.
    const zip = await JSZip.loadAsync(await buildPptx({ slides: [{ title: 'MARKE' }] }));
    const slide = defined(zip.file('ppt/slides/slide1.xml'));
    const xml = (await slide.async('string')).replace(
      'MARKE',
      'Hi&#1;there&#xB;x&#xFFFE;&#xD800;!',
    );
    zip.file('ppt/slides/slide1.xml', xml);
    const pptx = await openPptx(await zip.generateAsync({ type: 'uint8array' }));
    const svg = await pptx.renderSlideSvg(firstSlide(pptx.presentation.slides));

    expect(svg).toContain('>Hithere x!</span>');
    const illegal = [...svg]
      .map((char) => char.codePointAt(0) ?? 0)
      .filter((code) => (code < 0x20 && ![0x9, 0xa, 0xd].includes(code)) || code === 0xfffe)
      .concat([...svg].filter((char) => /^[\ud800-\udfff]$/.test(char)).map(() => 0xd800));
    expect(illegal).toEqual([]);
  });

  it('shows slide numbers and dates, but leaves them out of the render hash source', async () => {
    const render = async (slideNumber: string, date: string) => {
      const pptx = await openDeck({
        slides: [{ title: 'Agenda', footer: { text: 'Muster AG', slideNumber, date } }],
      });
      const slide = firstSlide(pptx.presentation.slides);
      return { slide, svg: await pptx.renderSlideSvg(slide) };
    };
    const before = await render('2', '16.10.2026');
    const after = await render('3', '17.10.2026');

    expect(before.svg).toContain('>2</span>');
    expect(before.svg).toContain('>16.10.2026</span>');
    expect(after.svg).not.toBe(before.svg);
    expect(svgForRenderHash(after.svg)).toBe(svgForRenderHash(before.svg));
    expect(svgForRenderHash(before.svg)).toContain('Muster AG');
    expect(() => parseXml(svgForRenderHash(before.svg))).not.toThrow();
    expect(after.slide.textHash).toBe(before.slide.textHash);
    // Slides without such fields hash exactly as before.
    const plain = await openDeck({ slides: [{ title: 'Agenda' }] });
    const plainSvg = await plain.renderSlideSvg(firstSlide(plain.presentation.slides));
    expect(svgForRenderHash(plainSvg)).toBe(plainSvg);
  });

  it('inlines pictures as base64 data URIs and draws fills in z-order', async () => {
    const pptx = await openDeck({
      slides: [
        {
          shapes: [
            { type: 'rect', box: { x: 0, y: 0, w: 6_096_000, h: 3_429_000 }, fill: 'FF0000' },
            { type: 'picture', box: { x: 6_096_000, y: 3_429_000, w: 6_096_000, h: 3_429_000 } },
          ],
        },
      ],
    });
    const svg = await pptx.renderSlideSvg(firstSlide(pptx.presentation.slides));
    const base64 = Buffer.from(TINY_PNG).toString('base64');

    expect(svg).toContain('<rect x="0" y="0" width="960" height="540" fill="#ff0000"/>');
    expect(svg).toContain(
      `<image x="960" y="540" width="960" height="540" preserveAspectRatio="none" href="data:image/png;base64,${base64}"/>`,
    );
    expect(svg.indexOf('fill="#ff0000"')).toBeLessThan(svg.indexOf('<image'));
  });

  it('draws a placeholder for images browsers cannot display (EMF/WMF)', async () => {
    const pptx = await openDeck({
      slides: [{ shapes: [{ type: 'picture', box: { x: 0, y: 0, w: 1_000_000, h: 1_000_000 } }] }],
    });
    const slide = firstSlide(pptx.presentation.slides);
    const emfSlide: ParsedSlide = {
      ...slide,
      shapes: slide.shapes.map((shape) => ({ ...shape, imagePath: 'ppt/media/image1.emf' })),
    };
    const svg = await pptx.renderSlideSvg(emfSlide);

    expect(svg).not.toContain('<image');
    expect(svg).toContain('fill="#f3f4f6"');
  });

  it('draws pictures past the per-slide byte cap as placeholders', async () => {
    const pptx = await openDeck({
      slides: [{ shapes: [{ type: 'picture', box: { x: 0, y: 0, w: 1_000_000, h: 1_000_000 } }] }],
    });
    const slide = firstSlide(pptx.presentation.slides);
    const picture = defined(slide.shapes[0], 'picture');
    const big = new Uint8Array(MAX_SLIDE_IMAGE_BYTES / 2);
    const svg = await renderSlideSvg(
      { ...slide, shapes: [picture, picture, picture] },
      pptx.presentation.size,
      async () => big,
    );

    expect(svg.match(/<image /g)).toHaveLength(2);
    expect(svg.match(/fill="#f3f4f6"/g)).toHaveLength(1);
  });

  it('does not unpack pictures the slide budget has no room left for', async () => {
    // One well-compressing picture past half the cap, referenced over and over: only the first
    // is unpacked – the others would inflate it again each time, gigabytes for one slide.
    const png = new Uint8Array(MAX_SLIDE_IMAGE_BYTES / 2 + 1);
    const pptx = await openDeck({
      slides: [
        { shapes: [{ type: 'picture', box: { x: 0, y: 0, w: 1_000_000, h: 1_000_000 }, png }] },
      ],
    });
    const slide = firstSlide(pptx.presentation.slides);
    const picture = defined(slide.shapes[0], 'picture');
    const started = performance.now();
    const svg = await pptx.renderSlideSvg({ ...slide, shapes: Array(500).fill(picture) });

    expect(svg.match(/<image /g)).toHaveLength(1);
    expect(svg.match(/fill="#f3f4f6"/g)).toHaveLength(499);
    expect(performance.now() - started).toBeLessThan(10_000);
  });

  it('hands the loader what is left of the slide budget', async () => {
    const pptx = await openDeck({
      slides: [{ shapes: [{ type: 'picture', box: { x: 0, y: 0, w: 1_000_000, h: 1_000_000 } }] }],
    });
    const slide = firstSlide(pptx.presentation.slides);
    const picture = defined(slide.shapes[0], 'picture');
    const budgets: number[] = [];
    await renderSlideSvg(
      { ...slide, shapes: [picture, picture] },
      pptx.presentation.size,
      async (_, maxBytes) => {
        budgets.push(maxBytes);
        return new Uint8Array(1000);
      },
    );

    expect(budgets).toEqual([MAX_SLIDE_IMAGE_BYTES, MAX_SLIDE_IMAGE_BYTES - 1000]);
  });

  it('ignores colours that are not plain hex values', async () => {
    const pptx = await openDeck({ slides: [{ title: 'Farbe' }] });
    const slide = firstSlide(pptx.presentation.slides);
    const hostile: ParsedSlide = {
      ...slide,
      background: 'red" onload="evil()',
      shapes: slide.shapes.map((shape) => ({ ...shape, fill: 'url(javascript:alert(1))' })),
    };
    const svg = await pptx.renderSlideSvg(hostile);

    expect(svg).not.toContain('evil');
    expect(svg).not.toContain('javascript');
    expect(svg).toContain('fill="#ffffff"');
  });

  it('renders tables as HTML tables', async () => {
    const pptx = await openDeck({
      slides: [
        {
          shapes: [
            {
              type: 'table',
              box: { x: 0, y: 0, w: 6_000_000, h: 1_000_000 },
              rows: [
                ['Region', 'Umsatz'],
                ['DACH', '<b>12</b>'],
              ],
            },
          ],
        },
      ],
    });
    const svg = await pptx.renderSlideSvg(firstSlide(pptx.presentation.slides));

    expect(svg).toContain('<table xmlns="http://www.w3.org/1999/xhtml"');
    expect(svg.match(/<tr>/g)).toHaveLength(2);
    expect(svg).toContain('&lt;b&gt;12&lt;/b&gt;');
  });
});
