import type {
  AccentColor,
  Anchor,
  DeckSource,
  ImportState,
  Point,
  Shape,
  Stroke,
} from '@slider/shared';

/**
 * Demo content matching the Figma design. Pure data; `seed.ts` turns it into rows.
 * Times are relative to "now" so the overview always reads "vor 5 Min." etc.
 */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

// ── People ──────────────────────────────────────────────────────────────────

export type PersonKey = 'robert' | 'lena' | 'max' | 'anna';

export interface PersonSeed {
  name: string;
  email: string;
  color: AccentColor;
}

/** Robert's name and e-mail come from the dev-owner config, so the seeded decks are "yours". */
export const PEOPLE: Record<Exclude<PersonKey, 'robert'>, PersonSeed> & {
  robert: Omit<PersonSeed, 'name' | 'email'>;
} = {
  robert: { color: 'red' },
  lena: {
    name: 'Lena Wolf',
    email: 'lena.wolf@q4-team.de',
    color: 'blue',
  },
  max: {
    name: 'Max Kern',
    email: 'max.kern@q4-team.de',
    color: 'violet',
  },
  anna: {
    name: 'Anna Becker',
    email: 'anna.becker@q4-team.de',
    color: 'yellow',
  },
};

// ── Slides ──────────────────────────────────────────────────────────────────

export type SlideImage = 1 | 2 | 3 | 4;

interface SlideTemplate {
  title: string;
  shapes: Shape[];
}

const shape = (id: string, name: string, bbox: Shape['bbox'], text = ''): Shape => ({
  id,
  name,
  bbox,
  text,
});

/** One template per demo image in `seed/assets/slide-<n>.png` (1920×1080). */
export const SLIDE_TEMPLATES: Record<SlideImage, SlideTemplate> = {
  1: {
    title: 'Presentation title',
    shapes: [
      shape('2', 'Titel 1', { x: 0.03, y: 0.7, w: 0.4, h: 0.09 }, 'Presentation title'),
      shape('3', 'Untertitel 2', { x: 0.03, y: 0.8, w: 0.45, h: 0.04 }, 'Subtitle'),
      shape('4', 'Bild 3', { x: 0.03, y: 0.06, w: 0.94, h: 0.6 }),
    ],
  },
  2: {
    title: 'Information table',
    shapes: [
      shape('2', 'Titel 1', { x: 0.05, y: 0.07, w: 0.6, h: 0.1 }, 'Information table'),
      shape('4', 'Tabelle 3', { x: 0.05, y: 0.23, w: 0.9, h: 0.64 }),
    ],
  },
  3: {
    title: 'Agenda',
    shapes: [
      shape('2', 'Titel 1', { x: 0.07, y: 0.1, w: 0.4, h: 0.12 }, 'Agenda'),
      shape(
        '3',
        'Textplatzhalter 2',
        { x: 0.07, y: 0.3, w: 0.5, h: 0.55 },
        'Ausgangslage\nZiele\nMaßnahmen\nNächste Schritte',
      ),
    ],
  },
  4: {
    title: 'Add a title',
    shapes: [
      shape('4', 'Bild 3', { x: 0, y: 0, w: 0.5, h: 1 }),
      shape('2', 'Titel 1', { x: 0.56, y: 0.4, w: 0.38, h: 0.12 }, 'Add a title'),
    ],
  },
};

/** `count` slides cycling through the four images, starting with `first`. */
export function cycleSlides(count: number, first: SlideImage): SlideImage[] {
  return Array.from({ length: count }, (_, i) => (((first - 1 + i) % 4) + 1) as SlideImage);
}

// ── Comments ────────────────────────────────────────────────────────────────

/** Like {@link Anchor}, but a gap names its neighbours by 1-based slide position. */
export type SeedAnchor =
  Exclude<Anchor, { type: 'gap' }> | { type: 'gap'; after: number; before: number };

export interface ReplySeed {
  author: PersonKey;
  body: string;
  ago: number;
}

export interface CommentSeed {
  /** 1-based slide position; `null` for gap comments. */
  slide: number | null;
  author: PersonKey;
  body: string;
  /** Milliseconds before now, or an absolute date. */
  ago: number | Date;
  anchor: SeedAnchor;
  strokes?: Stroke[];
  resolvedBy?: PersonKey;
  /** Set for comments that came from the PowerPoint file. */
  pptxId?: string;
  replies?: ReplySeed[];
}

