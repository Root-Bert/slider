/*
 * A flow diagram as a page writes it: a ```mermaid block in Mermaid's flowchart language, which
 * the agents write fluently and a person can type. Only flowcharts are read here (`flowchart` /
 * `graph`): boxes in their shapes, arrows with words on them, groups (`subgraph … end`), a
 * direction, and the colours `classDef`/`class`/`style`/`:::` give. Everything is read with where
 * it is written (`Span`), so a click on the drawing changes the one place in the text it came
 * from (`edit.ts`) and the rest of the block stays as it was typed.
 */

export type Direction = 'TB' | 'BT' | 'LR' | 'RL';

export type Shape =
  | 'rect'
  | 'round'
  | 'stadium'
  | 'subroutine'
  | 'cylinder'
  | 'circle'
  | 'double-circle'
  | 'flag'
  | 'rhombus'
  | 'hexagon'
  | 'lean-right'
  | 'lean-left'
  | 'trapezoid'
  | 'trapezoid-alt';

/** A place in the diagram's text: its line (0 = the first line inside the fence), columns [from, to). */
export interface Span {
  line: number;
  from: number;
  to: number;
}

/** Colours a box or group is given in the text (`fill:#…,stroke:#…,color:#…`). */
export interface Look {
  fill?: string;
  stroke?: string;
  color?: string;
  dashed?: boolean;
}

export interface DiagramNode {
  id: string;
  /** Its words, lines split at `\n`; the id where it has none. */
  label: string;
  shape: Shape;
  /** The innermost group it stands in. */
  group: string | null;
  /** Its shape and words as written (`[Text]`, `{"Ja?"}`) – none where only its id is written. */
  labelAt: Span | null;
  /** Its id where it is first written. */
  idAt: Span;
  /** Every line it is named on, in order. */
  mentions: number[];
  classes: string[];
  look: Look;
}

export type Stroke = 'solid' | 'dotted' | 'thick' | 'invisible';
export type Head = 'arrow' | 'circle' | 'cross' | 'none';

export interface DiagramEdge {
  from: string;
  to: string;
  label: string;
  stroke: Stroke;
  head: Head;
  tail: Head;
  /** How many steps it spans at least (`--->` two). */
  length: number;
  /** The arrow as written, without words on it (`-->`). */
  linkAt: Span;
  /** Its words as written: `|…|` with the bars, or the words inside `-- … -->`. */
  labelAt: Span | null;
  labelKind: 'pipe' | 'inline' | null;
}

export interface DiagramGroup {
  id: string;
  label: string;
  parent: string | null;
  direction: Direction | null;
  /** The `subgraph` line. */
  line: number;
  /** The `end` line (the last line where it is never closed). */
  endLine: number;
  look: Look;
}

export interface Diagram {
  direction: Direction;
  title: string | null;
  nodes: Map<string, DiagramNode>;
  edges: DiagramEdge[];
  groups: Map<string, DiagramGroup>;
  /** The diagram's lines, as written. */
  lines: string[];
  /** The `flowchart …` line. */
  headerLine: number;
}

export type Parsed = { diagram: Diagram } | { error: string; line: number | null };

/** Whether a ```mermaid block's text is a flowchart (its first line that says something). */
export function isFlowchart(body: string): boolean {
  for (const raw of body.split('\n').slice(0, 40)) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    if (line === '---')
      return /^---[\s\S]*?\n---\s*\n\s*(?:%%.*\n\s*)*(flowchart|graph)\b/.test(body.trimStart());
    return /^(flowchart|graph)\b/.test(line);
  }
  return false;
}

const DIRECTIONS: Record<string, Direction> = {
  TB: 'TB',
  TD: 'TB',
  BT: 'BT',
  LR: 'LR',
  RL: 'RL',
  v: 'TB',
  '^': 'BT',
  '>': 'LR',
  '<': 'RL',
};

/** Openers of a box's shape, longest first, with how each closes. */
const SHAPES: { open: string; close: string | string[]; shape: Shape | Shape[] }[] = [
  { open: '(((', close: ')))', shape: 'double-circle' },
  { open: '((', close: '))', shape: 'circle' },
  { open: '([', close: '])', shape: 'stadium' },
  { open: '[[', close: ']]', shape: 'subroutine' },
  { open: '[(', close: ')]', shape: 'cylinder' },
  { open: '[/', close: ['/]', '\\]'], shape: ['lean-right', 'trapezoid'] },
  { open: '[\\', close: ['\\]', '/]'], shape: ['lean-left', 'trapezoid-alt'] },
  { open: '{{', close: '}}', shape: 'hexagon' },
  { open: '{', close: '}', shape: 'rhombus' },
  { open: '(', close: ')', shape: 'round' },
  { open: '[', close: ']', shape: 'rect' },
  { open: '>', close: ']', shape: 'flag' },
];

