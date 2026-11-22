/**
 * The apps' icons – Slider, Cloud, Writer, Sender, Reader: the brand guide's „App Icon“ frames
 * (Figma, 256 units) as flat layers in an Icon Composer document (`brand/logo/icon/<App>.icon`),
 * which Apple's `ictool` turns into the 1024 px picture with the glass edges
 * (`brand/logo/icon/<app>-app-icon.png`). One source, one way, one frame: the tile, the comment
 * box (a white edge of 4, a ring of the product's colour of 4 inside it) and the glass are the same in
 * all of them.
 *
 * One size in the Dock: the layers stand at 93 % of the guide's mark about the tile's middle
 * (`MARK`), so the comment box is 58 % of the tile's width.
 *
 * From the pictures come the desktop apps' icons and the web apps' (192, 512) – all with the
 * margin of Apple's icon grid (the shape 824 of 1024), or one sits larger than the others in the
 * Dock. Slider's own are written by `logo-png.ts --app-only` after this.
 *
 * Needs Xcode (Icon Composer). Run from the repository root: `bun scripts/app-icons.ts [App]`
 * (one app only, by its name), then
 * bump the icons' `?v=` (manifests, `lib/apps.ts`).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const DIR = 'brand/logo/icon';
const ICTOOL =
  '/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool';
/** The layers against the guide's mark. */
const MARK = 0.93;
/** Layer pictures are the guide's units four times over: 256 → 1024. */
const UNIT = 4;

/** The guide's tile: the product's colour under an angular gradient centred 128 above it. */
const tile = (stops: [string, string, string, string]) =>
  `conic-gradient(from 180deg at 50% -50%, ${stops[0]} 0, ${stops[1]} 25%, ${stops[2]} 50%, ${stops[3]} 75%, ${stops[0]} 100%)`;

/** A shape in the product's colour with white laid over it, as the guide mixes its surfaces. */
const over = (shape: string, color: string, white: number) =>
  shape.replace('/>', ` fill="${color}"/>`) +
  shape.replace('/>', ` fill="#fff" fill-opacity="${white}"/>`);

/** The comment box, the same in every icon: 155.52 × 97.2 at (76.16, 62.12), radii 34.56 and 8.64. */
const BOX = { x: 74.16, y: 60.12, w: 159.52, h: 101.2 };
const BOX_D =
  'M76.16 96.68C76.16 77.5931 91.633 62.12 110.72 62.12H197.12C216.207 62.12 231.68 77.593 231.68 96.68V124.76C231.68 143.847 216.207 159.32 197.12 159.32H84.8C80.0283 159.32 76.16 155.452 76.16 150.68V96.68Z';
const box = (color: string) =>
  `<path d="${BOX_D}" fill="${color}" stroke="#fff" stroke-width="4"/>` +
  `<path d="M82.16 96.68A28.56 28.56 0 0 1 110.72 68.12H197.12A28.56 28.56 0 0 1 225.68 96.68V124.76A28.56 28.56 0 0 1 197.12 153.32H84.8A2.64 2.64 0 0 1 82.16 150.68Z" fill="#fff"/>`;

/** A rectangle with its own radius at each corner: top left, top right, bottom right, bottom left. */
const rounded = (x: number, y: number, w: number, h: number, [tl, tr, br, bl]: number[]) =>
  `M${x + tl} ${y}H${x + w - tr}A${tr} ${tr} 0 0 1 ${x + w} ${y + tr}V${y + h - br}A${br} ${br} 0 0 1 ${x + w - br} ${y + h}H${x + bl}A${bl} ${bl} 0 0 1 ${x} ${y + h - bl}V${y + tl}A${tl} ${tl} 0 0 1 ${x + tl} ${y}Z`;

