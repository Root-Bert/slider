import { grain, jpeg, noise, paint, rng, type Paint } from '../art';
import type { Color, Layout, Shape, Template } from '../model';
import { PAGE } from '../model';
import { page } from '../shapes';

/*
 * Skandinavisch: a quiet room in the north – linen-white walls, a shelf of pale wood, and on it
 * a few plain things: an arch, a disc, a bowl with a twig. Oatmeal, blue-grey and dusty rose,
 * soft shadows, a gentle serif with a friendly sans. Nothing hurries.
 */

const linen = '#f6f1e8';
const oat = '#e7dccb';
const coal = '#34373a';
const stone = '#7b7770';
const fjord = '#8497a6';
const rose = '#d8a79d';
const birch = '#d6b98f';
const sage = '#a6b29a';
const straw = '#e2c682';
const dusk = '#4f6272';

const PXL = 1600 / PAGE.w;
type Ctx = Paint['ctx'];
type Tone = Color | 'wood';

/** Pale wood, its grain running along: painted once, cut into every wooden thing. */
const wood = (() => {
  const surface = paint(PAGE, PXL);
  const { ctx, w, h } = surface;
  const [bend, streak] = [noise(61), noise(62)];
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const ring = 0.5 + 0.5 * Math.sin((y + (bend(x / 900, y / 130, 3) - 0.5) * 190) / 6.5);
      const dark = Math.pow(ring, 4) * 0.2 + streak(x / 160, y / 1.6, 2) * 0.09;
      const i = (y * w + x) * 4;
      image.data[i] = 228 - dark * 62;
      image.data[i + 1] = 204 - dark * 72;
      image.data[i + 2] = 168 - dark * 84;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return surface.canvas;
})();