/** The shapes `A@{ shape: … }` names, by Mermaid's names and short names. */
const NAMED_SHAPES: Record<string, Shape> = {
  rect: 'rect',
  rectangle: 'rect',
  proc: 'rect',
  process: 'rect',
  rounded: 'round',
  event: 'round',
  stadium: 'stadium',
  pill: 'stadium',
  terminal: 'stadium',
  subproc: 'subroutine',
  subroutine: 'subroutine',
  'fr-rect': 'subroutine',
  cyl: 'cylinder',
  cylinder: 'cylinder',
  db: 'cylinder',
  database: 'cylinder',
  circle: 'circle',
  circ: 'circle',
  'dbl-circ': 'double-circle',
  'double-circle': 'double-circle',
  diam: 'rhombus',
  diamond: 'rhombus',
  decision: 'rhombus',
  question: 'rhombus',
  hex: 'hexagon',
  hexagon: 'hexagon',
  prepare: 'hexagon',
  'lean-r': 'lean-right',
  'lean-right': 'lean-right',
  'in-out': 'lean-right',
  'lean-l': 'lean-left',
  'lean-left': 'lean-left',
  'out-in': 'lean-left',
  'trap-b': 'trapezoid',
  trapezoid: 'trapezoid',
  priority: 'trapezoid',
  'trap-t': 'trapezoid-alt',
  'inv-trapezoid': 'trapezoid-alt',
  manual: 'trapezoid-alt',
  flag: 'flag',
  odd: 'flag',
};

const ENTITIES: Record<string, string> = {
  quot: '"',
  amp: '&',
  lt: '<',
  gt: '>',
  nbsp: ' ',
  apos: "'",
  hash: '#',
  semi: ';',
};

/** A box's or arrow's words as they are shown: entities read, `<br>` a new line, other tags out. */
export function shownText(raw: string): string {
  let text = raw.trim();
  // A Markdown string ("`…`"): its marks go, its text stays.
  if (text.startsWith('`') && text.endsWith('`') && text.length >= 2) {
    text = text.slice(1, -1).replace(/\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_/g, '$1$2$3$4');
  }
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/#([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/&(#\d+|[a-z]+);/gi, (whole, name: string) =>
      name.startsWith('#')
        ? String.fromCodePoint(Number(name.slice(1)))
        : (ENTITIES[name.toLowerCase()] ?? whole),
    )
    .replace(/\\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .trim();
}

/** `fill:#f9f,stroke:#333,stroke-dasharray: 5 5` – what of it a box can show. */
function lookOf(spec: string): Look {
  const look: Look = {};
  for (const part of spec.replace(/;\s*$/, '').split(',')) {
    const [key, ...rest] = part.split(':');
    const value = rest.join(':').trim();
    if (!key || !value) continue;
    const name = key.trim().toLowerCase();
    if (!/^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i.test(value)) {
      if (name === 'stroke-dasharray') look.dashed = true;
      continue;
    }
    if (name === 'fill' || name === 'background') look.fill = value;
    else if (name === 'stroke') look.stroke = value;
    else if (name === 'color') look.color = value;
    else if (name === 'stroke-dasharray') look.dashed = true;
  }
  return look;
}