/** Sender's reactions, 23 across: a disc with a heart, a laughing and a smiling face cut out of it. */
const REACTIONS = [
  'M11.5 0C17.85 0 23 5.15 23 11.5S17.85 23 11.5 23 0 17.85 0 11.5 5.15 0 11.5 0ZM14.1 6.79C12.99 6.79 12 7.47 11.5 8.33 11 7.47 10.01 6.79 8.9 6.79 7.28 6.79 5.92 8.03 5.92 9.88 5.92 13.6 11.47 17 11.5 17.01 11.54 16.99 17.08 13.59 17.08 9.88 17.08 8.02 15.72 6.79 14.1 6.79Z',
  'M11.5 0C17.85 0 23 5.15 23 11.5S17.85 23 11.5 23 0 17.85 0 11.5 5.15 0 11.5 0ZM5.3 12.1C5.3 13.74 5.95 15.32 7.12 16.48 8.28 17.65 9.86 18.3 11.5 18.3S14.72 17.65 15.88 16.48C17.05 15.32 17.7 13.74 17.7 12.1H5.3ZM7.6 6.35C7.37 6.35 7.15 6.45 6.98 6.61L4.98 8.71C4.66 9.05 4.67 9.59 5.01 9.92 5.35 10.24 5.89 10.23 6.21 9.89L7.6 8.43 8.98 9.89C9.31 10.23 9.85 10.24 10.19 9.92 10.53 9.59 10.54 9.05 10.21 8.71L8.21 6.61C8.05 6.45 7.83 6.35 7.6 6.35ZM15.4 6.35C15.17 6.35 14.95 6.45 14.78 6.61L12.78 8.71C12.46 9.05 12.47 9.59 12.81 9.92 13.15 10.24 13.69 10.23 14.01 9.89L15.4 8.43 16.78 9.89C17.11 10.23 17.65 10.24 17.99 9.92 18.33 9.59 18.34 9.05 18.01 8.71L16.01 6.61C15.85 6.45 15.63 6.35 15.4 6.35Z',
  'M11.5 0C17.85 0 23 5.15 23 11.5S17.85 23 11.5 23 0 17.85 0 11.5 5.15 0 11.5 0ZM6.1 12.9C6.1 14.33 6.67 15.71 7.68 16.72 8.69 17.73 10.07 18.3 11.5 18.3S14.31 17.73 15.32 16.72C16.33 15.71 16.9 14.33 16.9 12.9H6.1ZM7.6 7C6.66 7 5.9 7.76 5.9 8.7S6.66 10.4 7.6 10.4 9.3 9.64 9.3 8.7 8.54 7 7.6 7ZM15.4 7C14.46 7 13.7 7.76 13.7 8.7S14.46 10.4 15.4 10.4 17.1 9.64 17.1 8.7 16.34 7 15.4 7Z',
];

interface Layer {
  name: string;
  /** Its box in the guide's units, and what is drawn in it. */
  x: number;
  y: number;
  w: number;
  h: number;
  svg: string;
  glass?: boolean;
}
interface Icon {
  app: string;
  file: string;
  background: string;
  /** Front to back, as Icon Composer lists them. */
  layers: Layer[];
  outputs: [path: string, size: number][];
}

