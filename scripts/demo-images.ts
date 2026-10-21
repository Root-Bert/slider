/**
 * Draws the demo pictures: the photo slides of the seed workspace (apps/api/seed/assets/slide-1.png,
 * slide-4.png) and the comment examples of the website (sketch-image.jpg, video-thumb.jpg). The
 * landscape in them is generated here – ridges from seeded noise over a lake – so no stock photo
 * is involved. Renders with Playwright's Chromium; run from the repository root:
 *
 *   bun scripts/demo-images.ts
 */
import { writeFile } from 'node:fs/promises';
import { chromium, type Page } from '@playwright/test';

interface Palette {
  sky: [string, string, string];
  sun: string;
  ridges: string[];
  water: [string, string];
  veil: string;
}

/** Dusk over the lake, for the dark title slide and the website. */
const DUSK: Palette = {
  sky: ['#1f2a33', '#5f7480', '#c9b79c'],
  sun: '#f3dcb2',
  ridges: ['#8e9ea6', '#66777f', '#43525a', '#28343b'],
  water: ['#3c4b52', '#1a2328'],
  veil: 'rgba(10, 12, 14, 0.18)',
};

/** The same lake in pale morning light, for the white content slide. */
const MORNING: Palette = {
  sky: ['#c9d3d6', '#dde3e3', '#ece8df'],
  sun: '#fbf5e8',
  ridges: ['#c3cdcf', '#aab7ba', '#8f9fa3', '#76878b'],
  water: ['#b4c2c4', '#93a5a8'],
  veil: 'rgba(255, 255, 255, 0.08)',
};

/** mulberry32: a small seeded generator, so every run draws the same picture. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fractal value noise along one axis, `samples` values in about -1…1. */
function noise(samples: number, seed: number): number[] {
  const next = random(seed);
  const octaves = [6, 13, 29, 61, 127].map((knots, i) => ({
    values: Array.from({ length: knots + 1 }, () => next() * 2 - 1),
    weight: 0.55 ** i,
  }));
  return Array.from({ length: samples }, (_, s) => {
    const x = s / (samples - 1);
    return octaves.reduce((sum, { values, weight }) => {
      const at = x * (values.length - 1);
      const i = Math.min(Math.floor(at), values.length - 2);
      const f = (1 - Math.cos((at - i) * Math.PI)) / 2;
      return sum + weight * ((values[i] ?? 0) * (1 - f) + (values[i + 1] ?? 0) * f);
    }, 0);
  });
}

