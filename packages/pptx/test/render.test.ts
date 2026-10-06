import { describe, expect, it } from 'vitest';
import { parseXml } from '../src/xml';
import type { ParsedSlide } from '../src';
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
