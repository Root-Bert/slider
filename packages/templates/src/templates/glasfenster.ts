import { jpeg, noise, paint, PX, rgb, rng, type Paint, type Rng } from '../art';
import type { Color, Layout, Picture, Shape, Template } from '../model';
import { page, polygon, ring } from '../shapes';

/*
 * Glasfenster: leaded glass – irregular cells in jewel tones, each brighter towards its middle,
 * held by dark lead; a rose window, three lancets, friezes. The page itself is the dark of the
 * nave, so text always stands on calm ground.
 */

const night = '#14121c';
const lead = '#0a090e';
const cream = '#f6eeda';
const gold = '#e2b24c';
const ruby = '#c4183b';
const sapphire = '#1e50c8';
const emerald = '#12986a';
const amber = '#f2a51d';
const amethyst = '#7b36b2';
const turquoise = '#17a8bd';

interface Site {
  /** Centimetres in the picture. */
  x: number;
  y: number;
  color: Color;
}

/** A pane's colour, a little lighter or darker than its neighbours of the same glass. */
const tint = (color: Color, random: Rng): Color => {
  const [r, g, b] = rgb(color);
  const t = random.range(-0.28, 0.2);
  const to = t > 0 ? 255 : 0;
  const k = Math.abs(t);
  const part = (v: number) =>
    Math.round(v + (to - v) * k)
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
};

/**
 * Leaded glass: every pixel belongs to the nearest site (its pane); near the border to the next
 * pane runs the lead, and the glass glows towards the pane's middle, streaked as poured glass is.
 */
function glass(
  size: { w: number; h: number },
  sites: readonly Site[],
  options: { px?: number; lead?: number; seed?: number; light?: (u: number, v: number) => number },
): Paint {
  const surface = paint(size, options.px ?? PX);
  const { ctx, w, h, px } = surface;
  const count = sites.length;
  const xs = Float32Array.from(sites, (site) => site.x * px);
  const ys = Float32Array.from(sites, (site) => site.y * px);
  const colors = sites.map((site) => rgb(site.color));
  const field = noise(options.seed ?? 5);
  const half = ((options.lead ?? 0.13) * px) / 2;
  const glow = 0.5 * px;
  const [lr, lg, lb] = rgb(lead);
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let [first, second, d1, d2] = [0, 0, Infinity, Infinity];
      for (let i = 0; i < count; i += 1) {
        const [dx, dy] = [xs[i]! - x, ys[i]! - y];
        const d = dx * dx + dy * dy;
        if (d < d1) {
          [second, d2] = [first, d1];
          [first, d1] = [i, d];
        } else if (d < d2) {
          [second, d2] = [i, d];
        }
      }
      const between = Math.hypot(xs[first]! - xs[second]!, ys[first]! - ys[second]!) || 1;
      const edge = (d2 - d1) / (2 * between) - half;
      const cover = Math.min(1, Math.max(0, edge / 1.3));
      const t = Math.min(1, Math.max(0, edge / glow));
      const streak =
        (field(x / 34, y / 260, 2) - 0.5) * 0.34 + (field(x / 7, y / 7, 1) - 0.5) * 0.1;
      const bright = (0.56 + 0.56 * t * (2 - t) + streak) * (options.light?.(x / w, y / h) ?? 1);
      const [r, g, b] = colors[first]!;
      const shade = (v: number) =>
        bright <= 1 ? v * bright : v + (255 - v) * Math.min(1, (bright - 1) * 0.9);
      const i = (y * w + x) * 4;
      image.data[i] = lr + (shade(r) - lr) * cover;
      image.data[i + 1] = lg + (shade(g) - lg) * cover;
      image.data[i + 2] = lb + (shade(b) - lb) * cover;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return surface;
}

/** Sites on a shaken grid: panes of about `cell` centimetres, none like the next. */
function scatter(
  size: { w: number; h: number },
  cell: number,
  random: Rng,
  colorAt: (u: number, v: number, random: Rng) => Color,
): Site[] {
  const [across, down] = [Math.ceil(size.w / cell) + 2, Math.ceil(size.h / cell) + 2];
  const sites: Site[] = [];
  for (let row = -1; row < down - 1; row += 1) {
    for (let column = -1; column < across - 1; column += 1) {
      const x = (column + 0.5 + random.range(-0.42, 0.42)) * cell;
      const y = (row + 0.5 + random.range(-0.42, 0.42)) * cell;
      sites.push({ x, y, color: tint(colorAt(x / size.w, y / size.h, random), random) });
    }
  }
  return sites;
}