const isIdChar = (char: string | undefined) => !!char && /[\p{L}\p{N}_$!?'*+./\\#]/u.test(char);

class Failure extends Error {
  constructor(
    message: string,
    readonly line: number | null,
  ) {
    super(message);
  }
}

/** Reads a flowchart; where it cannot, says why and in which line. */
export function parseDiagram(source: string): Parsed {
  try {
    return { diagram: new Reader(source).read() };
  } catch (error) {
    if (error instanceof Failure) return { error: error.message, line: error.line };
    throw error;
  }
}

interface Link {
  stroke: Stroke;
  head: Head;
  tail: Head;
  length: number;
  label: string;
  linkAt: Span;
  labelAt: Span | null;
  labelKind: 'pipe' | 'inline' | null;
}

class Reader {
  private readonly lines: string[];
  private readonly nodes = new Map<string, DiagramNode>();
  private readonly edges: DiagramEdge[] = [];
  private readonly groups = new Map<string, DiagramGroup>();
  private readonly classDefs = new Map<string, Look>();
  private readonly classed: { ids: string[]; names: string[] }[] = [];
  private readonly styled: { id: string; look: Look }[] = [];
  /** Open groups, innermost last. */
  private readonly open: DiagramGroup[] = [];
  private direction: Direction = 'TB';
  private title: string | null = null;
  private headerLine = -1;
  // The statement being read.
  private line = 0;
  private text = '';
  private at = 0;

  constructor(source: string) {
    this.lines = source.split('\n');
  }

  read(): Diagram {
    let start = 0;
    // Front matter: `---`, `title: …`, `---`.
    const first = this.lines.findIndex((line) => line.trim() !== '');
    if (first >= 0 && this.lines[first]!.trim() === '---') {
      const close = this.lines.findIndex((line, index) => index > first && line.trim() === '---');
      if (close < 0) throw new Failure('Der Kopf (---) wird nie geschlossen.', first);
      for (const line of this.lines.slice(first + 1, close)) {
        const title = /^\s*title:\s*(.+?)\s*$/.exec(line);
        if (title) this.title = title[1]!.replace(/^["']|["']$/g, '');
      }
      start = close + 1;
    }
    for (let index = start; index < this.lines.length; index += 1) {
      const raw = this.lines[index]!;
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('%%')) continue;
      this.line = index;
      if (this.headerLine < 0) {
        const header = /^(flowchart|graph)(?:\s+(TB|TD|BT|LR|RL|v|\^|>|<))?\s*;?\s*(.*)$/.exec(
          trimmed,
        );
        if (!header) {
          throw new Failure(
            'Gezeichnet werden nur Flussdiagramme: die erste Zeile ist „flowchart LR“ oder „flowchart TD“.',
            index,
          );
        }
        this.headerLine = index;
        if (header[2]) this.direction = DIRECTIONS[header[2]]!;
        // Statements may follow on the same line after `;`.
        const lead = raw.length - raw.trimStart().length;
        if (header[3]) this.statements(raw, lead + trimmed.length - header[3].length);
        continue;
      }
      this.statements(raw, raw.length - raw.trimStart().length);
    }
    if (this.headerLine < 0) {
      throw new Failure('Die erste Zeile ist „flowchart LR“ oder „flowchart TD“.', null);
    }
    const last = this.lines.length - 1;
    for (const group of this.open) group.endLine = last;
    return this.finish();
  }

  /** The statements of one line, from `from` on – one, or several after `;`. */
  private statements(raw: string, from: number) {
    this.text = raw;
    this.at = from;
    while (this.at < this.text.length) {
      this.space();
      if (this.at >= this.text.length) break;
      if (this.text[this.at] === ';') {
        this.at += 1;
        continue;
      }
      if (this.keyword()) continue;
      this.chain();
      this.space();
      if (this.at < this.text.length && this.text[this.at] !== ';') {
        throw this.fail(
          `„${this.text.slice(this.at, this.at + 12).trim()}“ verstehe ich hier nicht.`,
        );
      }
    }
  }

  private fail(message: string) {
    return new Failure(message, this.line);
  }

  private space() {
    while (this.at < this.text.length && /\s/.test(this.text[this.at]!)) this.at += 1;
  }

  private rest() {
    return this.text.slice(this.at);
  }

  /** A statement that starts with a word of its own; `true` once read (to the line's end). */
  private keyword(): boolean {
    const rest = this.rest();
    const word = /^([A-Za-z]+)\b/.exec(rest)?.[1];
    if (!word) return false;
    const toEnd = () => {
      this.at = this.text.length;
      return true;
    };
    switch (word) {
      case 'subgraph': {
        this.subgraph(rest.slice(word.length).trim());
        return toEnd();
      }
      case 'end': {
        if (!/^end\s*(;|$)/.test(rest)) return false;
        const group = this.open.pop();
        if (!group) throw this.fail('„end“ ohne „subgraph“ davor.');
        group.endLine = this.line;
        this.at += 3;
        return true;
      }
      case 'direction': {
        const match = /^direction\s+(TB|TD|BT|LR|RL)\s*;?\s*$/.exec(rest);
        if (!match) return false;
        const direction = DIRECTIONS[match[1]!]!;
        const group = this.open.at(-1);
        if (group) group.direction = direction;
        else this.direction = direction;
        return toEnd();
      }
      case 'classDef': {
        const match = /^classDef\s+(\S+)\s+(.+?)\s*;?\s*$/.exec(rest);
        if (!match) throw this.fail('„classDef“ braucht einen Namen und Farben.');
        const look = lookOf(match[2]!);
        for (const name of match[1]!.split(',')) this.classDefs.set(name.trim(), look);
        return toEnd();
      }
      case 'class': {
        const match = /^class\s+(\S+)\s+(\S+?)\s*;?\s*$/.exec(rest);
        if (!match) throw this.fail('„class“ braucht Kästen und einen Namen.');
        this.classed.push({
          ids: match[1]!.split(',').map((id) => id.trim()),
          names: match[2]!.split(',').map((name) => name.trim()),
        });
        return toEnd();
      }
      case 'style': {
        const match = /^style\s+(\S+)\s+(.+?)\s*;?\s*$/.exec(rest);
        if (!match) throw this.fail('„style“ braucht einen Kasten und Farben.');
        this.styled.push({ id: match[1]!, look: lookOf(match[2]!) });
        return toEnd();
      }
      case 'linkStyle':
      case 'click':
      case 'accTitle':
      case 'accDescr':
        // Links and colours of arrows are not drawn; a click is never followed.
        return toEnd();
      default:
        return false;
    }
  }

  private subgraph(rest: string) {
    let id: string;
    let label: string;
    const bracket = /^([^\s[\]"]+)\s*\[\s*(?:"([^"]*)"|([^\]]*))\s*\]\s*;?$/.exec(rest);
    const quoted = /^"([^"]*)"\s*;?$/.exec(rest);
    if (bracket) {
      id = bracket[1]!;
      label = shownText(bracket[2] ?? bracket[3] ?? '');
    } else if (quoted) {
      label = shownText(quoted[1]!);
      id = label;
    } else {
      const words = rest.replace(/;\s*$/, '').trim();
      id = words || `Gruppe ${this.groups.size + 1}`;
      label = shownText(words);
    }
    if (this.groups.has(id)) throw this.fail(`Die Gruppe „${id}“ gibt es schon.`);
    const group: DiagramGroup = {
      id,
      label,
      parent: this.open.at(-1)?.id ?? null,
      direction: null,
      line: this.line,
      endLine: this.line,
      look: {},
    };
    this.groups.set(id, group);
    this.open.push(group);
  }

  /** `A & B -->|ja| C --> D` – boxes, joined by arrows. */
  private chain() {
    let from = this.vertices();
    for (;;) {
      this.space();
      if (this.at >= this.text.length || this.text[this.at] === ';') return;
      const link = this.link();
      if (!link) return;
      this.space();
      const to = this.vertices();
      for (const a of from) {
        for (const b of to) {
          this.edges.push({ from: a, to: b, ...link });
        }
      }
      from = to;
    }
  }

  private vertices(): string[] {
    const ids = [this.vertex()];
    for (;;) {
      const save = this.at;
      this.space();
      if (this.text[this.at] !== '&') {
        this.at = save;
        return ids;
      }
      this.at += 1;
      this.space();
      ids.push(this.vertex());
    }
  }

  /** One box: its id, then perhaps its shape and words, then perhaps `:::name`. */
  private vertex(): string {
    const start = this.at;
    while (this.at < this.text.length) {
      const char = this.text[this.at]!;
      const next = this.text[this.at + 1];
      if (isIdChar(char)) {
        this.at += 1;
        continue;
      }
      // A dash inside an id – never the start of an arrow (`--`, `-.`, `->`).
      if (char === '-' && next !== '-' && next !== '.' && next !== '>' && this.at > start) {
        this.at += 1;
        continue;
      }
      break;
    }
    const id = this.text.slice(start, this.at);
    if (!id) {
      const what = this.text.slice(this.at, this.at + 12).trim();
      throw this.fail(what ? `„${what}“ – hier fehlt ein Kasten.` : 'Hier fehlt ein Kasten.');
    }
    if (id === 'end' || id === 'subgraph')
      throw this.fail(`„${id}“ geht nicht als Name eines Kastens.`);
    const idAt: Span = { line: this.line, from: start, to: this.at };
    const node = this.touch(id, idAt);
    // `A@{ shape: diam, label: "Ja?" }`
    if (this.text.startsWith('@{', this.at)) {
      const close = this.text.indexOf('}', this.at);
      if (close < 0) throw this.fail('„@{“ wird nicht geschlossen.');
      const body = this.text.slice(this.at + 2, close);
      const shape = /\bshape\s*:\s*([\w-]+)/.exec(body)?.[1];
      const label = /\blabel\s*:\s*(?:"([^"]*)"|([^,}]+))/.exec(body);
      if (shape) node.shape = NAMED_SHAPES[shape.toLowerCase()] ?? 'rect';
      if (label) node.label = shownText(label[1] ?? label[2] ?? '');
      node.labelAt = { line: this.line, from: this.at, to: close + 1 };
      this.at = close + 1;
    } else {
      this.shape(node);
    }
    while (this.text.startsWith(':::', this.at)) {
      this.at += 3;
      const begin = this.at;
      while (this.at < this.text.length && /[\w-]/.test(this.text[this.at]!)) this.at += 1;
      const name = this.text.slice(begin, this.at);
      if (name && !node.classes.includes(name)) node.classes.push(name);
    }
    return id;
  }

  private shape(node: DiagramNode) {
    const begin = this.at;
    for (const each of SHAPES) {
      if (!this.text.startsWith(each.open, this.at)) continue;
      // `>` only opens a flag directly after an id and when it is closed.
      const contentStart = this.at + each.open.length;
      let content: string;
      let end: number;
      let shape: Shape;
      if (this.text[contentStart] === '"') {
        const quoteEnd = this.text.indexOf('"', contentStart + 1);
        if (quoteEnd < 0) throw this.fail('Ein Text in "…" wird nicht geschlossen.');
        content = this.text.slice(contentStart + 1, quoteEnd);
        const closers = Array.isArray(each.close) ? each.close : [each.close];
        const after = this.text.slice(quoteEnd + 1);
        const which = closers.findIndex((close) => after.trimStart().startsWith(close));
        if (which < 0) {
          if (each.open === '>') continue;
          throw this.fail(`„${closers[0]}“ fehlt nach dem Text.`);
        }
        end = quoteEnd + 1 + (after.length - after.trimStart().length) + closers[which]!.length;
        shape = Array.isArray(each.shape) ? each.shape[which]! : each.shape;
      } else {
        const closers = Array.isArray(each.close) ? each.close : [each.close];
        let best = -1;
        let which = -1;
        closers.forEach((close, index) => {
          const found = this.text.indexOf(close, contentStart);
          if (found >= 0 && (best < 0 || found < best)) {
            best = found;
            which = index;
          }
        });
        if (best < 0) {
          if (each.open === '>') continue;
          throw this.fail(`„${closers[0]}“ fehlt – der Kasten wird nicht geschlossen.`);
        }
        content = this.text.slice(contentStart, best);
        end = best + closers[which]!.length;
        shape = Array.isArray(each.shape) ? each.shape[which]! : each.shape;
      }
      node.shape = shape;
      node.label = shownText(content) || node.id;
      node.labelAt = { line: this.line, from: begin, to: end };
      this.at = end;
      return;
    }
  }

  /** A box by its id: made where it is first named, put in the group it is first named in. */
  private touch(id: string, idAt: Span): DiagramNode {
    const group = this.open.at(-1)?.id ?? null;
    let node = this.nodes.get(id);
    if (!node) {
      node = {
        id,
        label: id,
        shape: 'rect',
        group,
        labelAt: null,
        idAt,
        mentions: [],
        classes: [],
        look: {},
      };
      this.nodes.set(id, node);
    } else if (node.group === null && group !== null) {
      node.group = group;
    }
    if (node.mentions.at(-1) !== this.line) node.mentions.push(this.line);
    return node;
  }

  /** An arrow (`-->`, `-.->`, `==>`, `---`, `~~~`, `<-->`, `--o`, `--x`), with its words. */
  private link(): Link | null {
    const begin = this.at;
    const rest = this.rest();
    // Words in the arrow: `-- ja -->`, `-. ja .->`, `== ja ==>`.
    const inline = /^([<ox]?)(--|==|-\.)(?=\s)/.exec(rest);
    if (inline) {
      const kind = inline[2]!;
      const ends: Record<string, RegExp> = {
        '--': /(\s*)(-{2,})([>ox]?)(?=[\s\w"([{|]|$)|(\s*)(-{3,})/,
        '==': /(\s*)(={2,})([>ox]?)/,
        '-.': /(\s*)(\.-+)([>ox]?)/,
      };
      const afterOpen = begin + inline[0].length;
      const tail = this.text.slice(afterOpen);
      const end = ends[kind]!.exec(tail);
      if (end && end.index > 0) {
        const words = tail.slice(0, end.index);
        const wordsStart = afterOpen + (words.length - words.trimStart().length);
        const wordsEnd = afterOpen + words.trimEnd().length;
        const closer = end[2] ?? end[5] ?? '';
        const head = end[3] ?? '';
        const linkEnd = afterOpen + end.index + end[0].length;
        this.at = linkEnd;
        const stroke: Stroke = kind === '==' ? 'thick' : kind === '-.' ? 'dotted' : 'solid';
        const length =
          kind === '-.'
            ? Math.max(1, closer.length - 1)
            : Math.max(1, closer.length - (head ? 1 : 2));
        return {
          stroke,
          head: headOf(head),
          tail: headOf(inline[1]!),
          length,
          label: shownText(this.text.slice(wordsStart, wordsEnd).replace(/^"|"$/g, '')),
          linkAt: { line: this.line, from: begin, to: linkEnd },
          labelAt: { line: this.line, from: wordsStart, to: wordsEnd },
          labelKind: 'inline',
        };
      }
    }
    const plain = /^([<ox]?)(-{2,}|={2,}|-\.+-|~{3,})(>|o(?=[\s|]|$)|x(?=[\s|]|$))?/.exec(rest);
    if (!plain) return null;
    const body = plain[2]!;
    const head = plain[3] ?? '';
    const tailHead = plain[1]!;
    // `-` or `=` alone would be read as part of the next id; a plain `--`/`==` needs a head.
    if (!head && (body === '--' || body === '==') && !tailHead) return null;
    this.at = begin + plain[0].length;
    const linkAt: Span = { line: this.line, from: begin, to: this.at };
    let stroke: Stroke = 'solid';
    let length = Math.max(1, body.length - (head ? 1 : 2));
    if (body.startsWith('~')) {
      stroke = 'invisible';
      length = Math.max(1, body.length - 2);
    } else if (body.startsWith('=')) stroke = 'thick';
    else if (body.includes('.')) {
      stroke = 'dotted';
      length = Math.max(1, body.length - 2);
    }
    let label = '';
    let labelAt: Span | null = null;
    let labelKind: 'pipe' | null = null;
    const save = this.at;
    this.space();
    if (this.text[this.at] === '|') {
      const close = this.text.indexOf('|', this.at + 1);
      if (close < 0) throw this.fail('Der Text am Pfeil (|…|) wird nicht geschlossen.');
      label = shownText(
        this.text
          .slice(this.at + 1, close)
          .trim()
          .replace(/^"|"$/g, ''),
      );
      labelAt = { line: this.line, from: this.at, to: close + 1 };
      labelKind = 'pipe';
      this.at = close + 1;
    } else {
      this.at = save;
    }
    return {
      stroke,
      head: headOf(head),
      tail: headOf(tailHead),
      length,
      label,
      linkAt,
      labelAt,
      labelKind,
    };
  }

  private finish(): Diagram {
    // An arrow may point at a group: it is the group's, not a box of that name.
    for (const id of this.groups.keys()) this.nodes.delete(id);
    for (const { ids, names } of this.classed) {
      for (const id of ids) {
        const node = this.nodes.get(id);
        if (!node) continue;
        for (const name of names) if (!node.classes.includes(name)) node.classes.push(name);
      }
    }
    const plain = this.classDefs.get('default');
    for (const node of this.nodes.values()) {
      if (plain) Object.assign(node.look, plain);
      for (const name of node.classes) Object.assign(node.look, this.classDefs.get(name));
    }
    for (const { id, look } of this.styled) {
      const target = this.nodes.get(id) ?? this.groups.get(id);
      if (target) Object.assign(target.look, look);
    }
    return {
      direction: this.direction,
      title: this.title,
      nodes: this.nodes,
      edges: this.edges,
      groups: this.groups,
      lines: this.lines,
      headerLine: this.headerLine,
    };
  }
}

function headOf(mark: string): Head {
  if (mark === '>' || mark === '<') return 'arrow';
  if (mark === 'o') return 'circle';
  if (mark === 'x') return 'cross';
  return 'none';
}