/** The lake scene as SVG, `width` × `height`, with the horizon at 58 %. */
function landscape(width: number, height: number, palette: Palette): string {
  const horizon = height * 0.58;
  const ridges = palette.ridges.map((color, layer) => {
    const values = noise(240, 11 + layer * 7);
    const base = horizon - height * (0.3 - layer * 0.07);
    const amplitude = height * (0.09 - layer * 0.012);
    const points = values.map((v, i) => `${(i / 239) * width},${base + v * amplitude}`);
    const top = `M0,${horizon} L${points.join(' L')} L${width},${horizon} Z`;
    const mirrored = values.map(
      (v, i) => `${(i / 239) * width},${2 * horizon - base - v * amplitude}`,
    );
    const reflection = `M0,${horizon} L${mirrored.join(' L')} L${width},${horizon} Z`;
    return { color, top, reflection };
  });
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${palette.sky[0]}"/>
      <stop offset="0.7" stop-color="${palette.sky[1]}"/>
      <stop offset="1" stop-color="${palette.sky[2]}"/>
    </linearGradient>
    <radialGradient id="sun" gradientUnits="userSpaceOnUse" cx="${width * 0.68}" cy="${horizon - height * 0.3}" r="${Math.max(width, height) * 0.45}">
      <stop offset="0" stop-color="${palette.sun}" stop-opacity="0.95"/>
      <stop offset="0.04" stop-color="${palette.sun}" stop-opacity="0.8"/>
      <stop offset="0.25" stop-color="${palette.sun}" stop-opacity="0.25"/>
      <stop offset="1" stop-color="${palette.sun}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${palette.water[0]}"/>
      <stop offset="1" stop-color="${palette.water[1]}"/>
    </linearGradient>
    <filter id="ripples" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.004 0.12" numOctaves="2" seed="4"/>
      <feDisplacementMap in="SourceGraphic" scale="${height * 0.012}" xChannelSelector="R" yChannelSelector="G"/>
      <feGaussianBlur stdDeviation="${height * 0.0025} ${height * 0.001}"/>
    </filter>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="9"/>
      <feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.07 0"/>
    </filter>
  </defs>
  <rect width="${width}" height="${horizon}" fill="url(#sky)"/>
  <rect width="${width}" height="${horizon}" fill="url(#sun)"/>
  ${ridges.map((r) => `<path d="${r.top}" fill="${r.color}"/>`).join('\n  ')}
  <rect y="${horizon}" width="${width}" height="${height - horizon}" fill="url(#water)"/>
  <g filter="url(#ripples)" opacity="0.45">
    <rect y="${horizon}" width="${width}" height="${height - horizon}" fill="url(#water)"/>
    ${ridges.map((r) => `<path d="${r.reflection}" fill="${r.color}"/>`).join('\n    ')}
  </g>
  <rect y="${horizon - 1}" width="${width}" height="${height * 0.004}" fill="${palette.water[1]}" opacity="0.5"/>
  <rect width="${width}" height="${height}" fill="${palette.veil}"/>
  <rect width="${width}" height="${height}" filter="url(#grain)"/>
</svg>`;
}

const FONT = `'Helvetica Neue', Helvetica, Arial, sans-serif`;

/** Title slide on dark: the landscape in a rounded frame, title and subtitle below. */
function titleSlide(): string {
  return `
<div style="position:relative;width:1920px;height:1080px;background:#141414;font-family:${FONT}">
  <div style="position:absolute;left:54px;top:54px;width:1812px;height:754px;border-radius:34px;overflow:hidden">
    ${landscape(1812, 754, DUSK)}
  </div>
  <div style="position:absolute;left:82px;top:842px;font-size:96px;letter-spacing:-1px;color:#f0eee8">Presentation title</div>
  <div style="position:absolute;left:82px;top:955px;font-size:36px;color:#f0eee8">Add a brief explanation of the presentation’s purpose</div>
</div>`;
}

/** Content slide on white: the landscape on the left, three short sections on the right. */
function contentSlide(): string {
  const section = (top: number) => `
  <div style="position:absolute;left:1148px;top:${top}px;width:660px;color:#141414">
    <div style="font-size:29px;font-weight:700">Add a subtitle</div>
    <div style="margin-top:14px;font-size:29px;line-height:40px">Give general information about this topic to add depth and clarity. Write short, interesting reference points that don’t need to be read aloud.</div>
  </div>`;
  return `
<div style="position:relative;width:1920px;height:1080px;background:#ffffff;font-family:${FONT}">
  <div style="position:absolute;left:54px;top:54px;width:984px;height:972px;border-radius:34px;overflow:hidden">
    ${landscape(984, 972, MORNING)}
  </div>
  <div style="position:absolute;left:1146px;top:248px;font-size:72px;letter-spacing:-0.5px;color:#141414">Add a title</div>
  ${section(368)}${section(590)}${section(811)}
</div>`;
}

/** A frame of a video comment: the lake with rough yellow marker strokes over it. */
function videoFrame(width: number, height: number): string {
  const stroke = (d: string) =>
    `<path d="${d}" fill="none" stroke="#f3d54e" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" filter="url(#marker)"/>`;
  return `
<div style="position:relative;width:${width}px;height:${height}px;overflow:hidden">
  ${landscape(width, height, DUSK)}
  <svg style="position:absolute;inset:0" width="${width}" height="${height}" viewBox="0 0 480 233">
    <filter id="marker"><feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="2" seed="3"/>
      <feDisplacementMap in="SourceGraphic" scale="6" xChannelSelector="R" yChannelSelector="G"/></filter>
    ${stroke('M34 22 L262 26')}
    ${stroke('M40 74 L122 70')}
    ${stroke('M44 124 L182 122 L178 186 L48 188 Z')}
    ${stroke('M238 132 L408 128 L412 212 L236 214 Z')}
  </svg>
</div>`;
}

async function shoot(page: Page, html: string, width: number, height: number, file: string) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<body style="margin:0">${html}</body>`);
  const type = file.endsWith('.png') ? 'png' : 'jpeg';
  await writeFile(
    file,
    await page.screenshot({ type, ...(type === 'jpeg' ? { quality: 86 } : {}) }),
  );
  console.info(`wrote ${file}`);
}

/** The title slide scaled down, as the website's sketch example shows it. */
const scaled = (png: Buffer, width: number, height: number) =>
  `<img src="data:image/png;base64,${png.toString('base64')}" width="${width}" height="${height}" style="display:block">`;

const browser = await chromium.launch();
const page = await browser.newPage();
await shoot(page, titleSlide(), 1920, 1080, 'apps/api/seed/assets/slide-1.png');
await shoot(page, contentSlide(), 1920, 1080, 'apps/api/seed/assets/slide-4.png');
await page.setViewportSize({ width: 1920, height: 1080 });
await page.setContent(`<body style="margin:0">${titleSlide()}</body>`);
const title = await page.screenshot({ type: 'png' });
for (const [file, width, height] of [
  ['apps/site/public/home-b/comments/sketch-image.jpg', 480, 270],
  ['apps/site/public/product-b/sketch-image.jpg', 600, 337],
] as const) {
  await shoot(page, scaled(title, width, height), width, height, file);
}
for (const [file, width, height] of [
  ['apps/site/public/home-b/comments/video-thumb.jpg', 480, 233],
  ['apps/site/public/product-b/video-thumb.jpg', 576, 279],
] as const) {
  await shoot(page, videoFrame(width, height), width, height, file);
}
await browser.close();