const pin = (x: number, y: number): SeedAnchor => ({
  type: 'point',
  point: { x, y },
  shapeRef: null,
});
const frame = (x: number, y: number, w: number, h: number): SeedAnchor => ({
  type: 'rect',
  rect: { x, y, w, h },
  shapeRef: null,
});
const wholeSlide: SeedAnchor = { type: 'slide' };

/** A hand-drawn-looking rectangle: closed path with a little deterministic wobble. */
function roughRect(x: number, y: number, w: number, h: number): Point[] {
  const corners: Point[] = [
    { x, y },
    { x: x + w, y: y + 0.006 },
    { x: x + w - 0.004, y: y + h },
    { x: x + 0.003, y: y + h - 0.005 },
    { x: x + 0.002, y: y + 0.004 },
  ];
  return corners.flatMap((corner, i) => {
    const next = corners[i + 1];
    if (!next) return [corner];
    return [corner, { x: (corner.x + next.x) / 2 + 0.002, y: (corner.y + next.y) / 2 - 0.002 }];
  });
}

/** A circle that looks round on a 16:9 slide (normalised y is stretched). */
function circle(cx: number, cy: number, r: number, steps = 32): Point[] {
  const ry = (r * 16) / 9;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = (i / steps) * Math.PI * 2;
    return { x: cx + r * Math.cos(angle), y: cy + ry * Math.sin(angle) };
  });
}

/** Drawn in the author's colour – it matches the comment's connector line. */
const pen = (points: Point[], color: AccentColor): Stroke => ({
  tool: 'pen',
  color,
  points,
});

/** October 3rd of the current year (or last year, early in the year). */
function thirdOfOctober(now: Date): Date {
  const date = new Date(now.getFullYear(), 9, 3, 9, 41);
  if (date > now) date.setFullYear(date.getFullYear() - 1);
  return date;
}

const Q4_COMMENTS = (now: Date): CommentSeed[] => [
  {
    slide: 1,
    author: 'anna',
    body: 'Bildquelle fehlt – bitte im Footer ergänzen.',
    ago: thirdOfOctober(now),
    anchor: pin(0.03, 0.05),
    pptxId: '{6A1F9C3E-2B7D-4E0A-9F51-3C8E2D7B4A10}',
  },
  {
    slide: 1,
    author: 'lena',
    body: 'Farben passen nicht zur CI – das Blau ist zu hell und der Verlauf oben wirkt fremd.',
    ago: 2 * HOUR,
    anchor: pin(0.35, 0.12),
    replies: [
      { author: 'robert', body: 'Ich passe das Blau an die CI-Palette an.', ago: 52 * MINUTE },
      { author: 'anna', body: 'Mit CI-Blau – so?', ago: 40 * MINUTE },
      { author: 'lena', body: 'Ja, genau so. Danke!', ago: 31 * MINUTE },
      {
        author: 'max',
        body: '@Robert Hofmann kannst du die Palette bis morgen anpassen?',
        ago: 4 * MINUTE,
      },
    ],
  },
  {
    slide: 1,
    author: 'lena',
    body: 'Diese beiden Flächen wirken unruhig.',
    ago: 1 * HOUR,
    anchor: frame(0.58, 0.4, 0.36, 0.33),
    strokes: [
      pen(roughRect(0.6, 0.43, 0.15, 0.26), 'blue'),
      pen(roughRect(0.77, 0.44, 0.15, 0.25), 'blue'),
    ],
  },
  {
    slide: 1,
    author: 'anna',
    body: 'So eher? Den Steg stärker ins Bild rücken.',
    ago: 20 * MINUTE,
    anchor: pin(0.78, 0.3),
    strokes: [pen(circle(0.78, 0.3, 0.08), 'yellow')],
  },
  {
    slide: 1,
    author: 'robert',
    body: 'Kontrast oben rechts erhöhen.',
    ago: 12 * MINUTE,
    anchor: pin(0.97, 0.04),
  },
  {
    slide: 1,
    author: 'max',
    body: 'Logo fehlt unten rechts.',
    ago: 8 * MINUTE,
    anchor: frame(0.88, 0.83, 0.08, 0.07),
  },
  {
    slide: 1,
    author: 'max',
    body: 'Die Headline ist zu lang – kürzen auf eine Zeile?',
    ago: 5 * MINUTE,
    anchor: frame(0.03, 0.7, 0.3, 0.09),
  },
  {
    slide: 2,
    author: 'max',
    body: 'Tabellenkopf fett setzen.',
    ago: 3 * HOUR,
    anchor: frame(0.05, 0.23, 0.9, 0.08),
    resolvedBy: 'robert',
  },
  {
    slide: 2,
    author: 'lena',
    body: 'Die Summenzeile fehlt.',
    ago: 90 * MINUTE,
    anchor: pin(0.5, 0.84),
  },
  {
    slide: 3,
    author: 'anna',
    body: 'Punkt „Budget“ in der Agenda ergänzen?',
    ago: 70 * MINUTE,
    anchor: pin(0.3, 0.6),
  },
  {
    slide: null,
    author: 'anna',
    body: 'Hier fehlt eine Folie mit den Zahlen aus Q3.',
    ago: 45 * MINUTE,
    anchor: { type: 'gap', after: 3, before: 4 },
  },
  {
    slide: 4,
    author: 'max',
    body: 'Bildausschnitt enger wählen.',
    ago: 25 * MINUTE,
    anchor: frame(0.05, 0.1, 0.4, 0.8),
  },
];

