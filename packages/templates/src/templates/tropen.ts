import { rng } from '../art';
import type { Color, Layout, Shape, Template } from '../model';
import { disc, page } from '../shapes';

/*
 * Tropen: a jungle that grows into the page – monstera, palm fronds, fan palms and banana leaves
 * as flat silhouettes bleeding from the edges, hibiscus blossoms between them. Hot pink,
 * turquoise and sunny yellow on deep green or cream. Every leaf is drawn here by rule.
 */

const jungle = '#0b3326';
const forest = '#14523d';
const fern = '#1b6e4b';
const leaf = '#2a9d55';
const lime = '#8cc63f';
const turquoise = '#13b8a8';
const lagoon = '#0e8f86';
const pink = '#f0277a';
const rose = '#b3124f';
const yellow = '#ffc62b';
const orange = '#ff7b3a';
const cream = '#fbf3e0';
const sand = '#f3e2bd';

type Pt = readonly [number, number];
type Cmd = readonly [string, ...Pt[]];

/** Where a plant grows: its foot, how long it is, where it points (0 = up, clockwise). */
interface Place {
  x: number;
  y: number;
  size: number;
  rot?: number;
  flip?: boolean;
}

/** A drawing in plant coordinates (foot at 0/0, growing to 0/−1) as a path on the page. */
function pathD(cmds: readonly Cmd[], place: Place): string {
  const angle = ((place.rot ?? 0) * Math.PI) / 180;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const at = ([px, py]: Pt) => {
    const x = (place.flip ? -px : px) * place.size;
    const y = py * place.size;
    return `${Math.round((place.x + x * cos - y * sin) * 100)} ${Math.round((place.y + x * sin + y * cos) * 100)}`;
  };
  return cmds.map(([c, ...pts]) => `${c}${pts.map(at).join(' ')}`).join(' ');
}

const filled = (cmds: readonly Cmd[], place: Place, fill: Color): Shape => ({
  t: 'path',
  ...page,
  vb: [2800, 1575],
  d: pathD(cmds, place),
  fill,
});

const lined = (cmds: readonly Cmd[], place: Place, color: Color, width: number): Shape => ({
  t: 'path',
  ...page,
  vb: [2800, 1575],
  d: pathD(cmds, place),
  fill: null,
  stroke: { color, width, cap: 'round', join: 'round' },
});

/** A monstera leaf: a heart with slits to the rim and holes near the rib. */
function monstera(place: Place, fill: Color, vein: Color, seed = 1): Shape[] {
  const random = rng(seed);
  const side = () =>
    [0.5, 0.9, 1.3, 1.7, 2.1, 2.48].map((a, index) => ({
      a: a + random.range(-0.05, 0.05),
      depth: random.range(0.5, 0.66),
      hole: index > 0 && index < 5 && random() < 0.34,
    }));
  const [right, left] = [side(), side()];
  const radius = (theta: number) => {
    const a = Math.abs(theta);
    let r =
      0.5 *
      (0.88 + 0.12 * Math.cos(a)) *
      (1 + 0.16 * Math.exp(-((a / 0.22) ** 2))) *
      (1 - 0.5 * Math.exp(-(((Math.PI - a) / 0.25) ** 2)));
    for (const slit of theta >= 0 ? right : left) {
      if (slit.hole) continue;
      const u = Math.abs(a - slit.a) / 0.052;
      if (u < 1)
        r *= 1 - slit.depth * (u < 0.5 ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (u - 0.5)) / 0.5));
    }
    return r;
  };
  const point = (theta: number, r: number): Pt => [r * Math.sin(theta), -0.5 - r * Math.cos(theta)];
  const cmds: Cmd[] = [];
  const steps = 640;
  for (let i = 0; i < steps; i += 1) {
    const theta = -Math.PI + (i / steps) * Math.PI * 2;
    cmds.push([i === 0 ? 'M' : 'L', point(theta, radius(theta))]);
  }
  cmds.push(['Z']);
  // Holes, wound the other way.
  for (const [sign, slits] of [
    [1, right],
    [-1, left],
  ] as const) {
    for (const slit of slits) {
      if (!slit.hole) continue;
      const theta = sign * slit.a;
      for (let k = 0; k < 14; k += 1) {
        const phi = (-k / 14) * Math.PI * 2;
        const along = 0.27 + 0.075 * Math.cos(phi);
        const across = (0.026 * Math.sin(phi)) / along;
        cmds.push([k === 0 ? 'M' : 'L', point(theta + sign * across, along)]);
      }
      cmds.push(['Z']);
    }
  }
  const veins: Cmd[] = [
    ['M', [0, -0.34]],
    ['L', [0, -1.02]],
  ];
  for (const [sign, slits] of [
    [1, right],
    [-1, left],
  ] as const) {
    const edges = [0.12, ...slits.map((slit) => slit.a), 2.85];
    for (let i = 0; i + 1 < edges.length; i += 1) {
      const mid = sign * ((edges[i]! + edges[i + 1]!) / 2);
      const from: Pt = [0, -0.5 - 0.1 * Math.cos(mid)];
      veins.push(['M', from], ['Q', point(mid * 0.9, 0.2), point(mid, radius(mid) * 0.8)]);
    }
  }
  const stem: Cmd[] = [
    ['M', [0, -0.34]],
    ['Q', [0.02, 0], [-0.04, 0.5]],
  ];
  return [
    lined(stem, place, fill, place.size * 0.028),
    filled(cmds, place, fill),
    lined(veins, place, vein, Math.max(0.03, place.size * 0.007)),
  ];
}