// The great window: a whole page of glass, warm where the light comes in, cool at the rim.
function windowPicture(): Picture {
  const random = rng(41);
  const field = noise(17);
  const warm = [amber, ruby, amber, '#e8641c'];
  const cool = [sapphire, amethyst, turquoise, emerald, sapphire];
  const sites = scatter(page, 1.75, random, (u, v, r) => {
    const heat = 1.05 - Math.hypot(u - 0.74, (v - 0.42) * 0.9) * 2.1 + (field(u * 5, v * 3) - 0.5);
    if (r() < 0.12) return r.pick([...warm, ...cool]);
    return heat > 0.5 ? r.pick(warm) : r.pick(cool);
  });
  const surface = glass(page, sites, {
    seed: 3,
    lead: 0.15,
    light: (u, v) => 1.12 - Math.hypot(u - 0.74, v - 0.42) * 0.42,
  });
  return jpeg(surface, 78);
}

const ROSE = 19;
/** How far the rose's dark middle reaches, of its radius. */
const HUB = 0.43;

// The rose window: rings of panes round a dark middle, on the page's dark.
function rosePicture(): Picture {
  const random = rng(8);
  const size = { w: ROSE, h: ROSE };
  const centre = ROSE / 2;
  const radius = centre - 0.12;
  const rings: { r: number; n: number; off: number; colors: Color[] }[] = [
    { r: 0.29, n: 12, off: 0, colors: [night] },
    { r: 0.52, n: 12, off: 0.5, colors: [amber, ruby] },
    { r: 0.71, n: 24, off: 0, colors: [turquoise, sapphire, emerald, sapphire] },
    { r: 0.905, n: 24, off: 0.5, colors: [amethyst, ruby, sapphire, amber, amethyst, sapphire] },
    { r: 1.12, n: 24, off: 0, colors: [night] },
  ];
  const sites: Site[] = [];
  for (const each of rings) {
    for (let i = 0; i < each.n; i += 1) {
      const angle = ((i + each.off + random.range(-0.13, 0.13)) / each.n) * Math.PI * 2;
      const r = (each.r + random.range(-0.012, 0.012)) * radius;
      sites.push({
        x: centre + Math.cos(angle) * r,
        y: centre + Math.sin(angle) * r,
        color: tint(each.colors[i % each.colors.length]!, random),
      });
    }
  }
  const surface = glass(size, sites, { px: 62, seed: 9, lead: 0.17 });
  const { ctx, w, h, px } = surface;
  const [c, r] = [centre * px, radius * px];
  ctx.fillStyle = night;
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill('evenodd');
  ctx.beginPath();
  ctx.arc(c, c, r * HUB, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = lead;
  ctx.lineWidth = 0.2 * px;
  for (const at of [1, HUB]) {
    ctx.beginPath();
    ctx.arc(c, c, r * at - 0.05 * px, 0, Math.PI * 2);
    ctx.stroke();
  }
  return jpeg(surface, 80);
}

const LANCETS = { w: 11.4, h: 15.75 };

// Three lancets, the middle one taller: cool, warm, cool.
function lancetPicture(): Picture {
  const random = rng(23);
  const windows = [
    { x: 0.3, spring: 5.5, colors: [sapphire, turquoise, sapphire, emerald, amethyst] },
    { x: 4.1, spring: 4.1, colors: [ruby, amber, ruby, '#e8641c', amber, amethyst] },
    { x: 7.9, spring: 5.5, colors: [amethyst, sapphire, turquoise, sapphire, ruby] },
  ];
  const width = 3.2;
  const bottom = 14.3;
  const sites = scatter(LANCETS, 1.02, random, (u, _v, r) => {
    const x = u * LANCETS.w;
    const at = windows.find((each) => x < each.x + width + 0.3) ?? windows[2]!;
    return r.pick(at.colors);
  });
  const surface = glass(LANCETS, sites, {
    seed: 12,
    lead: 0.13,
    light: (_u, v) => 1.16 - v * 0.34,
  });
  const { ctx, w, h, px } = surface;
  const arches = () => {
    for (const each of windows) {
      const [x0, x1, ys] = [each.x * px, (each.x + width) * px, each.spring * px];
      ctx.moveTo(x0, bottom * px);
      ctx.lineTo(x0, ys);
      ctx.arc(x1, ys, width * px, Math.PI, (Math.PI * 4) / 3);
      ctx.arc(x0, ys, width * px, (Math.PI * 5) / 3, Math.PI * 2);
      ctx.lineTo(x1, bottom * px);
      ctx.closePath();
    }
  };
  ctx.fillStyle = night;
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  arches();
  ctx.fill('evenodd');
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = lead;
  ctx.lineWidth = 0.26 * px;
  ctx.beginPath();
  arches();
  ctx.stroke();
  ctx.strokeStyle = gold;
  ctx.lineWidth = 0.05 * px;
  ctx.beginPath();
  arches();
  ctx.stroke();
  return jpeg(surface, 80);
}

/** A band of small panes, as round the edge of a window. */
function bandPicture(size: { w: number; h: number }, seed: number): Picture {
  const random = rng(seed);
  const all = [ruby, sapphire, amber, emerald, amethyst, turquoise, sapphire, ruby];
  const sites = scatter(size, 0.78, random, (_u, _v, r) => r.pick(all));
  return jpeg(glass(size, sites, { seed, lead: 0.11 }), 80);
}

const great = windowPicture();
const rose = rosePicture();
const lancets = lancetPicture();
const upright = { w: 1.5, h: 15.75 };
const frieze = { w: 28, h: 1.25 };
const uprightBand = bandPicture(upright, 31);
const friezeBand = bandPicture(frieze, 37);

/** The rose with its middle at a place, `radius` large. */
const roseAt = (cx: number, cy: number, radius: number): Shape => {
  const side = (radius / (ROSE / 2 - 0.12)) * ROSE;
  return { t: 'image', x: cx - side / 2, y: cy - side / 2, w: side, h: side, src: rose };
};

const leadLine = { color: lead, width: 0.22, join: 'miter' } as const;
const goldLine = { color: gold, width: 0.04 } as const;

/** A single pane set on its point, in its lead. */
const jewel = (cx: number, cy: number, r: number, fill: Color): Shape[] => [
  polygon(
    cx,
    cy,
    r,
    4,
    {
      t: 'linear',
      angle: 135,
      stops: [
        [0, fill],
        [1, mixed(fill)],
      ],
    } as const,
    {
      stroke: { color: lead, width: 0.09, join: 'miter' },
    },
  ),
];

function mixed(color: Color): Color {
  const [r, g, b] = rgb(color);
  const part = (v: number) =>
    Math.round(v + (255 - v) * 0.42)
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

const goldRule = (x: number, y: number, length: number): Shape[] => [
  { t: 'line', x1: x, y1: y, x2: x + length, y2: y, stroke: { color: gold, width: 0.06 } },
  ...jewel(x + length + 0.32, y, 0.2, gold),
];

const octagon = (x: number, y: number, w: number, h: number, cut: number) =>
  [
    [x + cut, y],
    [x + w - cut, y],
    [x + w, y + cut],
    [x + w, y + h - cut],
    [x + w - cut, y + h],
    [x + cut, y + h],
    [x, y + h - cut],
    [x, y + cut],
  ] as const;

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: night,
    shapes: [
      { t: 'image', ...page, src: great },
      {
        t: 'poly',
        fill: night,
        stroke: { color: lead, width: 0.34, join: 'miter' },
        pts: [
          [-1, -1],
          [14.6, -1],
          [17.6, 7.875],
          [14.6, 16.75],
          [-1, 16.75],
        ],
      },
      {
        t: 'poly',
        fill: null,
        stroke: goldLine,
        pts: [
          [-1, -1],
          [14.05, -1],
          [17.05, 7.875],
          [14.05, 16.75],
          [-1, 16.75],
        ],
      },
      ...goldRule(1.85, 4.1, 3.2),
    ],
    title: {
      x: 1.8,
      y: 4.7,
      w: 13,
      h: 5.2,
      valign: 'middle',
      sample: 'Licht\nund Farbe',
    },
    subtitle: {
      x: 1.8,
      y: 10.3,
      w: 12.2,
      h: 1.8,
      sample: 'Ein Vortrag in leuchtenden Tönen',
    },
  },
  {
    name: 'Abschnitt',
    bg: night,
    shapes: [{ t: 'image', x: 15.2, y: 0, ...LANCETS, src: lancets }, ...goldRule(1.85, 5.3, 3.2)],
    title: {
      x: 1.8,
      y: 5.9,
      w: 12.8,
      h: 3.6,
      valign: 'middle',
      size: 40,
      sample: 'Das Handwerk',
    },
    subtitle: { x: 1.8, y: 9.8, w: 12.6, h: 1.8, sample: 'Vom Entwurf zum fertigen Feld' },
  },
  {
    name: 'Inhalt',
    bg: night,
    shapes: [roseAt(28, 0, 6), ...goldRule(1.85, 3.55, 3.2)],
    title: {
      x: 1.8,
      y: 1.2,
      w: 19.4,
      h: 2.1,
      valign: 'middle',
      size: 30,
      sample: 'Wie ein Fenster entsteht',
    },
    body: {
      x: 1.8,
      y: 4.3,
      w: 21.4,
      h: 10,
      sample: [
        'Der Entwurf legt Linien und Farben fest',
        'Jede Scheibe wird einzeln zugeschnitten',
        'Bleiruten fassen die Stücke zu Feldern',
        'Lot verbindet die Ruten an jedem Knoten',
        'Erst im Gegenlicht zeigt sich das Bild',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: night,
    shapes: [
      { t: 'image', x: 14.9, y: 0, ...upright, src: uprightBand },
      { t: 'line', x1: 14.9, y1: -0.5, x2: 14.9, y2: 16.25, stroke: leadLine },
      { t: 'line', x1: 16.4, y1: -0.5, x2: 16.4, y2: 16.25, stroke: leadLine },
      { t: 'line', x1: 14.62, y1: -0.5, x2: 14.62, y2: 16.25, stroke: goldLine },
      ...goldRule(1.85, 4.25, 3.2),
    ],
    title: {
      x: 1.8,
      y: 1.2,
      w: 12.2,
      h: 2.8,
      valign: 'bottom',
      size: 28,
      sample: 'Farbe braucht\nGegenlicht',
    },
    body: {
      x: 1.8,
      y: 4.9,
      w: 12.2,
      h: 9.6,
      size: 18,
      sample: [
        'Morgens leuchten die kühlen Töne',
        'Mittags trägt das Gelb den Raum',
        'Abends glüht das Rot am längsten',
      ],
    },
    pictures: [{ x: 16.5, y: 0, w: 11.5, h: 15.75 }],
  },
  {
    name: 'Zwei Spalten',
    bg: night,
    shapes: [
      { t: 'image', x: 0, y: 0, ...frieze, src: friezeBand },
      { t: 'line', x1: -0.5, y1: 1.25, x2: 28.5, y2: 1.25, stroke: leadLine },
      { t: 'line', x1: -0.5, y1: 1.55, x2: 28.5, y2: 1.55, stroke: goldLine },
      { t: 'line', x1: 14, y1: 5.2, x2: 14, y2: 8.75, stroke: goldLine },
      { t: 'line', x1: 14, y1: 10.65, x2: 14, y2: 14.2, stroke: goldLine },
      ...jewel(14, 9.7, 0.62, ruby),
      ...jewel(14, 8.75, 0.2, gold),
      ...jewel(14, 10.65, 0.2, gold),
    ],
    title: {
      x: 1.8,
      y: 2.3,
      w: 24.4,
      h: 2.1,
      valign: 'middle',
      size: 30,
      sample: 'Zwei Wege zum Glas',
    },
    body: [
      {
        x: 1.8,
        y: 5.1,
        w: 11.2,
        h: 9.3,
        size: 18,
        sample: [
          'Bleiverglasung: Ruten fassen jede Scheibe',
          'Hält über Jahrhunderte',
          'Linien gehören zum Bild',
        ],
      },
      {
        x: 15,
        y: 5.1,
        w: 11.2,
        h: 9.3,
        size: 18,
        sample: [
          'Mosaik: kleine Stücke im Mörtelbett',
          'Trägt auch auf Wand und Boden',
          'Fugen setzen den Takt',
        ],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: night,
    shapes: [
      roseAt(7.7, 7.875, 9.4),
      ring(7.7, 7.875, 3.62, { color: gold, width: 0.05 }),
      ...goldRule(18.75, 5.3, 3.2),
    ],
    title: {
      x: 4.2,
      y: 5.4,
      w: 7,
      h: 5,
      align: 'center',
      valign: 'middle',
      size: 66,
      color: gold,
      sample: '480',
    },
    body: {
      x: 18.7,
      y: 5.8,
      w: 8,
      h: 6,
      size: 22,
      sample: 'Scheiben fasst die große Rose.\nKeine gleicht der anderen.',
    },
  },
  {
    name: 'Zitat',
    bg: night,
    shapes: [
      { t: 'image', ...page, src: great },
      {
        t: 'poly',
        fill: night,
        stroke: { color: lead, width: 0.34, join: 'miter' },
        pts: octagon(2.5, 1.8, 23, 12.15, 1.7),
      },
      { t: 'poly', fill: null, stroke: goldLine, pts: octagon(2.95, 2.25, 22.1, 11.25, 1.52) },
      ...jewel(14, 3.55, 0.34, gold),
      { t: 'line', x1: 11.4, y1: 3.55, x2: 13.3, y2: 3.55, stroke: goldLine },
      { t: 'line', x1: 14.7, y1: 3.55, x2: 16.6, y2: 3.55, stroke: goldLine },
    ],
    body: {
      x: 5.2,
      y: 4.3,
      w: 17.6,
      h: 5.8,
      align: 'center',
      valign: 'middle',
      font: 'Cinzel',
      size: 28,
      lineHeight: 128,
      sample: 'Farbe ist Licht, das sich entschieden hat.',
    },
    subtitle: {
      x: 5.2,
      y: 10.5,
      w: 17.6,
      h: 1.6,
      align: 'center',
      valign: 'middle',
      sample: 'Aus einem Werkstattbuch',
    },
  },
  {
    name: 'Bild',
    bg: night,
    shapes: [
      { t: 'rect', x: 1.25, y: 1.05, w: 25.5, h: 11.1, fill: lead, stroke: goldLine },
      ...jewel(1.25, 1.05, 0.5, ruby),
      ...jewel(26.75, 1.05, 0.5, sapphire),
      ...jewel(1.25, 12.15, 0.5, emerald),
      ...jewel(26.75, 12.15, 0.5, amber),
      ...[amethyst, turquoise, amber, ruby, sapphire].flatMap((color, index) =>
        jewel(21.6 + index * 1.15, 13.75, 0.46, color),
      ),
    ],
    pictures: [{ x: 1.6, y: 1.4, w: 24.8, h: 10.4 }],
    title: {
      x: 1.6,
      y: 12.75,
      w: 18.6,
      h: 2,
      valign: 'middle',
      size: 26,
      sample: 'Das Nordfenster am Morgen',
    },
  },
  {
    name: 'Schluss',
    bg: night,
    shapes: [
      roseAt(14, 15.75, 8.6),
      ring(14, 15.75, 3.3, { color: gold, width: 0.05 }),
      ...jewel(14, 13.9, 0.42, gold),
    ],
    title: {
      x: 4,
      y: 1.3,
      w: 20,
      h: 3.2,
      align: 'center',
      valign: 'middle',
      size: 52,
      sample: 'Danke',
    },
    subtitle: {
      x: 5,
      y: 4.6,
      w: 18,
      h: 1.6,
      align: 'center',
      valign: 'middle',
      sample: 'Fragen sind willkommen',
    },
  },
];

const template: Template = {
  slug: 'glasfenster',
  name: 'Glasfenster',
  group: 'Farbenfroh',
  tags: ['Glasfenster', 'Mosaik', 'Bleiglas', 'Juwelentöne', 'dunkel', 'feierlich', 'Kultur'],
  description:
    'Bleiglas im Gegenlicht: unregelmäßige Scheiben in Juwelentönen, dunkle Ruten und ruhige Flächen für den Text.',
  palette: {
    bg: night,
    text: cream,
    bg2: '#262136',
    text2: '#cfc4a8',
    accents: [ruby, sapphire, amber, emerald, amethyst, turquoise],
  },
  fonts: { head: 'Cinzel', body: 'Lato' },
  text: {
    title: { font: 'Cinzel', size: 44, color: cream, bold: true, lineHeight: 110 },
    subtitle: { font: 'Lato', size: 20, color: gold, italic: true },
    body: { font: 'Lato', size: 20, color: cream, lineHeight: 125, paraSpace: 0.32 },
  },
  layouts,
};

export default template;
