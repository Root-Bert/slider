import { jpeg, mix, noise, paint, rgb, rgba, rng, type Paint, type Rng } from '../art';
import type { Color, Layout, Shape, Template } from '../model';
import { PAGE } from '../model';
import { page } from '../shapes';

/*
 * Weltraum: deep space, a different sky on every layout – star fields, nebula clouds, a ringed
 * giant, a planet's rim at sunrise, an eclipse, a spiral galaxy – with thin orbits drawn over
 * them and cool white type.
 */

const night = '#060915';
const deep = '#121a3a';
const white = '#f1f5ff';
const mist = '#a9b6d6';
const cyan = '#5fd2f0';
const violet = '#8b6cf0';
const magenta = '#e060b8';
const amber = '#f2b25a';
const teal = '#35c2a5';
const blue = '#3d7ff0';

const PXL = 1600 / PAGE.w;
type Ctx = Paint['ctx'];

interface Nebula {
  /** Centre and reach in centimetres. */
  x: number;
  y: number;
  r: number;
  color: Color;
  /** A second colour its clouds drift into. */
  other?: Color;
  strength?: number;
}

interface Sky {
  seed: number;
  nebulae?: readonly Nebula[];
  stars?: number;
  /** How much of nebula and bright stars a place keeps (0 … 1): dark where the words stand. */
  keep?: (x: number, y: number) => number;
  /** Planets and other bodies, drawn over the stars; `c` turns centimetres into pixels. */
  bodies?: (ctx: Ctx, c: (cm: number) => number, random: Rng) => void;
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const smooth = (from: number, to: number, value: number) => {
  const t = clamp((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};

/** A sky: the dark, its nebulae, its stars, its bodies – as a page-sized picture. */
function sky(spec: Sky): Shape {
  const surface = paint(PAGE, PXL);
  const { ctx, w, h, px } = surface;
  const random = rng(spec.seed);
  const [cloud, warp, hue] = [noise(spec.seed + 1), noise(spec.seed + 2), noise(spec.seed + 3)];
  const keep = spec.keep ?? (() => 1);
  const nebulae = (spec.nebulae ?? []).map((nebula) => ({
    ...nebula,
    a: rgb(nebula.color),
    b: rgb(nebula.other ?? nebula.color),
  }));
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [cx, cy] = [x / px, y / px];
      const far = Math.hypot(x / w - 0.5, y / h - 0.5);
      let [r, g, b] = [6 + far * -3, 9 + far * -3, 22 + far * -8];
      if (nebulae.length > 0) {
        const k = keep(cx, cy);
        const wx = warp(x / 260, y / 260, 3) - 0.5;
        const wy = warp(x / 260 + 40, y / 260 + 40, 3) - 0.5;
        const q = cloud(x / 190 + wx * 3.2, y / 190 + wy * 3.2, 5);
        const tint = hue(x / 330, y / 330, 3);
        for (const nebula of nebulae) {
          const fall = clamp(1 - Math.hypot(cx - nebula.x, cy - nebula.y) / nebula.r);
          if (fall <= 0) continue;
          const body = Math.pow(fall, 1.3) * smooth(0.36, 0.78, q + fall * 0.3);
          const thread = fall * Math.pow(1 - Math.abs(2 * q - 1), 9) * 0.35;
          const light = (body + thread) * (nebula.strength ?? 0.6) * k;
          const t = smooth(0.35, 0.65, tint);
          r += (nebula.a[0] + (nebula.b[0] - nebula.a[0]) * t) * light;
          g += (nebula.a[1] + (nebula.b[1] - nebula.a[1]) * t) * light;
          b += (nebula.a[2] + (nebula.b[2] - nebula.a[2]) * t) * light;
        }
      }
      const i = (y * w + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  // Stars: many faint, few bright; the bright ones glow and carry a cross.
  const tints = ['255,255,255', '200,220,255', '255,236,210', '180,205,255'];
  const count = spec.stars ?? 900;
  for (let i = 0; i < count; i += 1) {
    const [x, y] = [random() * w, random() * h];
    const light = Math.pow(random(), 3.2);
    ctx.fillStyle = `rgba(${random.pick(tints)},${0.25 + light * 0.75})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.45 + light * 1.25, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < count / 55; i += 1) {
    const [x, y] = [random() * w, random() * h];
    if (keep(x / px, y / px) < 0.6) continue;
    const size = random.range(5, 12);
    const tint = random.pick(tints);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, size);
    glow.addColorStop(0, `rgba(${tint},0.9)`);
    glow.addColorStop(0.18, `rgba(${tint},0.35)`);
    glow.addColorStop(1, `rgba(${tint},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(x - size, y - size, size * 2, size * 2);
    ctx.strokeStyle = `rgba(${tint},0.5)`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x - size * 1.5, y);
    ctx.lineTo(x + size * 1.5, y);
    ctx.moveTo(x, y - size * 1.5);
    ctx.lineTo(x, y + size * 1.5);
    ctx.stroke();
  }
  spec.bodies?.(ctx, (cm) => cm * px, random);
  return { t: 'image', ...page, src: jpeg(surface, 80) };
}

interface Planet {
  x: number;
  y: number;
  r: number;
  /** Its bands or its ground, light to dark. */
  colors: readonly Color[];
  /** Where the light comes from, degrees (0 = from the right, 270 = from above). */
  light?: number;
  air?: Color;
  /** Bands turned by degrees; left out: a rocky ball with craters. */
  bands?: number;
  ring?: { reach: number; flat: number; tilt: number; color: Color };
  seed?: number;
}

/** A planet lit from one side, its night side soft at the terminator. All lengths in pixels. */
function planet(ctx: Ctx, p: Planet): void {
  const random = rng(p.seed ?? 5);
  const field = noise((p.seed ?? 5) + 9);
  const light = ((p.light ?? 215) * Math.PI) / 180;
  const ringPart = (front: boolean) => {
    if (!p.ring) return;
    const { reach, flat, tilt, color } = p.ring;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((tilt * Math.PI) / 180);
    for (let i = 0; i < 26; i += 1) {
      const t = i / 25;
      const radius = p.r * (1.28 + t * (reach - 1.28));
      const gap = t > 0.52 && t < 0.6;
      ctx.strokeStyle = rgba(color, gap ? 0.06 : 0.2 + field(t * 9, 2, 2) * 0.5);
      ctx.lineWidth = (p.r * (reach - 1.28)) / 25 + 0.6;
      ctx.beginPath();
      ctx.ellipse(
        0,
        0,
        radius,
        radius * flat,
        0,
        front ? 0 : Math.PI,
        front ? Math.PI : Math.PI * 2,
      );
      ctx.stroke();
    }
    ctx.restore();
  };
  // Its air, glowing a little past the rim.
  if (p.air) {
    const air = ctx.createRadialGradient(p.x, p.y, p.r * 0.96, p.x, p.y, p.r * 1.16);
    air.addColorStop(0, rgba(p.air, 0.5));
    air.addColorStop(1, rgba(p.air, 0));
    ctx.fillStyle = air;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 1.16, 0, Math.PI * 2);
    ctx.fill();
  }
  ringPart(false);
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = p.colors[0]!;
  ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
  const colorAt = (t: number) => {
    const at = clamp(t) * (p.colors.length - 1);
    const i = Math.min(p.colors.length - 2, Math.floor(at));
    return mix(p.colors[i]!, p.colors[i + 1]!, at - i);
  };
  if (p.bands !== undefined) {
    ctx.translate(p.x, p.y);
    ctx.rotate((p.bands * Math.PI) / 180);
    const step = Math.max(1.5, p.r / 90);
    for (let y = -p.r; y < p.r; y += step) {
      const v = y / p.r;
      ctx.fillStyle = colorAt(field(v * 2.6 + 3, 1.5, 4) * 1.5 - 0.25);
      // Bands bow a little, as on a ball.
      ctx.beginPath();
      ctx.ellipse(0, y - p.r * 0.5, p.r * 1.6, p.r * 0.5 + step * 1.6, 0, 0.1, Math.PI - 0.1);
      ctx.lineWidth = step * 1.8;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.stroke();
    }
  } else {
    for (let i = 0; i < 70; i += 1) {
      const [a, d] = [random() * Math.PI * 2, Math.sqrt(random()) * p.r];
      ctx.fillStyle = rgba(colorAt(random()), 0.35);
      ctx.beginPath();
      ctx.ellipse(
        p.x + Math.cos(a) * d,
        p.y + Math.sin(a) * d,
        p.r * random.range(0.08, 0.34),
        p.r * random.range(0.05, 0.2),
        random() * 3,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    for (let i = 0; i < 16; i += 1) {
      const [a, d, size] = [
        random() * Math.PI * 2,
        Math.sqrt(random()) * p.r * 0.9,
        p.r * random.range(0.03, 0.11),
      ];
      const [x, y] = [p.x + Math.cos(a) * d, p.y + Math.sin(a) * d];
      ctx.fillStyle = rgba(p.colors[p.colors.length - 1]!, 0.45);
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba(p.colors[0]!, 0.5);
      ctx.lineWidth = Math.max(1, size * 0.18);
      ctx.beginPath();
      ctx.arc(x, y, size, light - 1.2, light + 1.2);
      ctx.stroke();
    }
  }
  ctx.restore();
  // Day and night: light on the near side, the far side falling into the dark.
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r + 0.5, 0, Math.PI * 2);
  ctx.clip();
  const [lx, ly] = [p.x + Math.cos(light) * p.r * 0.55, p.y + Math.sin(light) * p.r * 0.55];
  const shade = ctx.createRadialGradient(lx, ly, 0, lx, ly, p.r * 1.75);
  shade.addColorStop(0, 'rgba(255,255,255,0.2)');
  shade.addColorStop(0.3, 'rgba(255,255,255,0)');
  shade.addColorStop(0.55, 'rgba(2,4,12,0.45)');
  shade.addColorStop(0.78, 'rgba(2,4,12,0.9)');
  shade.addColorStop(1, 'rgba(2,4,12,0.97)');
  ctx.fillStyle = shade;
  ctx.fillRect(p.x - p.r - 1, p.y - p.r - 1, p.r * 2 + 2, p.r * 2 + 2);
  ctx.restore();
  ringPart(true);
}

/** A soft light: a glow round a point. */
function glow(ctx: Ctx, x: number, y: number, r: number, color: Color, alpha = 1): void {
  const light = ctx.createRadialGradient(x, y, 0, x, y, r);
  light.addColorStop(0, rgba(color, alpha));
  light.addColorStop(0.25, rgba(color, alpha * 0.45));
  light.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = light;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** An orbit: a thin ellipse turned, with a body on it at an angle. */
function orbit(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotate: number,
  body?: readonly [angle: number, size: number, color: Color],
  opacity = 0.32,
): Shape[] {
  const shapes: Shape[] = [
    {
      t: 'ellipse',
      x: cx - rx,
      y: cy - ry,
      w: rx * 2,
      h: ry * 2,
      rotate,
      fill: null,
      stroke: { color: white, width: 0.025, opacity },
    },
  ];
  if (body) {
    const [angle, size, color] = body;
    const [a, turn] = [(angle * Math.PI) / 180, (rotate * Math.PI) / 180];
    const [x, y] = [Math.cos(a) * rx, Math.sin(a) * ry];
    const [bx, by] = [
      cx + x * Math.cos(turn) - y * Math.sin(turn),
      cy + x * Math.sin(turn) + y * Math.cos(turn),
    ];
    shapes.push(
      {
        t: 'ellipse',
        x: bx - size * 1.9,
        y: by - size * 1.9,
        w: size * 3.8,
        h: size * 3.8,
        fill: { t: 'solid', color, opacity: 0.18 },
      },
      { t: 'ellipse', x: bx - size, y: by - size, w: size * 2, h: size * 2, fill: color },
    );
  }
  return shapes;
}

const tick = (x: number, y: number, length = 1.6, color: Color = cyan): Shape => ({
  t: 'rect',
  x,
  y,
  w: length,
  h: 0.09,
  r: 0.045,
  fill: color,
});

const left =
  (edge: number, soft = 5) =>
  (x: number) =>
    0.12 + 0.88 * smooth(edge, edge + soft, x);

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: night,
    shapes: [
      sky({
        seed: 101,
        nebulae: [
          { x: 5, y: 1, r: 13, color: '#4a2fc0', other: '#1d5fd0', strength: 0.55 },
          { x: 19, y: 2, r: 10, color: '#1e58c8', other: '#7a3fd0', strength: 0.5 },
        ],
        keep: (x, y) =>
          0.25 + 0.75 * smooth(0, 6, Math.abs(y - 8.4) - 1.5 + Math.max(0, x - 15) * 0.6),
        bodies: (ctx, c) => {
          planet(ctx, {
            x: c(22.6),
            y: c(12.3),
            r: c(5.6),
            colors: ['#f4d9a8', '#e0a070', '#c9785e', '#8f5560', '#e9c392'],
            bands: -18,
            light: 205,
            air: '#f2b25a',
            ring: { reach: 2.25, flat: 0.26, tilt: -18, color: '#f3dfc0' },
            seed: 7,
          });
          planet(ctx, {
            x: c(13.9),
            y: c(2.5),
            r: c(0.55),
            colors: ['#d9dde8', '#9aa3b8', '#646c82'],
            light: 200,
            seed: 8,
          });
        },
      }),
      tick(2.4, 10.55),
    ],
    title: { x: 2.3, y: 3.4, w: 15.2, h: 6.6, size: 70, sample: 'Reise zu den\nRändern' },
    subtitle: { x: 2.4, y: 11.2, w: 13, h: 1.4, sample: 'Astronomie für Neugierige' },
  },
  {
    name: 'Abschnitt',
    bg: night,
    shapes: [
      sky({
        seed: 102,
        stars: 700,
        nebulae: [{ x: 24, y: 1, r: 9, color: '#1a8a9c', other: '#2a4fd0', strength: 0.4 }],
        keep: (x, y) => (y > 11 ? 0 : 1),
        bodies: (ctx, c) => {
          // The rim of a world, the sun just coming over it.
          const [x, y, r] = [c(14), c(39.4), c(27)];
          const air = ctx.createRadialGradient(x, y, r * 0.985, x, y, r * 1.06);
          air.addColorStop(0, 'rgba(120,200,255,0.75)');
          air.addColorStop(0.3, 'rgba(60,130,240,0.35)');
          air.addColorStop(1, 'rgba(40,90,220,0)');
          ctx.fillStyle = air;
          ctx.beginPath();
          ctx.arc(x, y, r * 1.06, 0, Math.PI * 2);
          ctx.fill();
          const [sx, sy] = [c(20.2), c(13.15)];
          ctx.globalCompositeOperation = 'lighter';
          glow(ctx, sx, sy, c(7), '#6aa8ff', 0.5);
          glow(ctx, sx, sy, c(2.6), '#fff4dc', 1);
          const streak = ctx.createLinearGradient(sx - c(9), 0, sx + c(9), 0);
          streak.addColorStop(0, 'rgba(160,200,255,0)');
          streak.addColorStop(0.5, 'rgba(255,250,235,0.85)');
          streak.addColorStop(1, 'rgba(160,200,255,0)');
          ctx.fillStyle = streak;
          ctx.fillRect(sx - c(9), sy - 1.5, c(18), 3);
          ctx.globalCompositeOperation = 'source-over';
          const ground = ctx.createRadialGradient(x, y, r * 0.9, x, y, r);
          ground.addColorStop(0, '#02040c');
          ground.addColorStop(0.9, '#050b1c');
          ground.addColorStop(1, '#0c1c3c');
          ctx.fillStyle = ground;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(190,225,255,0.85)';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(x, y, r, -Math.PI / 2 - 0.12, -Math.PI / 2 + 0.5);
          ctx.stroke();
          ctx.globalCompositeOperation = 'lighter';
          glow(ctx, sx, sy, c(0.9), '#ffffff', 1);
          ctx.globalCompositeOperation = 'source-over';
        },
      }),
      tick(2.6, 7.2),
    ],
    title: { x: 2.5, y: 2.2, w: 23, h: 4.6, size: 66, sample: 'Das innere System' },
    subtitle: { x: 2.6, y: 7.8, w: 18, h: 1.4, sample: 'Vier Welten aus Stein' },
  },
  {
    name: 'Inhalt',
    bg: night,
    shapes: [
      sky({
        seed: 103,
        stars: 650,
        nebulae: [{ x: 27, y: 14, r: 11, color: '#1d4fc4', other: '#167f96', strength: 0.5 }],
        keep: left(17, 6),
        bodies: (ctx, c) => {
          planet(ctx, {
            x: c(24.3),
            y: c(10.3),
            r: c(1.5),
            colors: ['#e6e9f2', '#aab2c6', '#6f7890'],
            light: 215,
            seed: 12,
          });
        },
      }),
      ...orbit(24.3, 10.3, 3.9, 1.3, -24, [150, 0.13, cyan]),
      ...orbit(24.3, 10.3, 5.6, 2, -24, [330, 0.09, amber], 0.2),
      tick(2.4, 3.65),
    ],
    title: {
      x: 2.3,
      y: 1.2,
      w: 21,
      h: 2.2,
      valign: 'middle',
      size: 36,
      sample: 'Was den Mond besonders macht',
    },
    body: {
      x: 2.4,
      y: 4.6,
      w: 17.6,
      h: 9.6,
      sample: [
        'Er zeigt uns immer dieselbe Seite',
        'Sein Tag dauert vier Wochen',
        'Ohne Luft bleibt jeder Fußabdruck',
        'Er bremst die Erde ein wenig',
        'Jedes Jahr rückt er vier Zentimeter weg',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: night,
    shapes: [
      sky({
        seed: 104,
        stars: 700,
        nebulae: [
          { x: 1, y: 15, r: 9, color: '#a02f9a', other: '#4a2fc0', strength: 0.45 },
          { x: 27, y: 0, r: 8, color: '#5a35c8', other: '#c0408a', strength: 0.45 },
        ],
        keep: (x, y) => 0.2 + 0.8 * smooth(4, 9, Math.hypot(x - 8, (y - 8) * 1.3)),
      }),
      ...orbit(20.4, 7.9, 8.6, 6.9, 0, [205, 0.12, magenta], 0.26),
      {
        t: 'rect',
        x: 14.75,
        y: 2.15,
        w: 11.3,
        h: 11.45,
        r: 0.2,
        fill: { t: 'solid', color: night, opacity: 0.7 },
        stroke: { color: white, width: 0.025, opacity: 0.4 },
      },
      tick(2.4, 3.65, 1.6, magenta),
    ],
    title: {
      x: 2.3,
      y: 1.2,
      w: 11.4,
      h: 2.2,
      valign: 'middle',
      size: 36,
      sample: 'Der Orionnebel',
    },
    body: {
      x: 2.4,
      y: 4.6,
      w: 11.2,
      h: 9.6,
      sample: [
        'Eine Wolke aus Gas und Staub',
        'Hier entstehen gerade Sterne',
        'Mit bloßem Auge zu finden',
      ],
    },
    pictures: [{ x: 15, y: 2.4, w: 10.8, h: 10.95 }],
  },
  {
    name: 'Zwei Spalten',
    bg: night,
    shapes: [
      sky({
        seed: 105,
        stars: 1500,
        nebulae: [
          { x: 4, y: 14, r: 10, color: '#2a3fa8', other: '#5a45b8', strength: 0.5 },
          { x: 14, y: 8, r: 9, color: '#3a4fb8', other: '#8a6a9a', strength: 0.4 },
          { x: 25, y: 2, r: 10, color: '#2a50b8', other: '#6a55c0', strength: 0.5 },
        ],
        bodies: (ctx, c) => {
          // A comet, its tail blown away from the sun.
          const [x, y] = [c(24.6), c(2)];
          ctx.globalCompositeOperation = 'lighter';
          for (let i = 0; i < 40; i += 1) {
            const spread = (i / 39 - 0.5) * 0.3;
            const reach = c(6.5) * (1 - Math.abs(spread) * 2.2);
            const a = -0.32 + spread;
            const tail = ctx.createLinearGradient(
              x,
              y,
              x + Math.cos(a) * reach,
              y + Math.sin(a) * reach,
            );
            tail.addColorStop(0, 'rgba(170,220,255,0.16)');
            tail.addColorStop(1, 'rgba(120,170,255,0)');
            ctx.strokeStyle = tail;
            ctx.lineWidth = c(0.09);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(a) * reach, y + Math.sin(a) * reach);
            ctx.stroke();
          }
          glow(ctx, x, y, c(0.9), '#cfeaff', 1);
          ctx.globalCompositeOperation = 'source-over';
        },
      }),
      {
        t: 'rect',
        x: 1.8,
        y: 4.3,
        w: 11.8,
        h: 9.9,
        r: 0.35,
        fill: { t: 'solid', color: '#070c22', opacity: 0.72 },
        stroke: { color: white, width: 0.025, opacity: 0.3 },
      },
      {
        t: 'rect',
        x: 14.4,
        y: 4.3,
        w: 11.8,
        h: 9.9,
        r: 0.35,
        fill: { t: 'solid', color: '#070c22', opacity: 0.72 },
        stroke: { color: white, width: 0.025, opacity: 0.3 },
      },
      tick(2.6, 5.05, 1.2, cyan),
      tick(15.2, 5.05, 1.2, amber),
    ],
    title: {
      x: 2.3,
      y: 1.2,
      w: 19,
      h: 2.2,
      valign: 'middle',
      size: 36,
      sample: 'Planet oder Stern',
    },
    body: [
      {
        x: 2.6,
        y: 5.6,
        w: 10.2,
        h: 8,
        sample: ['Leuchtet nur geliehen', 'Kreist um eine Sonne', 'Flackert kaum am Himmel'],
      },
      {
        x: 15.2,
        y: 5.6,
        w: 10.2,
        h: 8,
        sample: ['Brennt aus eigener Kraft', 'Steht scheinbar still', 'Funkelt durch die Luft'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: night,
    shapes: [
      sky({
        seed: 106,
        stars: 600,
        keep: (x, y) => smooth(5.5, 8, Math.hypot(x - 9, y - 7.9)),
        bodies: (ctx, c, random) => {
          // A total eclipse: the corona streaming out round a black disc.
          const [x, y, r] = [c(9), c(7.9), c(4.7)];
          ctx.globalCompositeOperation = 'lighter';
          glow(ctx, x, y, r * 2.5, '#5f8fe8', 0.45);
          for (let i = 0; i < 260; i += 1) {
            const a = random() * Math.PI * 2;
            const lobe = 0.55 + 0.45 * Math.pow(Math.abs(Math.cos(a - 0.5)), 3);
            const reach = r * (1.15 + random() * random() * 1.5 * lobe);
            const half = random.range(0.01, 0.05);
            const ray = ctx.createRadialGradient(x, y, r * 0.9, x, y, reach);
            ray.addColorStop(0, 'rgba(235,242,255,0.2)');
            ray.addColorStop(1, 'rgba(160,190,255,0)');
            ctx.fillStyle = ray;
            ctx.beginPath();
            ctx.moveTo(x + Math.cos(a - half) * r * 0.9, y + Math.sin(a - half) * r * 0.9);
            ctx.lineTo(x + Math.cos(a) * reach, y + Math.sin(a) * reach);
            ctx.lineTo(x + Math.cos(a + half) * r * 0.9, y + Math.sin(a + half) * r * 0.9);
            ctx.closePath();
            ctx.fill();
          }
          const halo = ctx.createRadialGradient(x, y, r * 0.98, x, y, r * 1.25);
          halo.addColorStop(0, 'rgba(255,255,255,0.95)');
          halo.addColorStop(0.25, 'rgba(210,228,255,0.4)');
          halo.addColorStop(1, 'rgba(150,180,255,0)');
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(x, y, r * 1.25, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = '#03050d';
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          // The last bead of sunlight.
          ctx.globalCompositeOperation = 'lighter';
          const [bx, by] = [x + Math.cos(-0.75) * r, y + Math.sin(-0.75) * r];
          glow(ctx, bx, by, c(1.5), '#ffffff', 1);
          glow(ctx, bx, by, c(0.5), '#ffffff', 1);
          ctx.globalCompositeOperation = 'source-over';
        },
      }),
      tick(17.2, 5.2, 1.6, amber),
    ],
    title: {
      x: 4.6,
      y: 5,
      w: 8.8,
      h: 5.8,
      valign: 'middle',
      align: 'center',
      size: 104,
      sample: '13,8',
    },
    body: {
      x: 17.1,
      y: 5.8,
      w: 9,
      h: 6.4,
      size: 24,
      sample: 'Milliarden Jahre ist das Universum alt. Wir schauen seit einem Wimpernschlag zu.',
    },
  },
  {
    name: 'Zitat',
    bg: night,
    shapes: [
      sky({
        seed: 107,
        stars: 800,
        nebulae: [
          { x: 2, y: 1, r: 12, color: '#b0358f', other: '#5a35d0', strength: 0.65 },
          { x: 26, y: 15, r: 12, color: '#16909c', other: '#2a55d8', strength: 0.65 },
          { x: 25, y: 1, r: 7, color: '#4a35c8', strength: 0.4 },
        ],
        keep: (x, y) =>
          0.1 + 0.9 * smooth(0.75, 1.25, Math.hypot((x - 14) / 11.5, (y - 7.4) / 5.2)),
      }),
      ...orbit(14, 7.5, 12.6, 5.9, -6, [200, 0.14, magenta], 0.3),
      ...orbit(14, 7.5, 13.5, 6.6, -6, [18, 0.1, cyan], 0.18),
      tick(13.2, 10.45, 1.6, cyan),
    ],
    body: {
      x: 5.6,
      y: 3.4,
      w: 16.8,
      h: 6.6,
      valign: 'middle',
      align: 'center',
      font: 'Space Grotesk',
      size: 33,
      lineHeight: 118,
      color: white,
      sample: '„Wir sind Sternenstaub, der gelernt hat, nach oben zu schauen.“',
    },
    subtitle: { x: 6, y: 11, w: 16, h: 1.4, align: 'center', sample: 'Jona Brandt, Astronomin' },
  },
  {
    name: 'Bild',
    bg: night,
    shapes: [
      sky({
        seed: 108,
        stars: 800,
        nebulae: [{ x: 2, y: 15, r: 9, color: '#4a2fc0', other: '#1d5fd0', strength: 0.4 }],
        keep: (x) => 0.3 + 0.7 * smooth(18, 22, x),
        bodies: (ctx, c) => {
          planet(ctx, {
            x: c(24),
            y: c(13.6),
            r: c(0.95),
            colors: ['#bfe9f2', '#6fc4d8', '#3f8fb8', '#9adbe6'],
            bands: 14,
            light: 210,
            air: '#5fd2f0',
            ring: { reach: 2.3, flat: 0.3, tilt: 14, color: '#d6f2fa' },
            seed: 21,
          });
        },
      }),
      {
        t: 'rect',
        x: 1.8,
        y: 1.2,
        w: 24.4,
        h: 10.6,
        r: 0.2,
        fill: { t: 'solid', color: night, opacity: 0.7 },
        stroke: { color: white, width: 0.025, opacity: 0.4 },
      },
      tick(2.1, 12.45),
    ],
    pictures: [{ x: 2.05, y: 1.45, w: 23.9, h: 10.1 }],
    title: {
      x: 2,
      y: 12.7,
      w: 18,
      h: 1.8,
      valign: 'middle',
      size: 30,
      sample: 'Saturn im Gegenlicht',
    },
  },
  {
    name: 'Schluss',
    bg: night,
    shapes: [
      sky({
        seed: 109,
        stars: 700,
        keep: (x) => (x > 15 ? 0.4 : 1),
        bodies: (ctx, c, random) => {
          // A spiral galaxy seen at a slant.
          const [x, y] = [c(8.4), c(7.7)];
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(-0.42);
          ctx.scale(1, 0.5);
          ctx.globalCompositeOperation = 'lighter';
          glow(ctx, 0, 0, c(9), '#3050c0', 0.3);
          for (let i = 0; i < 15000; i += 1) {
            const t = Math.pow(random(), 0.75);
            const arm = random.int(0, 1) * Math.PI;
            const a = arm + t * 4.6 + random.bell() * (0.28 + (1 - t) * 0.5);
            const d = c(0.3 + t * 7.6) * (1 + random.bell() * 0.08);
            const warm = 1 - smooth(0.05, 0.4, t);
            ctx.fillStyle = `rgba(${Math.round(150 + warm * 105)},${Math.round(180 + warm * 50)},${Math.round(255 - warm * 70)},${0.1 + random() * 0.35})`;
            const size = random() < 0.03 ? 2 : random.range(0.5, 1.3);
            ctx.fillRect(Math.cos(a) * d, Math.sin(a) * d, size, size * 2);
          }
          for (let i = 0; i < 90; i += 1) {
            const t = random.range(0.2, 0.95);
            const a = random.int(0, 1) * Math.PI + t * 4.6 + random.bell() * 0.2;
            const d = c(0.3 + t * 7.6);
            glow(
              ctx,
              Math.cos(a) * d,
              Math.sin(a) * d,
              c(random.range(0.25, 0.7)),
              random() < 0.4 ? '#d050a8' : '#4a7ae8',
              0.2,
            );
          }
          glow(ctx, 0, 0, c(2.6), '#ffd9a0', 0.7);
          glow(ctx, 0, 0, c(1.1), '#fff6e4', 1);
          ctx.restore();
        },
      }),
      tick(16.1, 9.65),
    ],
    title: { x: 16, y: 3.6, w: 10.4, h: 5.6, size: 70, sample: 'Gute\nReise' },
    subtitle: { x: 16.1, y: 10.3, w: 10.2, h: 1.4, sample: 'Fragen an die Bodenstation' },
  },
];

const template: Template = {
  slug: 'weltraum',
  name: 'Weltraum',
  group: 'Bereich',
  tags: [
    'Weltraum',
    'Sterne',
    'Planeten',
    'Astronomie',
    'Nebel',
    'Wissenschaft',
    'dunkel',
    'Zukunft',
  ],
  description:
    'Tiefer Weltraum mit einem eigenen Himmel je Folie: Sternfelder, Nebel, ein Ringplanet, Sonnenaufgang am Planetenrand, Finsternis und Galaxie.',
  palette: {
    bg: night,
    text: white,
    bg2: deep,
    text2: mist,
    accents: [cyan, violet, magenta, amber, teal, blue],
  },
  fonts: { head: 'Space Grotesk', body: 'Titillium Web' },
  text: {
    title: {
      font: 'Space Grotesk',
      size: 64,
      color: white,
      bold: true,
      lineHeight: 100,
      spacing: -0.5,
    },
    subtitle: { font: 'Space Grotesk', size: 15, color: cyan, upper: true, spacing: 2.5 },
    body: { font: 'Titillium Web', size: 21, color: white, lineHeight: 124, paraSpace: 0.36 },
  },
  layouts,
};

export default template;
