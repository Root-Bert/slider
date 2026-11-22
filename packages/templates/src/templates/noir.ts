import { createCanvas } from '@napi-rs/canvas';
import { grain, jpeg, noise, paint, rng } from '../art';
import type { Layout, Picture, Shape, Template } from '../model';
import { page, rule } from '../shapes';

/*
 * Noir: a film still from the forties. Deep black with grain, light that falls through blinds
 * as soft slanted bars, a lamp's pool on the wall, an elegant serif in off-white. Dark and calm.
 */

const black = '#0b0b0c';
const cream = '#ece6d8';
const dim = '#a39d90';
const brass = '#b0935a';
const hair = '#3d3c3a';

type Light = (
  ctx: ReturnType<typeof createCanvas> extends { getContext(type: '2d'): infer C } ? C : never,
  w: number,
  h: number,
) => void;

/** Bars of light as blinds throw them: a slanted patch of stripes, each fading at its ends. */
const blinds =
  (options: {
    x: number;
    y: number;
    length: number;
    height: number;
    bars: number;
    turn: number;
    skew: number;
    strength: number;
  }): Light =>
  (ctx, w, h) => {
    ctx.save();
    ctx.translate(options.x * w, options.y * h);
    ctx.rotate((options.turn * Math.PI) / 180);
    ctx.transform(1, 0, options.skew, 1, 0, 0);
    const [length, height] = [options.length * w, options.height * h];
    const step = height / options.bars;
    for (let i = 0; i < options.bars; i += 1) {
      const fall = 1 - (i / options.bars) * 0.55;
      const bar = ctx.createLinearGradient(0, 0, length, 0);
      bar.addColorStop(0, 'rgba(255,250,235,0)');
      bar.addColorStop(0.18, `rgba(255,250,235,${options.strength * fall})`);
      bar.addColorStop(0.7, `rgba(255,250,235,${options.strength * fall * 0.75})`);
      bar.addColorStop(1, 'rgba(255,250,235,0)');
      ctx.fillStyle = bar;
      ctx.fillRect(0, i * step, length, step * 0.5);
    }
    ctx.restore();
  };

/** A lamp's pool of light on the wall. */
const pool =
  (x: number, y: number, r: number, strength: number): Light =>
  (ctx, w, h) => {
    const glow = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * w);
    glow.addColorStop(0, `rgba(255,250,235,${strength})`);
    glow.addColorStop(0.55, `rgba(255,250,235,${strength * 0.4})`);
    glow.addColorStop(1, 'rgba(255,250,235,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  };

/** A whole-page ground: the lights drawn small and blown up (soft), on black, with grain. */
function ground(lights: readonly Light[], seed: number): Picture {
  const surface = paint(undefined, 58);
  const { ctx, w, h } = surface;
  const small = createCanvas(Math.round(w / 7), Math.round(h / 7));
  const soft = small.getContext('2d');
  soft.fillStyle = '#000000';
  soft.fillRect(0, 0, small.width, small.height);
  for (const light of lights) light(soft, small.width, small.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, w, h);
  // The wall is uneven and the lens darkens towards its rim.
  const field = noise(seed);
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const [u, v] = [x / w - 0.5, y / h - 0.5];
      const rim = Math.max(0, 1 - (u * u + v * v) * 1.5);
      const wall = 0.7 + field(x / 180, y / 180, 4) * 0.6;
      const value = 11 + data[i]! * wall * rim * 0.5;
      data[i] = value * 1.0;
      data[i + 1] = value * 0.99;
      data[i + 2] = value * 0.96;
    }
  }
  ctx.putImageData(image, 0, 0);
  grain(surface, 0.075, seed + 1);
  return jpeg(surface, 80);
}

const windowLight = ground(
  [
    blinds({
      x: 0.5,
      y: -0.08,
      length: 0.62,
      height: 0.95,
      bars: 9,
      turn: 14,
      skew: -0.5,
      strength: 0.95,
    }),
    pool(0.86, 0.2, 0.5, 0.22),
  ],
  11,
);
const lampLight = ground(
  [
    pool(0.72, 0.5, 0.42, 0.75),
    blinds({
      x: 0.52,
      y: 0.2,
      length: 0.5,
      height: 0.6,
      bars: 7,
      turn: 0,
      skew: -0.25,
      strength: 0.25,
    }),
  ],
  23,
);
const stripLight = ground(
  [
    blinds({
      x: 0.66,
      y: -0.1,
      length: 0.5,
      height: 0.34,
      bars: 4,
      turn: 10,
      skew: -0.6,
      strength: 0.7,
    }),
    pool(0.1, 1, 0.5, 0.12),
  ],
  37,
);
const wideLight = ground(
  [
    blinds({
      x: -0.1,
      y: 0.02,
      length: 1.3,
      height: 1.1,
      bars: 10,
      turn: -6,
      skew: -0.2,
      strength: 0.34,
    }),
    pool(0.5, 0.5, 0.6, 0.1),
  ],
  51,
);