/** A palm frond: a bent rib with slender leaflets on both sides. */
function palm(
  place: Place,
  fill: Color,
  options: { count?: number; bend?: number; reach?: number } = {},
): Shape {
  const count = options.count ?? 17;
  const bend = options.bend ?? 0.28;
  const reach = options.reach ?? 0.4;
  const rib = (t: number): Pt => [bend * t * t, -t];
  const tangent = (t: number): Pt => {
    const length = Math.hypot(2 * bend * t, 1);
    return [(2 * bend * t) / length, -1 / length];
  };
  const turn = ([x, y]: Pt, degrees: number): Pt => {
    const a = (degrees * Math.PI) / 180;
    return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  };
  const add = (a: Pt, b: Pt, scale = 1): Pt => [a[0] + b[0] * scale, a[1] + b[1] * scale];
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const half = (0.85 / (count - 1)) * 0.4;
  const thick = 0.007;
  const leaflet = (index: number, sign: 1 | -1) => {
    const t = 0.1 + (0.85 * index) / (count - 1);
    const along = tangent(t);
    const length = reach * (0.42 + 0.58 * Math.sin(Math.PI * Math.min(1, t * 0.82 + 0.16)) ** 0.8);
    const direction = turn(along, sign * (66 - 34 * t));
    const normal = turn(along, sign * 90);
    const low = add(rib(t - half), tangent(t - half) && normal, thick);
    const high = add(rib(t + half), normal, thick);
    const tip = add(add(rib(t), direction, length), along, -length * 0.16);
    const lowControl = add(mid(low, tip), along, length * 0.02);
    const highControl = add(mid(high, tip), along, length * 0.2);
    return { low, high, tip, lowControl, highControl };
  };
  const cmds: Cmd[] = [['M', add(rib(-0.2), [1, 0], thick)]];
  for (let i = 0; i < count; i += 1) {
    const part = leaflet(i, 1);
    cmds.push(
      ['L', part.low],
      ['Q', part.lowControl, part.tip],
      ['Q', part.highControl, part.high],
    );
  }
  const end = add(rib(0.95), tangent(0.95), reach * 0.42);
  cmds.push(['Q', add(rib(0.98), [0.02, 0]), end]);
  cmds.push(['Q', add(rib(0.98), [-0.02, 0]), leaflet(count - 1, -1).high]);
  for (let i = count - 1; i >= 0; i -= 1) {
    const part = leaflet(i, -1);
    if (i < count - 1) cmds.push(['L', part.high]);
    cmds.push(['Q', part.highControl, part.tip], ['Q', part.lowControl, part.low]);
  }
  cmds.push(['L', add(rib(-0.2), [-1, 0], thick)], ['Z']);
  return filled(cmds, place, fill);
}