const SLIDER = '#e3583d';
const CLOUD = '#6a3fc4';
const WRITER = '#003399';
const SENDER = '#e8590c';
const READER = '#b3261e';
const icons: Icon[] = [
  {
    app: 'Slider',
    file: 'slider-app-icon.png',
    background: `${tile([SLIDER, '#009572', WRITER, CLOUD])}, ${SLIDER}`,
    // a projection screen on a tripod, under its roll, a title and a bar chart on it („Zugband – Balken“)
    layers: [
      { name: 'Comment box', ...BOX, svg: box(SLIDER) },
      {
        name: 'Chart',
        x: 51,
        y: 71,
        w: 132,
        h: 128,
        // the bars are cut where the comment box lies over them: it lets what is under it shine through
        svg:
          `<path d="M54 74H66" stroke="${SLIDER}" stroke-width="6" stroke-linecap="round"/>` +
          `<mask id="under-box"><rect x="51" y="71" width="132" height="128" fill="#fff"/><path d="${BOX_D}" stroke="#000" stroke-width="4"/></mask><g mask="url(#under-box)">` +
          [
            [54, 150],
            [76, 178],
            [98, 132],
            [120, 168],
            [142, 184],
            [164, 120],
          ]
            .map(
              ([x, top]) =>
                `<rect x="${x}" y="${top}" width="16" height="${196 - top}" rx="4" fill="${SLIDER}"/>`,
            )
            .join('') +
          '</g>',
      },
      {
        name: 'Roll',
        x: 36,
        y: 42,
        w: 168,
        h: 14,
        svg: over('<rect x="36" y="42" width="168" height="14" rx="7"/>', SLIDER, 0.1),
      },
      {
        name: 'Screen',
        x: 44,
        y: 52,
        w: 152,
        h: 154,
        glass: true,
        svg: over('<rect x="44" y="52" width="152" height="154" rx="10"/>', SLIDER, 0.5),
      },
      {
        name: 'Legs',
        // only below the screen: the glass would show them through it
        x: 80,
        y: 206,
        w: 80,
        h: 20,
        svg:
          `<path d="M120 146L84 222M120 146L156 222M120 146V214" stroke="${SLIDER}" stroke-width="7" stroke-linecap="round"/>` +
          `<path d="M120 146L84 222M120 146L156 222M120 146V214" stroke="#fff" stroke-opacity="0.7" stroke-width="7" stroke-linecap="round"/>`,
      },
    ],
    // the web and desktop icons are written by `logo-png.ts --app-only`
    outputs: [],
  },
  {
    app: 'Cloud',
    file: 'cloud-app-icon.png',
    background: `${tile([CLOUD, '#e3583d', '#009572', WRITER])}, ${CLOUD}`,
    layers: [
      { name: 'Comment box', ...BOX, svg: box(CLOUD) },
      {
        name: 'Cloud front',
        x: 24,
        y: 136,
        w: 186,
        h: 86,
        svg:
          over('<rect x="24" y="136" width="186" height="86" rx="43"/>', CLOUD, 0.35) +
          `<path d="M63 198V168M76 181L63 168L50 181" stroke="${CLOUD}" stroke-width="6" fill="none"/>`,
      },
      {
        name: 'Cloud back',
        x: 26,
        y: 36,
        w: 164,
        h: 142,
        glass: true,
        svg:
          over('<circle cx="126" cy="100" r="64"/>', CLOUD, 0.55) +
          over('<circle cx="72" cy="132" r="46"/>', CLOUD, 0.45),
      },
    ],
    outputs: [
      ['desktop/cloud/icon.png', 1024],
      ['apps/web/public/cloud-icon-512.png', 512],
      ['apps/web/public/cloud-icon-192.png', 192],
    ],
  },
  {
    app: 'Writer',
    file: 'writer-app-icon.png',
    background: `${tile([WRITER, CLOUD, '#e3583d', '#009572'])}, ${WRITER}`,
    layers: [
      { name: 'Comment box', ...BOX, svg: box(WRITER) },
      {
        name: 'Page',
        x: 28,
        y: 34,
        w: 146,
        h: 189,
        glass: true,
        svg:
          over('<rect x="28" y="34" width="146" height="189" rx="23.3"/>', WRITER, 0.5) +
          `<path transform="translate(43.74 168.86)" d="M0 25.49C10.92 23.44 26.21 12.17 31.67 3.98C36.04 -4.21 21.84 .91 18.56 13.2C13.1 34.7 29.48 27.53 41.5 17.29C49.14 11.15 50.23 13.2 45.86 20.36C41.5 27.53 50.23 25.49 58.97 21.39C70.98 15.24 79.72 18.32 96.1 19.34" stroke="${WRITER}" stroke-width="5.82" stroke-linejoin="round" fill="none"/>`,
      },
    ],
    outputs: [
      ['desktop/writer/icon.png', 1024],
      ['apps/web/public/writer-icon-512.png', 512],
      ['apps/web/public/writer-icon-192.png', 192],
    ],
  },
  {
    app: 'Sender',
    file: 'sender-app-icon.png',
    background: `${tile([SENDER, WRITER, CLOUD, '#009572'])}, ${SENDER}`,
    // built like Slider's: two speech bubbles for its slides – the back one with its sender and
    // the message as lines, the front one with reactions stacked on it (heart, laugh, smile)
    layers: [
      { name: 'Comment box', ...BOX, svg: box(SENDER) },
      {
        name: 'Front bubble',
        x: 45.92,
        y: 118.2,
        w: 172.8,
        h: 103.8,
        svg:
          over(
            `<path d="${rounded(45.92, 118.2, 172.8, 103.8, [25.92, 25.92, 6, 25.92])}"/>`,
            SENDER,
            0.3,
          ) +
          REACTIONS.map(
            (face, i) =>
              // from the second on, each stands in a ring of the bubble's own colour over the one before
              (i ? over(`<circle cx="${80 + i * 21}" cy="190" r="14"/>`, SENDER, 0.3) : '') +
              `<path transform="translate(${68.5 + i * 21} 178.5)" d="${face}" fill="${SENDER}"/>`,
          ).join(''),
      },
      {
        name: 'Back bubble',
        x: 26,
        y: 34,
        w: 172.8,
        h: 97.2,
        glass: true,
        svg:
          over(
            `<path d="${rounded(26, 34, 172.8, 97.2, [25.92, 25.92, 25.92, 6])}"/>`,
            SENDER,
            0.5,
          ) +
          `<path d="M42 52H64" stroke="${SENDER}" stroke-width="6" stroke-linecap="round"/>` +
          `<path d="M42 68H110M42 82H96" stroke="${SENDER}" stroke-opacity="0.55" stroke-width="6" stroke-linecap="round"/>`,
      },
    ],
    outputs: [
      ['desktop/sender/icon.png', 1024],
      ['apps/web/public/sender-icon-512.png', 512],
      ['apps/web/public/sender-icon-192.png', 192],
    ],
  },
  {
    app: 'Reader',
    file: 'reader-app-icon.png',
    background: `${tile([READER, WRITER, CLOUD, '#009572'])}, ${READER}`,
    layers: [
      { name: 'Comment box', ...BOX, svg: box(READER) },
      // the corner folded over, top left, on a layer of its own so it casts its shadow on the page
      {
        name: 'Fold',
        x: 28,
        y: 34,
        w: 52,
        h: 52,
        svg: over('<path d="M80 34V65.72C80 76.92 70.92 86 59.72 86H28L80 34Z"/>', READER, 0.2),
      },
      // a document: a picture and three lines of text under the comment box
      {
        name: 'Page',
        x: 28,
        y: 34,
        w: 146,
        h: 189,
        glass: true,
        svg:
          over(
            '<path d="M80 34H150.7C163.57 34 174 44.43 174 57.3V199.7C174 212.57 163.57 223 150.7 223H51.3C38.43 223 28 212.57 28 199.7V86L80 34Z"/>',
            READER,
            0.5,
          ) +
          `<rect x="44" y="165" width="38" height="38" rx="7" fill="${READER}" fill-opacity="0.9"/>` +
          '<path d="M48 196L59.54 178L67.62 189.57L72.23 183.14L78 196Z" fill="#f3d4d2" stroke="#f3d4d2" stroke-width="2.3" stroke-linejoin="round"/>' +
          `<path d="M94 173H152M94 187H144M94 201H128" stroke="${READER}" stroke-width="6" stroke-linecap="round" fill="none"/>`,
      },
    ],
    outputs: [
      ['desktop/reader/icon.png', 1024],
      ['apps/web/public/reader-icon-512.png', 512],
      ['apps/web/public/reader-icon-192.png', 192],
    ],
  },
];
const only = process.argv[2];