const FEEDBACK = [
  'Zahl bitte mit dem Controlling abgleichen.',
  'Schrift wirkt hier zu klein.',
  'Quelle ergänzen.',
  'Können wir das Diagramm vereinfachen?',
  'Tippfehler in der Überschrift.',
  'Bild ist unscharf – bitte in höherer Auflösung.',
  'Diese Folie ist sehr textlastig.',
  'Farben an die CI anpassen.',
];
const REVIEWERS: PersonKey[] = ['lena', 'max', 'anna'];

/** `count` simple comments spread over the deck, newest last. */
function feedback(
  count: number,
  slideCount: number,
  options: { done?: boolean; newestAgo: number },
): CommentSeed[] {
  return Array.from({ length: count }, (_, i) => ({
    slide: ((i * 3) % slideCount) + 1,
    author: REVIEWERS[i % REVIEWERS.length] ?? 'lena',
    body: FEEDBACK[i % FEEDBACK.length] ?? '',
    ago: options.newestAgo + (count - i) * 37 * MINUTE,
    anchor: i % 3 === 2 ? wholeSlide : pin(0.2 + ((i * 0.17) % 0.6), 0.25 + ((i * 0.23) % 0.5)),
    ...(options.done ? { resolvedBy: 'robert' as const } : {}),
  }));
}

// ── Decks ───────────────────────────────────────────────────────────────────

export interface DeckSeed {
  title: string;
  source: DeckSource;
  slides: SlideImage[];
  revisionNumber: number;
  importState: ImportState;
  updatedAgo: number;
  comments: CommentSeed[];
  /** Adds an active comment link, so the share dialog has something to show. */
  withReviewLink?: boolean;
}

export function demoDecks(now: Date): DeckSeed[] {
  const ready: ImportState = { status: 'ready' };
  return [
    {
      title: 'Q4 Strategie',
      source: 'onedrive',
      slides: [1, 2, 3, 4, 1, 2, 4, 3, 1, 2, 3, 4],
      revisionNumber: 1,
      importState: ready,
      updatedAgo: 4 * MINUTE,
      comments: Q4_COMMENTS(now),
      withReviewLink: true,
    },
    {
      title: 'Produkt-Roadmap 2027',
      source: 'sharepoint',
      slides: cycleSlides(18, 2),
      revisionNumber: 1,
      importState: { status: 'running', step: 'comments', progress: { done: 31, total: 52 } },
      updatedAgo: 20 * MINUTE,
      comments: [],
    },
    {
      title: 'Board Meeting November',
      source: 'onedrive',
      slides: cycleSlides(12, 3),
      revisionNumber: 3,
      importState: ready,
      updatedAgo: 3 * HOUR,
      comments: feedback(8, 12, { newestAgo: 3 * HOUR }),
    },
    {
      title: 'Kampagne Frühjahr',
      source: 'onedrive',
      slides: cycleSlides(9, 4),
      revisionNumber: 1,
      importState: ready,
      updatedAgo: 1 * DAY,
      comments: feedback(4, 9, { done: true, newestAgo: 1 * DAY }),
    },
    {
      title: 'Q3 Review',
      source: 'sharepoint',
      slides: cycleSlides(31, 2),
      revisionNumber: 1,
      importState: ready,
      updatedAgo: 3 * DAY,
      comments: feedback(3, 31, { newestAgo: 3 * DAY }),
    },
    {
      title: 'Onboarding Vertrieb',
      source: 'onedrive',
      slides: cycleSlides(15, 1),
      revisionNumber: 1,
      importState: ready,
      updatedAgo: 7 * DAY,
      comments: feedback(1, 15, { newestAgo: 7 * DAY }),
    },
  ];
}