/** A fan palm: pointed fingers spread round the end of its stalk. */
function fan(place: Place, fill: Color, count = 13, spread = 108): Shape {
  const polar = (degrees: number, r: number): Pt => {
    const a = (degrees * Math.PI) / 180;
    return [r * Math.sin(a), -0.32 - r * Math.cos(a)];
  };
  const step = (spread * 2) / (count - 1);
  const cmds: Cmd[] = [
    ['M', [-0.014, 0.3]],
    ['L', [-0.014, -0.3]],
  ];
  for (let i = 0; i < count; i += 1) {
    const a = -spread + i * step;
    const outer = 0.68 * (0.72 + 0.28 * Math.cos((a * Math.PI) / 180) ** 2);
    cmds.push(
      ['L', polar(a - step * 0.4, 0.14)],
      ['Q', polar(a - step * 0.52, outer * 0.6), polar(a, outer)],
      ['Q', polar(a + step * 0.52, outer * 0.6), polar(a + step * 0.4, 0.14)],
    );
  }
  cmds.push(['L', [0.014, -0.3]], ['L', [0.014, 0.3]], ['Z']);
  return filled(cmds, place, fill);
}

/** A banana leaf: a long blade, torn at the rim here and there, with its rib. */
function banana(place: Place, fill: Color, vein: Color, seed = 1, bend = 0.18): Shape[] {
  const random = rng(seed);
  const tears = Array.from({ length: 5 }, () => ({
    s: random.range(0.2, 0.85),
    sign: random() < 0.5 ? 1 : -1,
  }));
  const steps = 150;
  const edge = (sign: 1 | -1) =>
    Array.from({ length: steps + 1 }, (_, index): Pt => {
      const s = index / steps;
      let width = 0.17 * Math.sin(Math.PI * s ** 0.85) ** 0.75;
      for (const tear of tears) {
        const u = Math.abs(s - tear.s) / 0.013;
        if (tear.sign === sign && u < 1) width *= 0.45 + 0.55 * u;
      }
      const slope = 2 * bend * s;
      const length = Math.hypot(slope, 1);
      return [bend * s * s + (sign * width) / length, -s + (sign * width * slope) / length];
    });
  const cmds: Cmd[] = [
    ...edge(1).map((pt, index): Cmd => [index === 0 ? 'M' : 'L', pt]),
    ...edge(-1)
      .reverse()
      .map((pt): Cmd => ['L', pt]),
    ['Z'],
  ];
  const rib: Cmd[] = [
    ['M', [0, 0.25]],
    ['Q', [0, -0.5], [bend * 0.92, -0.96]],
  ];
  return [filled(cmds, place, fill), lined(rib, place, vein, Math.max(0.04, place.size * 0.012))];
}

