import { paint, samplePicture, stencil } from '../art';
import type { Box, Color, Layout, Picture, Shape, Template } from '../model';
import { PAGE } from '../model';
import { page, ring } from '../shapes';

/*
 * Op Art: nothing but black and white, set so that the eye starts to move – stripes that swell,
 * a chessboard that bulges, rings that fall into a tunnel. The words stand on calm solid fields.
 */

const black = '#0a0a0a';
const white = '#ffffff';
const grey = '#a8a8a8';

const frac = (value: number) => value - Math.floor(value);

/**
 * A pattern of one colour: `ink` says for a place (centimetres in the box) whether it is printed.
 * Each pixel asks nine times, so edges come out smooth.
 */
function pattern(
  size: { w: number; h: number },
  color: Color,
  ink: (x: number, y: number) => boolean,
  px = 60,
): Picture {
  const surface = paint(size, px);
  const { ctx, w, h } = surface;
  const image = ctx.createImageData(w, h);
  const taps = [1 / 6, 3 / 6, 5 / 6];
  for (let py = 0; py < h; py += 1) {
    for (let pxl = 0; pxl < w; pxl += 1) {
      let hits = 0;
      for (const dy of taps)
        for (const dx of taps) if (ink((pxl + dx) / px, (py + dy) / px)) hits += 1;
      image.data[(py * w + pxl) * 4 + 3] = (hits / 9) * 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return stencil(surface, color, 16);
}

/** Where a place is seen through a lens lying on the plane: the middle swells. */
const lens = (cx: number, cy: number, radius: number, power = 0.62) => {
  return (x: number, y: number): [number, number] => {
    const d = Math.hypot(x - cx, y - cy) / radius;
    if (d >= 1) return [x, y];
    const k = 1 - power * (1 - d * d) ** 1.5;
    return [cx + (x - cx) * k, cy + (y - cy) * k];
  };
};

/** Upright stripes that sway more and more towards the bottom. */
const swaying = (color: Color) =>
  pattern(PAGE, color, (x, y) => {
    const depth = 0.25 + 0.75 * (y / PAGE.h);
    return frac(x / 0.62 + 1.25 * depth * Math.sin(y / 2.3 + x / 4.4)) < 0.5;
  });

/** A chessboard with a ball pushing up under it. */
const bulge = pattern(PAGE, black, (x, y) => {
  const [u, v] = lens(7.4, 7.9, 7.6, 0.72)(x, y);
  return (Math.floor(u / 1.22 + 0.5) + Math.floor(v / 1.22 + 0.04)) % 2 === 0;
});

/** Rings falling into a tunnel that lies off the middle. */
const tunnel = pattern(PAGE, white, (x, y) => {
  const [dx, dy] = [x - 14, y - 7.9];
  const r = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  return frac((r * (1 + 0.32 * Math.cos(angle - 0.6))) ** 0.62 * 2.35) < 0.5;
});

/** Level stripes over which a lens lies. */
const swell = pattern({ w: 13, h: PAGE.h }, white, (x, y) => {
  const [, v] = lens(6.9, 7.9, 5.9, 0.7)(x, y);
  return frac(v / 0.66) < 0.5;
});

/** A ribbon of fine stripes that ripples along its length. */
const ribbon = (color: Color, upright: boolean) =>
  pattern(upright ? { w: 2.6, h: PAGE.h } : { w: PAGE.w, h: 2.6 }, color, (x, y) => {
    const [along, across] = upright ? [y, x] : [x, y];
    return frac(along / 0.5 + 0.85 * Math.sin((across / 2.6) * Math.PI * 2 + along / 2.7)) < 0.5;
  });

const stripesBlack = swaying(black);
const ribbonAcross = ribbon(black, false);
const ribbonDown = ribbon(black, true);
const ribbonDownWhite = ribbon(white, true);

/** Bars that get thinner and closer, as if the plane turned away. */
function receding(
  box: Box,
  count: number,
  fill: Color,
  towards: 'right' | 'left' = 'right',
): Shape[] {
  const ratio = 0.84;
  const total = (1 - ratio ** count) / (1 - ratio);
  const shapes: Shape[] = [];
  let at = 0;
  for (let index = 0; index < count; index += 1) {
    const step = (box.w * ratio ** index) / total;
    const x = towards === 'right' ? box.x + at : box.x + box.w - at - step * 0.5;
    shapes.push({ t: 'rect', x, y: box.y, w: step * 0.5, h: box.h, fill });
    at += step;
  }
  return shapes;
}

const layouts: Layout[] = [
  {
    name: 'Titel',
    bg: white,
    shapes: [
      { t: 'image', ...page, src: stripesBlack },
      { t: 'rect', x: 1.9, y: 3.1, w: 16.6, h: 7.4, fill: white },
      { t: 'rect', x: 1.9, y: 10.5, w: 16.6, h: 2, fill: black },
    ],
    title: {
      x: 2.9,
      y: 3.5,
      w: 14.8,
      h: 6.6,
      valign: 'middle',
      size: 60,
      sample: 'Das Auge\ndenkt mit',
    },
    subtitle: {
      x: 2.9,
      y: 10.6,
      w: 14.8,
      h: 1.8,
      valign: 'middle',
      color: white,
      sample: 'Ein Vortrag über Wahrnehmung',
    },
  },
  {
    name: 'Abschnitt',
    bg: black,
    shapes: [
      { t: 'image', x: 15, y: 0, w: 13, h: PAGE.h, src: swell },
      { t: 'rect', x: 1.9, y: 4.5, w: 3.2, h: 0.24, fill: white },
    ],
    title: {
      x: 1.9,
      y: 5.2,
      w: 12.2,
      h: 4.6,
      valign: 'middle',
      size: 50,
      color: white,
      sample: 'Linie wird\nBewegung',
    },
    subtitle: { x: 1.9, y: 10.2, w: 12.2, h: 1.5, color: grey, sample: 'Teil zwei' },
  },
  {
    name: 'Inhalt',
    bg: white,
    shapes: [
      { t: 'image', x: 0, y: 0, w: 2.6, h: PAGE.h, src: ribbonDown },
      { t: 'rect', x: 4, y: 3.55, w: 3.2, h: 0.2, fill: black },
    ],
    title: {
      x: 4,
      y: 1,
      w: 22,
      h: 2.3,
      valign: 'middle',
      size: 36,
      sample: 'Was das Auge ergänzt',
    },
    body: {
      x: 4,
      y: 4.4,
      w: 21.6,
      h: 9.9,
      sample: [
        'Gleiche Abstände wirken ruhig',
        'Kleine Abweichungen erzeugen Bewegung',
        'Kontrast lässt Kanten flimmern',
        'Das Gehirn sucht Tiefe in jeder Fläche',
        'Wer lange hinsieht, sieht mehr als da ist',
      ],
    },
  },
  {
    name: 'Text und Bild',
    bg: white,
    shapes: [
      { t: 'rect', x: 15.2, y: 0, w: 12.8, h: PAGE.h, fill: black },
      ...receding({ x: 12.6, y: 0, w: 2.6, h: PAGE.h }, 9, black, 'left'),
      { t: 'rect', x: 1.9, y: 3.75, w: 3.2, h: 0.2, fill: black },
    ],
    title: {
      x: 1.9,
      y: 1,
      w: 10.2,
      h: 2.5,
      valign: 'middle',
      size: 30,
      sample: 'Fläche wird Raum',
    },
    body: {
      x: 1.9,
      y: 4.5,
      w: 10.2,
      h: 9.8,
      size: 20,
      sample: [
        'Linien verdichten sich',
        'Die Fläche kippt nach hinten',
        'Das Bild beginnt zu atmen',
      ],
    },
    pictures: [{ x: 16.1, y: 0.9, w: 11, h: 13.95 }],
  },
  {
    name: 'Zwei Spalten',
    bg: white,
    shapes: [
      ...receding({ x: 19.6, y: 0, w: 8.4, h: 4.1 }, 14, black),
      { t: 'rect', x: 0, y: 4.1, w: PAGE.w, h: 0.2, fill: black },
      ...receding({ x: 12.5, y: 4.3, w: 1.5, h: PAGE.h - 4.3 }, 7, black, 'right'),
      ...receding({ x: 14, y: 4.3, w: 1.5, h: PAGE.h - 4.3 }, 7, black, 'left'),
    ],
    title: {
      x: 1.9,
      y: 1,
      w: 16.8,
      h: 2.3,
      valign: 'middle',
      size: 36,
      sample: 'Schwarz gegen Weiß',
    },
    body: [
      {
        x: 1.9,
        y: 5.3,
        w: 9.8,
        h: 9,
        size: 20,
        sample: [
          'Weiß tritt nach vorn',
          'Linien wirken dünner',
          'Die Fläche bleibt offen',
          'Ruhe für lange Texte',
        ],
      },
      {
        x: 16.6,
        y: 5.3,
        w: 9.8,
        h: 9,
        size: 20,
        sample: [
          'Schwarz zieht zurück',
          'Linien wirken kräftiger',
          'Die Fläche schließt sich',
          'Kraft für kurze Zeilen',
        ],
      },
    ],
  },
  {
    name: 'Kennzahl',
    bg: white,
    shapes: [
      { t: 'image', ...page, src: bulge },
      { t: 'rect', x: 15.4, y: 0, w: 12.6, h: PAGE.h, fill: black },
      { t: 'rect', x: 16.8, y: 8.5, w: 3.2, h: 0.24, fill: white },
    ],
    title: {
      x: 16.8,
      y: 2.4,
      w: 10,
      h: 5.6,
      valign: 'bottom',
      size: 104,
      color: white,
      sample: '83 %',
    },
    body: {
      x: 16.8,
      y: 9.3,
      w: 9.6,
      h: 4.8,
      size: 22,
      color: white,
      sample: 'aller Eindrücke nimmt der Mensch über die Augen auf.',
    },
  },
  {
    name: 'Zitat',
    bg: white,
    shapes: [
      { t: 'image', x: 0, y: 0, w: PAGE.w, h: 2.6, src: ribbonAcross },
      { t: 'image', x: 0, y: PAGE.h - 2.6, w: PAGE.w, h: 2.6, src: ribbonAcross, rotate: 180 },
      { t: 'rect', x: 12.4, y: 10.55, w: 3.2, h: 0.2, fill: black },
    ],
    body: {
      x: 3,
      y: 3.5,
      w: 22,
      h: 6.6,
      valign: 'middle',
      align: 'center',
      font: 'Archivo Black',
      size: 34,
      lineHeight: 118,
      sample: 'Je genauer man hinsieht, desto mehr gerät das Bild in Bewegung.',
    },
    subtitle: {
      x: 3,
      y: 11,
      w: 22,
      h: 1.4,
      align: 'center',
      valign: 'middle',
      color: '#4a4a4a',
      sample: 'Notiz aus dem Atelier',
    },
  },
  {
    name: 'Bild',
    bg: black,
    shapes: [{ t: 'image', x: PAGE.w - 2.6, y: 0, w: 2.6, h: PAGE.h, src: ribbonDownWhite }],
    pictures: [{ x: 1.4, y: 1.3, w: 22.4, h: 10.9 }],
    title: {
      x: 1.4,
      y: 12.6,
      w: 22.4,
      h: 2,
      valign: 'middle',
      size: 28,
      color: white,
      sample: 'Stillstand, der flimmert',
    },
  },
  {
    name: 'Schluss',
    bg: black,
    shapes: [
      { t: 'image', ...page, src: tunnel },
      { t: 'ellipse', x: 9.4, y: 3.3, w: 9.2, h: 9.2, fill: white },
      ring(14, 7.9, 4.6, { color: black, width: 0.22 }),
    ],
    title: {
      x: 10,
      y: 5.3,
      w: 8,
      h: 3.2,
      valign: 'bottom',
      align: 'center',
      size: 46,
      sample: 'Danke',
    },
    subtitle: {
      x: 10.4,
      y: 8.7,
      w: 7.2,
      h: 1.6,
      align: 'center',
      size: 17,
      color: black,
      sample: 'Augen auf. Fragen?',
    },
  },
];

const greys = ['#1c1c1c', '#555555', '#8a8a8a', '#bdbdbd', '#e4e4e4', '#f4f4f4'];

const template: Template = {
  slug: 'op-art',
  name: 'Op Art',
  group: 'Schwarzweiß',
  tags: [
    'Op Art',
    'Schwarzweiß',
    'optische Täuschung',
    'Streifen',
    'Geometrie',
    'Kontrast',
    'Design',
  ],
  description:
    'Reines Schwarzweiß, das sich bewegt: schwingende Streifen, ein gewölbtes Schachbrett und Ringe, die in die Tiefe ziehen.',
  palette: {
    bg: white,
    text: black,
    bg2: '#efefef',
    text2: '#4a4a4a',
    accents: ['#1f1f1f', '#6e6e6e', grey, '#d6d6d6', '#e4342b', '#f2c200'],
  },
  fonts: { head: 'Archivo Black', body: 'Archivo' },
  text: {
    title: { font: 'Archivo Black', size: 54, color: black, lineHeight: 104 },
    subtitle: { font: 'Archivo', size: 22, color: black },
    body: { font: 'Archivo', size: 22, color: black, lineHeight: 122, paraSpace: 0.35 },
  },
  layouts,
  samplePictures: [
    samplePicture({ w: 11, h: 13.95 }, greys, 2),
    samplePicture({ w: 22.4, h: 10.9 }, greys, 4),
  ],
};

export default template;
