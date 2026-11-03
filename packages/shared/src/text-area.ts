/*
 * Where a drawn shape lays out its text: LibreOffice puts it not in the shape's box but in the
 * first rectangle of its geometry's `draw:text-areas` (a hexagon's middle, an ellipse's inner
 * box), the padding inside that – as `EnhancedCustomShape2d::GetTextRect` does. Its corners are
 * numbers, modifiers (`$0`) or equations (`?f3`, `draw:equation`) of the viewBox.
 */

/** A shape's text area as insets of its box, each a share of the box's width or height. */
export interface TextAreaInset {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What `draw:enhanced-geometry` says about the text area. */
export interface ShapeGeometry {
  /** `draw:type`: LibreOffice's preset; a geometry without its own text area takes the preset's. */
  type?: string;
  viewBox?: string;
  modifiers?: string;
  textAreas?: string;
  /**
   * `draw:path-stretchpoint-x`/`-y`: a shape longer that way keeps its corners (a rounded
   * rectangle's), only what lies beyond this point moves out with the box.
   */
  stretchX?: string;
  stretchY?: string;
  /** `draw:equation`s by name. */
  equations?: Record<string, string>;
}

/** The text areas LibreOffice gives the presets a new box can take (as it writes them out). */
const PRESETS: Record<string, Required<Pick<ShapeGeometry, 'textAreas'>> & ShapeGeometry> = {
  'round-rectangle': {
    modifiers: '3600',
    stretchX: '10800',
    stretchY: '10800',
    textAreas: '?f3 ?f4 ?f5 ?f6',
    equations: {
      f0: '45',
      f1: '$0 *sin(?f0 *(pi/180))',
      f2: '?f1 *3163/7636',
      f3: 'left+?f2',
      f4: 'top+?f2',
      f5: 'right-?f2',
      f6: 'bottom-?f2',
    },
  },
  ellipse: { textAreas: '3163 3163 18437 18437' },
  'isosceles-triangle': {
    modifiers: '10800',
    textAreas: '?f1 10800 ?f2 18000 ?f3 7200 ?f4 21600',
    equations: { f1: '$0 /2', f2: '?f1 +10800', f3: '$0 *2/3', f4: '?f3 +7200' },
  },
  diamond: { textAreas: '5400 5400 16200 16200' },
  hexagon: {
    modifiers: '5400',
    textAreas: '?f3 ?f3 ?f4 ?f4',
    equations: { f2: '$0 *100/234', f3: '?f2 +1700', f4: '21600-?f3' },
  },
  'right-arrow': {
    modifiers: '16200 5400',
    textAreas: '0 ?f0 ?f5 ?f2',
    equations: {
      f0: '$1',
      f1: '$0',
      f2: '21600-$1',
      f3: '21600-?f1',
      f4: '?f3 *?f0 /10800',
      f5: '?f1 +?f4',
    },
  },
  star5: { textAreas: '6722 8256 14878 15460' },
};

/** A token or formula LibreOffice's geometry has that these formulas cannot read. */
export class Unknown extends Error {}

/** Evaluates LibreOffice's custom shape formulas (ODF 1.3 §19.171). */
export class Formulas {
  private readonly values = new Map<string, number>();
  private readonly busy = new Set<string>();

  constructor(
    private readonly equations: Record<string, string>,
    private readonly modifiers: number[],
    private readonly names: Record<string, number>,
  ) {}

  /** A value of `draw:text-areas` (or a formula's atom): number, `$n`, `?name` or name. */
  value(token: string): number {
    const text = token.trim();
    if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return Number(text);
    if (text.startsWith('$')) {
      const modifier = this.modifiers[Number(text.slice(1))];
      if (modifier === undefined || !Number.isFinite(modifier)) throw new Unknown(text);
      return modifier;
    }
    if (text.startsWith('?')) return this.equation(text.slice(1));
    const named = this.names[text];
    if (named === undefined) throw new Unknown(text);
    return named;
  }

  private equation(name: string): number {
    const known = this.values.get(name);
    if (known !== undefined) return known;
    const formula = this.equations[name];
    if (formula === undefined || this.busy.has(name)) throw new Unknown(name);
    this.busy.add(name);
    const value = new Parser(formula, this).parse();
    this.busy.delete(name);
    this.values.set(name, value);
    return value;
  }
}

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  abs: Math.abs,
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  atan: Math.atan,
  atan2: (y, x) => Math.atan2(y, x),
  min: Math.min,
  max: Math.max,
  if: (test, yes, no) => (test > 0 ? yes : no),
};

/** One formula: sums of products of atoms, functions and brackets. */
class Parser {
  private at = 0;

  constructor(
    private readonly text: string,
    private readonly formulas: Formulas,
  ) {}

  parse(): number {
    const value = this.sum();
    this.space();
    if (this.at < this.text.length) throw new Unknown(this.text);
    return value;
  }

  private space() {
    while (this.text[this.at] === ' ') this.at++;
  }

  private sum(): number {
    let value = this.product();
    for (;;) {
      this.space();
      const op = this.text[this.at];
      if (op !== '+' && op !== '-') return value;
      this.at++;
      const next = this.product();
      value = op === '+' ? value + next : value - next;
    }
  }

  private product(): number {
    let value = this.unary();
    for (;;) {
      this.space();
      const op = this.text[this.at];
      if (op !== '*' && op !== '/') return value;
      this.at++;
      const next = this.unary();
      value = op === '*' ? value * next : value / next;
    }
  }