const still = (src: Picture, rotate = 0): Shape => ({ t: 'image', ...page, src, rotate });
const shade = (opacity: number): Shape => ({
  t: 'rect',
  ...page,
  fill: { t: 'solid', color: '#000000', opacity },
});

/** A street lamp in fog over wet pavement – a grey stand-in for a photo. */
function street(seed: number): Picture {
  const surface = paint({ w: 28, h: 17.5 }, 56);
  const { ctx, w, h } = surface;
  const random = rng(seed);
  ctx.fillStyle = '#101011';
  ctx.fillRect(0, 0, w, h);
  const horizon = h * 0.66;
  const lampX = w * (seed % 2 ? 0.36 : 0.64);
  const fog = ctx.createRadialGradient(lampX, h * 0.24, 0, lampX, h * 0.24, w * 0.6);
  fog.addColorStop(0, 'rgba(235,232,222,0.95)');
  fog.addColorStop(0.08, 'rgba(200,198,190,0.6)');
  fog.addColorStop(0.4, 'rgba(120,120,118,0.28)');
  fog.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fog;
  ctx.fillRect(0, 0, w, h);
  // Houses in two rows: the far one grey in the fog, the near one black, a few windows lit.
  for (const layer of [0, 1]) {
    let x = -w * 0.03;
    while (x < w) {
      const width = w * random.range(0.06, 0.15);
      const top = horizon - h * (layer ? random.range(0.14, 0.4) : random.range(0.3, 0.56));
      const near = Math.abs(x + width / 2 - lampX) / w;
      const tone = layer ? 6 : Math.round(58 - near * 60);
      ctx.fillStyle = `rgba(${tone},${tone},${tone},${layer ? 0.96 : 0.8})`;
      ctx.fillRect(x, top, width, horizon - top);
      for (let k = 0; k < 3; k += 1) {
        if (layer && random() < 0.4) {
          ctx.fillStyle = `rgba(230,224,205,${random.range(0.3, 0.75)})`;
          ctx.fillRect(
            x + width * random.range(0.15, 0.7),
            top + (horizon - top) * random.range(0.12, 0.7),
            width * 0.09,
            h * 0.024,
          );
        }
      }
      x += width + w * (layer ? random.range(0.01, 0.09) : random.range(0, 0.01));
    }
    // Fog between the rows.
    const mist = ctx.createLinearGradient(0, horizon - h * 0.3, 0, horizon);
    mist.addColorStop(0, 'rgba(150,148,142,0)');
    mist.addColorStop(1, `rgba(150,148,142,${layer ? 0.1 : 0.3})`);
    ctx.fillStyle = mist;
    ctx.fillRect(0, horizon - h * 0.3, w, h * 0.3);
  }
  const halo = ctx.createRadialGradient(lampX, h * 0.24, 0, lampX, h * 0.24, w * 0.16);
  halo.addColorStop(0, 'rgba(255,252,240,1)');
  halo.addColorStop(0.1, 'rgba(240,236,224,0.55)');
  halo.addColorStop(1, 'rgba(240,236,224,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, h);
  // The lamp post.
  ctx.fillStyle = '#050505';
  ctx.fillRect(lampX - w * 0.003, h * 0.24, w * 0.006, horizon - h * 0.24 + h * 0.03);
  // Wet pavement: the light again, stretched and broken.
  ctx.fillStyle = '#0a0a0b';
  ctx.fillRect(0, horizon, w, h - horizon);
  for (let i = 0; i < 160; i += 1) {
    const y = horizon + (h - horizon) * random() ** 1.4;
    const spread = w * (0.05 + ((y - horizon) / (h - horizon)) * 0.25);
    const cx = lampX + random.bell() * spread;
    ctx.fillStyle = `rgba(225,220,205,${random.range(0.03, 0.22)})`;
    ctx.fillRect(cx - w * random.range(0.01, 0.06), y, w * random.range(0.02, 0.12), h * 0.004);
  }
  const rim = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.7);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, w, h);
  grain(surface, 0.11, seed + 5);
  return jpeg(surface, 82);
}