const browser = await chromium.launch();
const page = await browser.newPage();
const shot = async (path: string, width: number, height: number, body: string) => {
  await page.setViewportSize({ width, height });
  await page.setContent(`<body style="margin:0;background:transparent">${body}</body>`);
  for (const img of await page.locator('img').all()) {
    await img.evaluate((each: HTMLImageElement) => each.decode());
  }
  writeFileSync(path, await page.screenshot({ type: 'png', omitBackground: true }));
};

/** Apple's macOS icon grid: the shape is 824 of the 1024 px canvas. */
const MAC_SHAPE = 824 / 1024;
for (const icon of icons.filter((each) => !only || each.app === only)) {
  const document = `${DIR}/${icon.app}.icon`;
  mkdirSync(`${document}/Assets`, { recursive: true });
  await shot(
    `${document}/Assets/Background.png`,
    1024,
    1024,
    `<div style="width:1024px;height:1024px;background:${icon.background}"></div>`,
  );
  const groups = [];
  for (const layer of icon.layers) {
    const width = Math.round(layer.w * UNIT);
    const height = Math.round(layer.h * UNIT);
    await shot(
      `${document}/Assets/${layer.name}.png`,
      width,
      height,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${layer.x} ${layer.y} ${layer.w} ${layer.h}" style="display:block">${layer.svg}</svg>`,
    );
    const from = (middle: number) => Math.round((middle - 128) * UNIT * MARK * 100) / 100;
    groups.push({
      layers: [
        {
          fill: 'automatic',
          ...(layer.glass && { glass: true }),
          'image-name': `${layer.name}.png`,
          name: layer.name,
          position: {
            scale: MARK,
            'translation-in-points': [from(layer.x + layer.w / 2), from(layer.y + layer.h / 2)],
          },
        },
      ],
      shadow: { kind: 'neutral', opacity: 0.5 },
      translucency: { enabled: true, value: 0.3 },
    });
  }
  groups.push({
    layers: [{ glass: false, 'image-name': 'Background.png', name: 'Background' }],
    shadow: { kind: 'neutral', opacity: 0.5 },
    translucency: { enabled: true, value: 0.3 },
  });
  writeFileSync(
    `${document}/icon.json`,
    `${JSON.stringify({ fill: 'automatic', groups, 'supported-platforms': { circles: ['watchOS'], squares: 'shared' } }, null, 2)}\n`,
  );
  execFileSync('npx', ['prettier', '--write', `${document}/icon.json`], { stdio: 'ignore' });
  const picture = `${DIR}/${icon.file}`;
  execFileSync(
    ICTOOL,
    [
      document,
      '--export-image',
      '--output-file',
      picture,
      ...['--platform', 'iOS', '--rendition', 'Default'],
      ...['--width', '1024', '--height', '1024', '--scale', '1'],
    ],
    { stdio: 'ignore' },
  );
  const src = `data:image/png;base64,${readFileSync(picture).toString('base64')}`;
  for (const [path, size] of icon.outputs) {
    const drawn = Math.round(size * MAC_SHAPE);
    await shot(
      path,
      size,
      size,
      `<div style="display:grid;place-items:center;height:${size}px"><img src="${src}" width="${drawn}" height="${drawn}" style="display:block"></div>`,
    );
    console.info(`wrote ${path} (${size} × ${size}, shape ${drawn} px)`);
  }
}
await browser.close();