  private unary(): number {
    this.space();
    if (this.text[this.at] === '-') {
      this.at++;
      return -this.unary();
    }
    if (this.text[this.at] === '+') {
      this.at++;
      return this.unary();
    }
    return this.atom();
  }

  private atom(): number {
    this.space();
    if (this.text[this.at] === '(') {
      this.at++;
      const value = this.sum();
      this.expect(')');
      return value;
    }
    const token = /^(\$\d+|\?\w+|[A-Za-z_]\w*|(\d+\.?\d*|\.\d+)(e[-+]?\d+)?)/i.exec(
      this.text.slice(this.at),
    )?.[0];
    if (!token) throw new Unknown(this.text);
    this.at += token.length;
    if (token === 'pi') return Math.PI;
    const fn = FUNCTIONS[token];
    if (!fn) return this.formulas.value(token);
    this.expect('(');
    const args = [this.sum()];
    for (this.space(); this.text[this.at] === ','; this.space()) {
      this.at++;
      args.push(this.sum());
    }
    this.expect(')');
    return fn(...args);
  }

  private expect(char: string) {
    this.space();
    if (this.text[this.at] !== char) throw new Unknown(this.text);
    this.at++;
  }
}

/**
 * The shape's text area as insets of its box (`width`/`height`: the box in cm), or `null` when
 * the text fills the box (a rectangle) or the geometry cannot be read. Not mirrored: a mirrored
 * shape has it mirrored too (see {@link mirroredInset}).
 */
export function textAreaInset(
  geometry: ShapeGeometry,
  width: number,
  height: number,
): TextAreaInset | null {
  const preset = geometry.textAreas === undefined ? PRESETS[geometry.type ?? ''] : undefined;
  const textAreas = geometry.textAreas ?? preset?.textAreas;
  if (!textAreas?.trim() || width <= 0 || height <= 0) return null;
  // OOXML shapes (`ooxml-…`) count in the box's own 1/100 mm (their viewBox is `0 0 0 0`), the
  // others in their viewBox.
  const ooxml = (geometry.type ?? '').startsWith('ooxml-');
  const view = (geometry.viewBox ?? '0 0 21600 21600').trim().split(/\s+/).map(Number);
  const [left = 0, top = 0, viewWidth = 21600, viewHeight = 21600] = view;
  const badView = view.some((n) => !Number.isFinite(n)) || viewWidth <= 0 || viewHeight <= 0;
  if (badView && !ooxml) return null;
  const logWidth = width * 1000;
  const logHeight = height * 1000;
  const modifierText = geometry.modifiers ?? preset?.modifiers ?? '';
  const stretchX = Number(geometry.stretchX ?? preset?.stretchX ?? NaN);
  const stretchY = Number(geometry.stretchY ?? preset?.stretchY ?? NaN);
  const formulas = new Formulas(
    { ...preset?.equations, ...geometry.equations },
    modifierText.trim() ? modifierText.trim().split(/\s+/).map(Number) : [],
    {
      left,
      top,
      right: left + viewWidth,
      bottom: top + viewHeight,
      width: viewWidth,
      height: viewHeight,
      logwidth: logWidth,
      logheight: logHeight,
      xstretch: Number.isFinite(stretchX) ? stretchX : 0,
      ystretch: Number.isFinite(stretchY) ? stretchY : 0,
      hasstroke: 1,
      hasfill: 1,
    },
  );
  try {
    const [x1, y1, x2, y2] = textAreas
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .map((token) => formulas.value(token));
    if ([x1, y1, x2, y2].some((n) => n === undefined || !Number.isFinite(n))) return null;
    // Along a stretch point, a box longer that way (`ratio` > 1) is drawn at the scale of its
    // shorter side, what lies beyond the point moved out by the rest.
    const along = (n: number, origin: number, view: number, stretch: number, ratio: number) => {
      const at = n - origin;
      if (!Number.isFinite(stretch) || ratio <= 1) return at / view;
      return (at > stretch - origin ? at + view * (ratio - 1) : at) / (view * ratio);
    };
    const x = (n: number) =>
      ooxml ? n / logWidth : along(n, left, viewWidth, stretchX, width / height);
    const y = (n: number) =>
      ooxml ? n / logHeight : along(n, top, viewHeight, stretchY, height / width);
    const [l, r] = [x(x1!), x(x2!)].sort((a, b) => a - b) as [number, number];
    const [t, b] = [y(y1!), y(y2!)].sort((a, b) => a - b) as [number, number];
    const inset = { left: l, top: t, right: 1 - r, bottom: 1 - b };
    if (Object.values(inset).every((n) => Math.abs(n) < 1e-6)) return null;
    return inset;
  } catch (error) {
    if (error instanceof Unknown) return null;
    throw error;
  }
}

/** The text area of a shape mirrored left to right (`x`) and/or top to bottom (`y`). */
export function mirroredInset(
  inset: TextAreaInset,
  flip: { x: boolean; y: boolean } | null | undefined,
): TextAreaInset {
  return {
    left: flip?.x ? inset.right : inset.left,
    right: flip?.x ? inset.left : inset.right,
    top: flip?.y ? inset.bottom : inset.top,
    bottom: flip?.y ? inset.top : inset.bottom,
  };
}