/** A hibiscus blossom: five ruffled petals, a deep throat, the long stamen. */
function hibiscus(
  cx: number,
  cy: number,
  r: number,
  turnBy = 0,
  petal: Color = pink,
  throat: Color = rose,
  stamen: Color = yellow,
): Shape[] {
  const place: Place = { x: cx, y: cy, size: r, rot: turnBy };
  const outline = (scale: number, ruffle: number): Cmd[] => {
    const cmds: Cmd[] = [];
    for (let i = 0; i < 220; i += 1) {
      const theta = (i / 220) * Math.PI * 2;
      const radius =
        scale *
        (0.5 + 0.5 * Math.abs(Math.cos(2.5 * theta)) ** 0.5) *
        (1 + ruffle * Math.sin(25 * theta + 1));
      cmds.push([i === 0 ? 'M' : 'L', [radius * Math.sin(theta), -radius * Math.cos(theta)]]);
    }
    cmds.push(['Z']);
    return cmds;
  };
  const veins: Cmd[] = [];
  for (let p = 0; p < 5; p += 1) {
    for (const offset of [-0.2, 0, 0.2]) {
      const theta = (p * 2 * Math.PI) / 5 + offset;
      const [from, to] = [0.34, offset === 0 ? 0.8 : 0.68];
      veins.push(
        ['M', [from * Math.sin(theta), -from * Math.cos(theta)]],
        ['L', [to * Math.sin(theta), -to * Math.cos(theta)]],
      );
    }
  }
  const angle = ((turnBy + 36) * Math.PI) / 180;
  const tip: Pt = [cx + Math.sin(angle) * r * 0.86, cy - Math.cos(angle) * r * 0.86];
  const shapes: Shape[] = [
    filled(outline(1, 0.03), place, petal),
    lined(veins, place, throat, Math.max(0.025, r * 0.014)),
    filled(outline(0.36, 0), place, throat),
    {
      t: 'line',
      x1: cx,
      y1: cy,
      x2: tip[0],
      y2: tip[1],
      stroke: { color: stamen, width: r * 0.075, cap: 'round' },
    },
  ];
  for (const [along, across] of [
    [0, 0],
    [-0.13, 0.11],
    [-0.13, -0.11],
    [-0.27, 0.09],
    [-0.27, -0.09],
  ] as const) {
    shapes.push(
      disc(
        tip[0] + (Math.sin(angle) * along + Math.cos(angle) * across) * r,
        tip[1] + (-Math.cos(angle) * along + Math.sin(angle) * across) * r,
        r * 0.075,
        stamen,
      ),
    );
  }
  return shapes;
}

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: jungle,
    shapes: [
      palm({ x: 30, y: 7.5, size: 14, rot: -72 }, forest, { count: 19 }),
      palm({ x: 24, y: -3, size: 12, rot: 196, flip: true }, forest),
      ...banana({ x: 18.2, y: 18, size: 11, rot: -14 }, fern, forest, 4),
      fan({ x: 27.6, y: 3.6, size: 8.5, rot: -52 }, lagoon, 13),
      ...monstera({ x: 23.6, y: 17.6, size: 11.5, rot: -10 }, leaf, jungle, 3),
      palm({ x: 29, y: 17.5, size: 9, rot: -50 }, turquoise, { count: 13, reach: 0.44 }),
      ...monstera({ x: 28.6, y: 9.2, size: 6.4, rot: -58 }, lime, fern, 8),
      ...hibiscus(18.9, 12.3, 2.3, 12),
      ...hibiscus(23.9, 6.6, 1.5, -30, orange, '#c4411a'),
      palm({ x: -1.5, y: 18.2, size: 8.5, rot: 52 }, forest, { count: 13 }),
      ...banana({ x: 1.2, y: 17.5, size: 5.5, rot: 24 }, fern, forest, 6, 0.3),
    ],
    title: {
      x: 1.8,
      y: 2.6,
      w: 14.8,
      h: 6.2,
      valign: 'bottom',
      size: 66,
      color: cream,
      sample: 'Sommer im\nDschungel',
    },
    subtitle: {
      x: 1.8,
      y: 9.3,
      w: 13,
      h: 1.6,
      color: yellow,
      sample: 'Reisebericht aus dem Regenwald',
    },
  },
  {
    name: 'Abschnitt',
    bg: turquoise,
    shapes: [
      disc(8.4, 6.4, 4.7, yellow),
      palm({ x: -2.5, y: 4.5, size: 13, rot: 78 }, lagoon, { count: 19 }),
      palm({ x: 12.5, y: 18.5, size: 11, rot: -18, flip: true }, lagoon, { count: 15 }),
      ...banana({ x: -1, y: 15, size: 12, rot: 38 }, forest, fern, 2),
      ...monstera({ x: 4.6, y: 18.6, size: 12.5, rot: 12 }, jungle, forest, 5),
      fan({ x: 1.5, y: -1.5, size: 7.5, rot: 150 }, jungle, 11),
      ...hibiscus(10.7, 11.8, 2.1, -20),
      ...hibiscus(3.1, 6.2, 1.35, 30, cream, yellow, orange),
      palm({ x: 29.5, y: -1, size: 7, rot: 228 }, lagoon, { count: 12 }),
    ],
    title: {
      x: 14.6,
      y: 3.9,
      w: 11.8,
      h: 5.4,
      valign: 'bottom',
      size: 56,
      color: jungle,
      sample: 'Unter dem\nBlätterdach',
    },
    subtitle: {
      x: 14.6,
      y: 9.8,
      w: 11.8,
      h: 1.6,
      color: jungle,
      sample: 'Zweiter Tag: Pflanzen und Tiere',
    },
  },
  {
    name: 'Inhalt',
    bg: cream,
    shapes: [
      palm({ x: 29.8, y: 11.5, size: 9, rot: -68 }, turquoise, { count: 14 }),
      fan({ x: 27.8, y: -1.6, size: 7.6, rot: 196 }, forest, 11),
      ...banana({ x: 25.2, y: 18, size: 9.5, rot: -8 }, leaf, fern, 9, 0.1),
      ...monstera({ x: 27.6, y: 17.6, size: 8, rot: -6 }, jungle, forest, 12),
      ...hibiscus(23.6, 13.4, 1.25, 20),
      { t: 'rect', x: 1.9, y: 3.72, w: 2.6, h: 0.22, r: 0.11, fill: pink },
    ],
    title: { x: 1.8, y: 1.1, w: 20, h: 2.4, valign: 'bottom', sample: 'Was im Regenwald wächst' },
    body: {
      x: 1.8,
      y: 4.5,
      w: 19.4,
      h: 9.9,
      sample: [
        'Über die Hälfte aller Arten lebt in den Tropen',
        'Jede Etage des Waldes hat ihr eigenes Klima',
        'Epiphyten wachsen auf Ästen, ganz ohne Erde',
        'Lianen klettern bis zu vierzig Meter hoch',
        'Viele Blüten öffnen sich nur für einen Tag',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: cream,
    shapes: [
      disc(15.4, 2.6, 2.1, yellow),
      palm({ x: 18, y: 4, size: 8.5, rot: -52 }, turquoise, { count: 14 }),
      ...monstera({ x: 23, y: 6.5, size: 8.6, rot: 48 }, jungle, forest, 7),
      ...banana({ x: 23.5, y: 4, size: 7, rot: 14 }, leaf, fern, 3),
      palm({ x: 22, y: 11, size: 8, rot: 118 }, forest, { count: 14 }),
      fan({ x: 18.4, y: 11.6, size: 6.6, rot: -172 }, leaf, 11, 80),
      palm({ x: 16.5, y: 11.5, size: 6.4, rot: -128, flip: true }, jungle, { count: 12 }),
      ...hibiscus(26, 13.5, 1.7, 10),
    ],
    title: {
      x: 1.8,
      y: 1.2,
      w: 11.8,
      h: 3.6,
      valign: 'bottom',
      size: 36,
      sample: 'Ein Blatt mit Fenstern',
    },
    body: {
      x: 1.8,
      y: 5.2,
      w: 11.6,
      h: 9,
      size: 20,
      sample: [
        'Die Monstera stammt aus Mittelamerika',
        'Ihre Löcher lassen Licht und Regen durch',
        'Junge Blätter sind noch ganz geschlossen',
      ],
    },
    pictures: [{ x: 15.4, y: 2.6, w: 10.6, h: 10.9 }],
  },
  {
    name: 'Zwei Spalten',
    // A light page under a dark sheet: bullets take their colour from the page ground.
    bg: cream,
    shapes: [
      { t: 'rect', x: -0.2, y: -0.2, w: 28.4, h: 16.15, fill: jungle },
      palm({ x: -2, y: 13, size: 10, rot: 62 }, forest, { count: 15 }),
      palm({ x: 30, y: 6, size: 11, rot: -96 }, forest, { count: 16 }),
      ...monstera({ x: 26.8, y: 18.8, size: 8.5, rot: -14 }, leaf, jungle, 21),
      fan({ x: 0.4, y: 17.2, size: 7, rot: 34 }, lagoon, 11),
      ...banana({ x: 14.6, y: 19, size: 7.6, rot: -16 }, fern, forest, 5),
      ...banana({ x: 13.4, y: 19, size: 6.6, rot: 18 }, leaf, fern, 6),
      { t: 'rect', x: 1.8, y: 3.9, w: 11.7, h: 9.6, r: 0.7, fill: cream },
      { t: 'rect', x: 14.5, y: 3.9, w: 11.7, h: 9.6, r: 0.7, fill: cream },
      ...hibiscus(14, 13.3, 1.45, 8),
      palm({ x: 29.5, y: -1.5, size: 6.5, rot: 222 }, turquoise, { count: 12 }),
    ],
    title: {
      x: 1.8,
      y: 0.9,
      w: 22,
      h: 2.4,
      valign: 'middle',
      size: 38,
      color: cream,
      sample: 'Tag und Nacht im Wald',
    },
    body: [
      {
        x: 2.6,
        y: 4.6,
        w: 10.2,
        h: 8.2,
        size: 18,
        sample: [
          'Morgens rufen die Brüllaffen',
          'Kolibris besuchen die Blüten',
          'Mittags ruht fast alles im Schatten',
        ],
      },
      {
        x: 15.3,
        y: 4.6,
        w: 10.2,
        h: 8.2,
        size: 18,
        sample: [
          'Nachts jagen Fledermäuse',
          'Frösche geben ein Konzert',
          'Manche Pilze leuchten im Dunkeln',
        ],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: jungle,
    shapes: [
      ...[0, 40, 80, 120, 160, 200, 240, 280, 320].map((rot, index) =>
        palm(
          { x: 8.2, y: 7.9, size: 8.2, rot: rot + 8, flip: index % 2 === 0 },
          [forest, fern, lagoon][index % 3]!,
          { count: 15, bend: 0.16 },
        ),
      ),
      ...[20, 60, 100, 140, 180, 220, 260, 300, 340].map((rot, index) =>
        fan({ x: 8.2, y: 7.9, size: 9.4, rot: rot + 8 }, index % 2 ? leaf : fern, 7, 40),
      ),
      disc(8.2, 7.9, 4.9, yellow),
      ...hibiscus(12.3, 11.7, 1.6, -14),
      ...hibiscus(4.3, 3.6, 1.1, 40, orange, '#c4411a'),
      { t: 'rect', x: 17.8, y: 5.55, w: 2.6, h: 0.22, r: 0.11, fill: pink },
    ],
    title: {
      x: 3.6,
      y: 5,
      w: 9.2,
      h: 5.8,
      valign: 'middle',
      align: 'center',
      size: 84,
      color: jungle,
      sample: '6 %',
    },
    body: {
      x: 17.8,
      y: 6.1,
      w: 8.6,
      h: 5.6,
      size: 24,
      color: cream,
      sample: 'der Landfläche bedeckt der Regenwald.\nDort lebt jede zweite Art.',
    },
  },
  {
    name: 'Zitat',
    bg: pink,
    shapes: [
      palm({ x: -2, y: 10, size: 12, rot: 60 }, rose, { count: 17 }),
      palm({ x: 30, y: 5, size: 12, rot: -118 }, rose, { count: 17 }),
      ...monstera({ x: 26.8, y: -2.8, size: 9.5, rot: 196 }, jungle, forest, 31),
      ...banana({ x: 21, y: -3, size: 8, rot: 160 }, forest, fern, 14),
      palm({ x: -1.5, y: 18, size: 10.5, rot: 48 }, jungle, { count: 15 }),
      ...monstera({ x: 0.6, y: 18.5, size: 7.4, rot: 18 }, forest, jungle, 18),
      fan({ x: 27.2, y: 17.6, size: 7.6, rot: -24 }, jungle, 11),
      ...hibiscus(24.2, 12.6, 1.5, -10, yellow, orange, cream),
      {
        t: 'text',
        x: 3.6,
        y: 0.4,
        w: 5,
        h: 4.6,
        text: '“',
        font: 'Abril Fatface',
        size: 170,
        color: yellow,
        valign: 'top',
      },
    ],
    body: {
      x: 5,
      y: 3.9,
      w: 17.6,
      h: 6.6,
      valign: 'middle',
      font: 'Abril Fatface',
      size: 34,
      lineHeight: 118,
      color: cream,
      sample: 'Im Wald wird nichts verschwendet: Jedes Blatt füttert das nächste.',
    },
    subtitle: {
      x: 5,
      y: 11,
      w: 14,
      h: 1.5,
      color: yellow,
      sample: 'Mara Lindqvist, Botanikerin',
    },
  },
  {
    name: 'Bild',
    bg: jungle,
    shapes: [
      palm({ x: 6, y: 5, size: 10, rot: -62 }, forest, { count: 16 }),
      palm({ x: 22, y: 5, size: 10, rot: 58, flip: true }, forest, { count: 16 }),
      fan({ x: 4.6, y: 9.4, size: 7.4, rot: -112 }, lagoon, 11, 80),
      ...monstera({ x: 23, y: 8, size: 8.8, rot: 76 }, leaf, jungle, 41),
      ...banana({ x: 22, y: 9, size: 9, rot: 128 }, fern, forest, 8),
      ...banana({ x: 6, y: 9, size: 8.5, rot: -136 }, leaf, fern, 10),
      palm({ x: 24, y: 3, size: 7, rot: 28 }, turquoise, { count: 12 }),
      ...hibiscus(3.4, 12, 1.7, 24),
      ...hibiscus(24.9, 12.3, 1.3, -20, yellow, orange, cream),
    ],
    pictures: [{ x: 3.4, y: 1.3, w: 21.2, h: 10.7 }],
    title: {
      x: 5.6,
      y: 12.5,
      w: 16.8,
      h: 2.2,
      valign: 'middle',
      align: 'center',
      size: 30,
      color: cream,
      sample: 'Morgennebel über dem Fluss',
    },
  },
  {
    name: 'Schluss',
    bg: yellow,
    shapes: [
      palm({ x: -2, y: 3, size: 11, rot: 104 }, orange, { count: 16 }),
      palm({ x: 30, y: 12.5, size: 11, rot: -76 }, orange, { count: 16 }),
      ...banana({ x: 8, y: -3, size: 8.4, rot: 172 }, leaf, fern, 3),
      ...monstera({ x: 1.4, y: -2.6, size: 9.4, rot: 150 }, jungle, forest, 51),
      fan({ x: -0.6, y: 14.6, size: 8.4, rot: 44 }, forest, 12),
      ...monstera({ x: 5.4, y: 19, size: 8, rot: 6 }, lagoon, jungle, 52),
      palm({ x: 12, y: 19, size: 7.5, rot: -24 }, jungle, { count: 12 }),
      palm({ x: 17, y: -3, size: 7.5, rot: 160 }, jungle, { count: 12 }),
      fan({ x: 28.4, y: 1, size: 8.4, rot: -134 }, forest, 12),
      ...monstera({ x: 26.4, y: 18.8, size: 9.6, rot: -16 }, jungle, forest, 53),
      ...banana({ x: 20, y: 19, size: 8, rot: -12 }, leaf, fern, 5),
      ...monstera({ x: 23, y: -3, size: 8, rot: 186 }, lagoon, jungle, 54),
      ...hibiscus(5.6, 12.4, 1.7, 20),
      ...hibiscus(22.6, 3.3, 1.5, -30),
    ],
    title: {
      x: 7,
      y: 4.2,
      w: 14,
      h: 4.6,
      valign: 'bottom',
      align: 'center',
      size: 76,
      color: jungle,
      sample: 'Danke!',
    },
    subtitle: {
      x: 7,
      y: 9.2,
      w: 14,
      h: 1.6,
      align: 'center',
      color: jungle,
      sample: 'Fragen? Immer her damit.',
    },
  },
];

const template: Template = {
  slug: 'tropen',
  name: 'Tropen',
  group: 'Farbenfroh',
  tags: ['Tropen', 'Dschungel', 'Blätter', 'Monstera', 'Hibiskus', 'üppig', 'Sommer', 'Reise'],
  description:
    'Üppiger Dschungel: Monstera, Palmwedel und Hibiskus wachsen in Pink, Türkis und Gelb vom Rand in die Folie.',
  palette: {
    bg: cream,
    text: jungle,
    bg2: sand,
    text2: forest,
    accents: [pink, turquoise, yellow, leaf, orange, lagoon],
  },
  fonts: { head: 'Abril Fatface', body: 'Poppins' },
  text: {
    title: { font: 'Abril Fatface', size: 42, color: jungle, lineHeight: 102 },
    subtitle: { font: 'Poppins', size: 22, color: jungle, bold: true },
    body: { font: 'Poppins', size: 22, color: jungle, lineHeight: 122, paraSpace: 0.32 },
  },
  layouts,
};

export default template;