const layouts: Layout[] = [
  {
    // The window's light across the right; the title low on the dark left.
    name: 'Titel',
    bg: black,
    shapes: [still(windowLight), rule(1.9, 12.55, 3.4, brass, 0.05)],
    title: {
      x: 1.8,
      y: 4.6,
      w: 17,
      h: 7.4,
      valign: 'bottom',
      size: 80,
      lineHeight: 96,
      sample: 'Die Nacht\nder Zahlen',
    },
    subtitle: {
      x: 1.9,
      y: 13,
      w: 16,
      h: 1.4,
      valign: 'middle',
      sample: 'Ein Bericht in drei Akten',
    },
  },
  {
    // A lamp's pool on the right, the act named beside a brass line.
    name: 'Abschnitt',
    bg: black,
    shapes: [still(lampLight), rule(2, 5.3, 5.2, brass, 0.05, true)],
    title: {
      x: 2.9,
      y: 5,
      w: 14,
      h: 4.2,
      valign: 'middle',
      size: 68,
      italic: true,
      sample: 'Zweiter Akt',
    },
    subtitle: {
      x: 2.95,
      y: 9.3,
      w: 14,
      h: 1.3,
      valign: 'middle',
      sample: 'Die Spur führt nach Süden',
    },
  },
  {
    // Almost dark: a strip of light in the corner, a hairline under the title.
    name: 'Inhalt',
    bg: black,
    shapes: [
      still(stripLight),
      rule(1.9, 4.25, 24.2, hair, 0.03),
      rule(1.9, 4.25, 3.4, brass, 0.05),
    ],
    title: { x: 1.8, y: 1.4, w: 17, h: 2.5, valign: 'bottom', size: 40 },
    body: {
      x: 1.9,
      y: 5.1,
      w: 22.5,
      h: 9.2,
      sample: [
        'Ein Fall beginnt mit einer einfachen Frage',
        'Die Zahlen sagen etwas anderes als die Zeugen',
        'Wer profitiert, hat selten ein Alibi',
        'Jede Spur wird zweimal geprüft',
        'Am Ende bleibt nur eine Erklärung',
      ],
    },
  },
  {
    // The picture as a still pinned up on the right, a thin frame set off from it.
    name: 'Text und Bild',
    bg: black,
    shapes: [
      still(stripLight, 180),
      {
        t: 'rect',
        x: 15.3,
        y: 1.3,
        w: 11.4,
        h: 12.6,
        fill: null,
        stroke: { color: cream, width: 0.03, opacity: 0.45 },
      },
      rule(1.9, 5.35, 3.4, brass, 0.05),
    ],
    title: { x: 1.8, y: 1.4, w: 12, h: 3.6, valign: 'bottom', size: 38 },
    body: {
      x: 1.9,
      y: 6.1,
      w: 11.8,
      h: 8.2,
      size: 19,
      sample: ['Das Bild zeigt den Ort', 'Der Text nennt das Motiv', 'Den Rest denkt man sich'],
    },
    pictures: [{ x: 15.7, y: 1.7, w: 11.4, h: 12.6 }],
  },
  {
    // The window's light turned to the lower left, dimmed; two columns either side of a hairline.
    name: 'Zwei Spalten',
    bg: black,
    shapes: [
      still(windowLight, 180),
      shade(0.5),
      rule(14, 5, 9.2, hair, 0.03, true),
      rule(1.9, 5, 3.4, brass, 0.05),
      rule(15.5, 5, 3.4, brass, 0.05),
    ],
    title: { x: 1.8, y: 1.4, w: 24, h: 2.6, valign: 'bottom', size: 40, sample: 'Zwei Aussagen' },
    body: [
      {
        x: 1.9,
        y: 5.7,
        w: 10.8,
        h: 8.6,
        size: 19,
        sample: [
          'Sie war den Abend zu Hause',
          'Das Licht brannte bis zwei',
          'Niemand hat sie gesehen',
        ],
      },
      {
        x: 15.5,
        y: 5.7,
        w: 10.8,
        h: 8.6,
        size: 19,
        sample: ['Er fuhr gegen zehn los', 'Der Wagen stand am Hafen', 'Der Tank war leer'],
      },
    ],
  },
  {
    // The number stands in the lamp's pool; what it means in italics beside it.
    name: 'Kennzahl',
    bg: black,
    shapes: [still(lampLight, 180), rule(17.6, 6.15, 3.4, brass, 0.05)],
    title: {
      x: 1.6,
      y: 2.6,
      w: 15,
      h: 10.4,
      valign: 'middle',
      align: 'center',
      size: 230,
      sample: '48',
    },
    body: {
      x: 17.6,
      y: 6.7,
      w: 8.6,
      h: 5.6,
      font: 'Instrument Serif',
      italic: true,
      size: 30,
      lineHeight: 112,
      color: cream,
      sample: 'Stunden bleiben, bevor die Spur kalt wird.',
    },
  },
  {
    // Blinds across the whole wall, faint; the quote in the middle of the room.
    name: 'Zitat',
    bg: black,
    shapes: [
      still(wideLight),
      {
        t: 'text',
        x: 11.5,
        y: 0.9,
        w: 5,
        h: 3.4,
        text: '“',
        font: 'Instrument Serif',
        size: 130,
        color: brass,
        align: 'center',
        valign: 'top',
      },
      rule(12.3, 11.55, 3.4, brass, 0.05),
    ],
    body: {
      x: 3.6,
      y: 4.1,
      w: 20.8,
      h: 6.9,
      valign: 'middle',
      align: 'center',
      font: 'Instrument Serif',
      italic: true,
      size: 42,
      lineHeight: 110,
      color: cream,
      sample: 'Die Wahrheit kommt selten bei Tageslicht.',
    },
    subtitle: {
      x: 6,
      y: 12,
      w: 16,
      h: 1.4,
      valign: 'middle',
      align: 'center',
      sample: 'Vera Lindt, Ermittlerin',
    },
  },
  {
    // The picture in the wide format of the cinema, its caption beneath.
    name: 'Bild',
    bg: '#070708',
    shapes: [rule(1.9, 13.95, 3.4, brass, 0.05, false)],
    pictures: [{ x: 0, y: 1.1, w: 28, h: 11.2 }],
    title: {
      x: 6.2,
      y: 12.8,
      w: 20,
      h: 2.3,
      valign: 'middle',
      align: 'right',
      italic: true,
      size: 32,
      sample: 'Hafenstraße, kurz nach Mitternacht',
    },
  },
  {
    // The end card: the word in the middle, rules either side of the last line.
    name: 'Schluss',
    bg: black,
    shapes: [
      still(wideLight, 180),
      shade(0.35),
      rule(5.4, 11.25, 4.2, brass, 0.05),
      rule(18.4, 11.25, 4.2, brass, 0.05),
    ],
    title: {
      x: 4,
      y: 3.6,
      w: 20,
      h: 6.6,
      valign: 'middle',
      align: 'center',
      size: 120,
      sample: 'Ende',
    },
    subtitle: {
      x: 9.9,
      y: 10.55,
      w: 8.2,
      h: 1.4,
      valign: 'middle',
      align: 'center',
      sample: 'Fragen offen?',
    },
  },
];

const template: Template = {
  slug: 'noir',
  name: 'Noir',
  group: 'Schwarzweiß',
  tags: ['Schwarzweiß', 'dunkel', 'Film', 'Kino', 'elegant', 'Serif', 'Korn', 'Krimi', 'ruhig'],
  description:
    'Film noir: tiefes Schwarz mit Korn, Licht, das durch Jalousien fällt, und eine elegante Serifenschrift in gebrochenem Weiß.',
  palette: {
    bg: black,
    text: cream,
    bg2: '#1b1b1d',
    text2: dim,
    accents: ['#2c2c2f', '#4a4a4d', '#6f6d68', '#c9c3b5', brass, '#8c3b34'],
  },
  fonts: { head: 'Instrument Serif', body: 'Inter' },
  text: {
    title: { font: 'Instrument Serif', size: 54, color: cream, lineHeight: 100 },
    subtitle: { font: 'Inter', size: 15, color: dim, upper: true, spacing: 3 },
    body: { font: 'Inter', size: 21, color: '#d9d3c5', lineHeight: 128, paraSpace: 0.4 },
  },
  layouts,
  samplePictures: [street(3), street(8)],
};

export default template;