/** What stands in the room: plain shapes with soft shadows, lengths in centimetres. */
function stage(ctx: Ctx, px: number) {
  const c = (cm: number) => cm * px;
  const fill = (tone: Tone, path: () => void, turn = 0, shadow = true) => {
    ctx.save();
    if (shadow) {
      ctx.shadowColor = 'rgba(112,88,62,0.24)';
      ctx.shadowBlur = c(0.55);
      ctx.shadowOffsetX = c(0.1);
      ctx.shadowOffsetY = c(0.16);
    }
    ctx.fillStyle = tone === 'wood' ? '#dcc39d' : tone;
    ctx.beginPath();
    path();
    ctx.fill();
    ctx.restore();
    if (tone === 'wood') {
      ctx.save();
      ctx.beginPath();
      path();
      ctx.clip();
      ctx.translate(c(14), c(7.9));
      ctx.rotate(turn);
      ctx.drawImage(wood, -c(14) * 1.3, -c(7.9) * 1.5, wood.width * 1.3, wood.height * 1.5);
      ctx.restore();
    }
  };
  const things = {
    /** A box with a round top, standing on `y + h`. */
    arch(x: number, y: number, w: number, h: number, tone: Tone, turn = Math.PI / 2) {
      fill(
        tone,
        () => {
          ctx.moveTo(c(x), c(y + h));
          ctx.lineTo(c(x), c(y + w / 2));
          ctx.arc(c(x + w / 2), c(y + w / 2), c(w / 2), Math.PI, 0);
          ctx.lineTo(c(x + w), c(y + h));
          ctx.closePath();
        },
        turn,
      );
    },
    disc(cx: number, cy: number, r: number, tone: Tone, turn = 0.5, shadow = true) {
      fill(tone, () => ctx.arc(c(cx), c(cy), c(r), 0, Math.PI * 2), turn, shadow);
    },
    /** Half a disc: a hill (`up`) or a bowl. */
    half(cx: number, cy: number, r: number, tone: Tone, up = true, turn = 0) {
      fill(
        tone,
        () => {
          ctx.arc(c(cx), c(cy), c(r), up ? Math.PI : 0, up ? Math.PI * 2 : Math.PI);
          ctx.closePath();
        },
        turn,
      );
    },
    pill(x: number, y: number, w: number, h: number, tone: Tone, shadow = true) {
      fill(tone, () => ctx.roundRect(c(x), c(y), c(w), c(h), c(Math.min(w, h) / 2)), 0, shadow);
    },
    block(x: number, y: number, w: number, h: number, tone: Tone, r = 0.06, shadow = true) {
      fill(tone, () => ctx.roundRect(c(x), c(y), c(w), c(h), c(r)), 0, shadow);
    },
    /** A twig with leaves, growing from a point, `lean` centimetres to the side at its tip. */
    twig(x: number, y: number, height: number, lean: number, tone: Color = sage, leaves = 7) {
      const at = (t: number): [number, number] => [x + lean * t * t, y - height * t];
      ctx.strokeStyle = '#6d6a60';
      ctx.lineWidth = c(0.05);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(c(x), c(y));
      ctx.quadraticCurveTo(c(x), c(y - height * 0.5), c(x + lean), c(y - height));
      ctx.stroke();
      for (let i = 0; i < leaves; i += 1) {
        const t = 0.3 + (i / (leaves - 1)) * 0.7;
        const [lx, ly] = at(t);
        const side = i % 2 === 0 ? -1 : 1;
        const size = height * 0.13 * (1.15 - t * 0.45);
        const slope = Math.atan2(-height, 2 * lean * t);
        ctx.save();
        ctx.translate(c(lx), c(ly));
        ctx.rotate(slope + side * 0.75);
        ctx.fillStyle = tone;
        ctx.beginPath();
        ctx.ellipse(c(size), 0, c(size), c(size * 0.42), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    },
    /** A thin drawn line: part of a circle. */
    arc(cx: number, cy: number, r: number, from: number, to: number, tone: Color = stone) {
      ctx.strokeStyle = tone;
      ctx.lineWidth = c(0.035);
      ctx.beginPath();
      ctx.arc(c(cx), c(cy), c(r), from, to);
      ctx.stroke();
    },
  };
  return things;
}

type Stage = ReturnType<typeof stage>;

/** A wall (linen, faintly woven) and what stands before it. */
function room(seed: number, wall: Color, set?: (s: Stage) => void): Shape {
  const surface = paint(PAGE, PXL);
  const { ctx, w, h, px } = surface;
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);
  const [warp, weft, cloud] = [noise(seed), noise(seed + 1), noise(seed + 2)];
  const image = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const shade =
        1 +
        (warp(x / 1.6, y / 70, 2) - 0.5) * 0.028 +
        (weft(x / 70, y / 1.6, 2) - 0.5) * 0.028 +
        (cloud(x / 420, y / 420, 3) - 0.5) * 0.035;
      const i = (y * w + x) * 4;
      image.data[i] = image.data[i]! * shade;
      image.data[i + 1] = image.data[i + 1]! * shade;
      image.data[i + 2] = image.data[i + 2]! * shade;
    }
  }
  ctx.putImageData(image, 0, 0);
  set?.(stage(ctx, px));
  grain(surface, 0.018, seed + 3);
  // Seeds keep every wall its own.
  rng(seed);
  return { t: 'image', ...page, src: jpeg(surface, 82) };
}

const card = (x: number, y: number, w: number, h: number): Shape => ({
  t: 'rect',
  x,
  y,
  w,
  h,
  r: 0.7,
  fill: '#fdfaf4',
  shadow: { dx: 0.08, dy: 0.16, blur: 0.5, opacity: 0.16, color: '#70583e' },
});

const dash = (x: number, y: number, color: Color = rose, length = 1.3): Shape => ({
  t: 'rect',
  x,
  y,
  w: length,
  h: 0.14,
  r: 0.07,
  fill: color,
});

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: linen,
    shapes: [
      room(1, linen, (s) => {
        s.disc(24.4, 3.7, 1.5, straw, 0, false);
        s.arch(16.4, 4.4, 4, 8.1, fjord);
        s.disc(22.3, 10.1, 2.4, 'wood', 0.5);
        s.arch(19.2, 8.1, 3, 4.4, rose);
        s.twig(25.6, 10.9, 4.6, 0.9);
        s.half(25.6, 10.9, 1.05, '#efe6d6', false);
        s.block(13.6, 12.5, 14.8, 0.5, 'wood', 0.04);
      }),
      dash(2.5, 10.1),
    ],
    title: { x: 2.4, y: 3.4, w: 11.6, h: 6.2, size: 62, sample: 'Ein ruhiger\nAnfang' },
    subtitle: { x: 2.5, y: 10.7, w: 10.6, h: 1.5, sample: 'Wohnen mit wenig, aber gern' },
  },
  {
    name: 'Abschnitt',
    bg: oat,
    shapes: [
      room(2, oat, (s) => {
        s.arc(7.2, 8.2, 5.3, Math.PI * 1.02, Math.PI * 1.98);
        s.arch(3, 4, 8.4, 12.4, rose);
        s.disc(11.2, 11.9, 2.6, 'wood', 0.9);
        s.disc(4.5, 12.6, 1.2, '#f6f1e8');
      }),
      dash(14.6, 9.5, fjord),
    ],
    title: { x: 14.5, y: 3.8, w: 11.8, h: 5.2, size: 56, sample: 'Licht und\nMaterial' },
    subtitle: { x: 14.6, y: 10.1, w: 11.4, h: 1.5, sample: 'Der zweite Teil' },
  },
  {
    name: 'Inhalt',
    bg: linen,
    shapes: [
      room(3, linen, (s) => {
        s.half(24.2, 13.1, 2.1, 'wood', true, 0.2);
        s.disc(21.9, 12.3, 0.8, fjord);
        s.twig(25.9, 13.1, 3.4, -0.7, sage, 6);
        s.block(19.6, 13.1, 8.9, 0.34, '#e9dfcf', 0.04);
      }),
      dash(2.5, 1.5),
    ],
    title: {
      x: 2.4,
      y: 1.8,
      w: 22,
      h: 2,
      valign: 'middle',
      size: 38,
      sample: 'Was ein Raum wirklich braucht',
    },
    body: {
      x: 2.5,
      y: 4.5,
      w: 17.4,
      h: 9.6,
      sample: [
        'Tageslicht von zwei Seiten',
        'Holz, das man anfassen möchte',
        'Einen Platz für jede Sache',
        'Stoffe, die Geräusche schlucken',
        'Eine Ecke, in der nichts steht',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: linen,
    shapes: [
      room(4, linen, (s) => {
        s.arch(14, 0.9, 13, 13.4, oat);
        s.disc(14.9, 12.6, 1.1, rose);
        s.block(12.6, 14.3, 15.8, 0.4, 'wood', 0.04);
      }),
      dash(2.5, 1.5, fjord),
    ],
    title: { x: 2.4, y: 1.8, w: 10.8, h: 2, valign: 'middle', size: 38, sample: 'Die Fensterbank' },
    body: {
      x: 2.5,
      y: 4.5,
      w: 10.4,
      h: 9.4,
      sample: ['Tief genug zum Sitzen', 'Eiche, nur geölt', 'Morgens der hellste Ort'],
    },
    pictures: [{ x: 15.7, y: 4, w: 9.6, h: 9.6 }],
  },
  {
    name: 'Zwei Spalten',
    bg: oat,
    shapes: [
      room(5, oat, (s) => {
        s.disc(4.2, 4.6, 1.5, fjord);
        s.half(23.4, 4.75, 1.7, rose);
      }),
      card(1.9, 4.6, 11.7, 9.8),
      card(14.4, 4.6, 11.7, 9.8),
      dash(2.5, 1.5, dusk),
    ],
    title: {
      x: 2.4,
      y: 1.8,
      w: 22,
      h: 2,
      valign: 'middle',
      size: 38,
      sample: 'Sommerhaus und Stadtwohnung',
    },
    body: [
      {
        x: 2.9,
        y: 5.9,
        w: 9.9,
        h: 7.8,
        sample: ['Türen stehen offen', 'Barfuß auf Dielen', 'Abends lange hell'],
      },
      {
        x: 15.4,
        y: 5.9,
        w: 9.9,
        h: 7.8,
        sample: ['Kerzen ab vier Uhr', 'Wolle auf dem Sofa', 'Ein Stuhl am Fenster'],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: linen,
    shapes: [
      room(6, linen, (s) => {
        s.arc(8.7, 7.9, 6.3, Math.PI * 0.55, Math.PI * 1.45);
        s.half(12.6, 12.6, 3, 'wood', true, 0.3);
        s.disc(8.7, 7.7, 5.1, fjord);
        s.disc(14.2, 4.1, 0.9, rose);
        s.block(1.6, 12.6, 16.6, 0.4, '#e9dfcf', 0.04);
      }),
      dash(17.9, 5.3, rose),
    ],
    title: {
      x: 4.2,
      y: 4.7,
      w: 9,
      h: 6,
      valign: 'middle',
      align: 'center',
      size: 112,
      color: '#fbf8f2',
      sample: '18°',
    },
    body: {
      x: 17.8,
      y: 6,
      w: 8.4,
      h: 6,
      size: 23,
      sample: 'So kühl schläft man im Norden am liebsten. Die Decke macht den Rest.',
    },
  },
  {
    name: 'Zitat',
    bg: linen,
    shapes: [
      room(7, linen, (s) => {
        s.disc(23.9, 3.1, 1.7, 'wood', 0.7);
        s.pill(3, 2.6, 22, 8.6, oat);
        s.twig(3.5, 13.9, 4.2, 0.9, sage, 7);
        s.twig(4.3, 13.9, 3, 1.3, '#c3b8a2', 5);
        s.half(4, 13.9, 0.95, rose, false);
      }),
      dash(13.35, 11.9, fjord),
    ],
    body: {
      x: 5.6,
      y: 3.4,
      w: 16.8,
      h: 7,
      valign: 'middle',
      align: 'center',
      font: 'Newsreader',
      italic: true,
      size: 33,
      lineHeight: 116,
      sample: '„Ein Zuhause ist fertig, wenn man nichts mehr wegräumen möchte.“',
    },
    subtitle: { x: 7, y: 12.4, w: 14, h: 1.5, align: 'center', sample: 'Liv Sandberg, Tischlerin' },
  },
  {
    name: 'Bild',
    bg: linen,
    shapes: [
      room(8, linen, (s) => {
        s.block(1.9, 1.3, 18.2, 13.1, '#fdfaf4', 0.12);
        s.arch(22.1, 2.2, 2.6, 3.6, fjord);
        s.disc(25.2, 4.9, 0.9, 'wood', 0.6);
        s.block(21.2, 5.8, 5.6, 0.3, '#e9dfcf', 0.04);
      }),
      dash(21.3, 8.3),
    ],
    pictures: [{ x: 2.4, y: 1.8, w: 17.2, h: 12.1 }],
    title: {
      x: 21.2,
      y: 8.8,
      w: 5.4,
      h: 5.4,
      valign: 'top',
      size: 27,
      lineHeight: 112,
      sample: 'Morgenlicht in der Küche',
    },
  },
  {
    name: 'Schluss',
    bg: oat,
    shapes: [
      room(9, oat, (s) => {
        s.disc(19.6, 10.4, 4.3, rose, 0, false);
        s.arch(14.4, 6.2, 2.8, 4.2, fjord);
        s.twig(24.6, 10.4, 4.4, 1, sage, 7);
        s.half(24.6, 10.4, 1, '#f6f1e8', false);
        s.block(-0.4, 10.4, 28.8, 5.8, linen, 0, false);
        s.block(-0.4, 10.4, 28.8, 0.5, 'wood', 0);
      }),
      dash(2.5, 9.2, dusk),
    ],
    title: { x: 2.4, y: 3, w: 11.4, h: 5.8, size: 60, sample: 'Danke fürs\nZuhören' },
    subtitle: { x: 2.5, y: 11.8, w: 14, h: 1.5, sample: 'Jetzt ist Zeit für Fragen' },
  },
];

const template: Template = {
  slug: 'skandinavisch',
  name: 'Skandinavisch',
  group: 'Bereich',
  tags: [
    'Skandinavisch',
    'Nordisch',
    'Hygge',
    'Holz',
    'ruhig',
    'hell',
    'Wohnen',
    'Interior',
    'freundlich',
  ],
  description:
    'Nordische Ruhe: leinenweiße Wand, ein Bord aus hellem Holz und darauf wenige schlichte Formen in Hafer, Blaugrau und Altrosa.',
  palette: {
    bg: linen,
    text: coal,
    bg2: oat,
    text2: stone,
    accents: [fjord, rose, birch, sage, straw, dusk],
  },
  fonts: { head: 'Newsreader', body: 'Karla' },
  text: {
    title: { font: 'Newsreader', size: 56, color: coal, lineHeight: 102 },
    subtitle: { font: 'Karla', size: 18, color: stone },
    body: { font: 'Karla', size: 21, color: coal, lineHeight: 126, paraSpace: 0.38 },
  },
  layouts,
};

export default template;
