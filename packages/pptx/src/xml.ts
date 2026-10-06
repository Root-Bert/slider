import { XMLParser, XMLValidator } from 'fast-xml-parser';

/**
 * A tiny, order-preserving XML tree plus the handful of helpers needed to walk OOXML readably.
 *
 * fast-xml-parser runs in `preserveOrder` mode because document order is meaningful in
 * PresentationML (the order of `p:spTree` children is the z-order). Its raw output is awkward to
 * walk, so it is converted once into plain {@link XmlElement}s.
 *
 * Entity processing in the parser is disabled on purpose: OOXML never uses DTD entities, and
 * decoding the five XML entities plus numeric references ourselves keeps the behaviour explicit
 * (and immune to entity-expansion tricks).
 */

export interface XmlElement {
  /** Qualified name as written in the document, e.g. `p:sp`. */
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  /** Concatenated character data directly inside this element (not of descendants). */
  text: string;
}

/** Raised when a part is not well-formed XML. */
export class XmlSyntaxError extends Error {
  override name = 'XmlSyntaxError';
}

const ATTRIBUTES_KEY = ':@';
const TEXT_KEY = '#text';

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

type RawNode = Record<string, unknown>;

/** Parses an XML document and returns its root element. */
export function parseXml(source: string): XmlElement {
  const validation = XMLValidator.validate(source);
  if (validation !== true) {
    throw new XmlSyntaxError(`${validation.err.msg} (line ${validation.err.line})`);
  }
  const root = (parser.parse(source) as RawNode[]).map(toElement).find(isElement);
  if (!root) throw new XmlSyntaxError('Document has no root element');
  return root;
}

function toElement(raw: RawNode): XmlElement | string {
  if (TEXT_KEY in raw) return decodeEntities(String(raw[TEXT_KEY]));
  const name = Object.keys(raw).find((key) => key !== ATTRIBUTES_KEY) ?? '';
  const rawAttributes = (raw[ATTRIBUTES_KEY] ?? {}) as Record<string, unknown>;
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawAttributes)) {
    attributes[key] = decodeEntities(String(value));
  }
  const children: XmlElement[] = [];
  let text = '';
  for (const child of (raw[name] ?? []) as RawNode[]) {
    const converted = toElement(child);
    if (typeof converted === 'string') text += converted;
    else children.push(converted);
  }
  return { name, attributes, children, text };
}

const isElement = (node: XmlElement | string): node is XmlElement => typeof node !== 'string';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const codePoint = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}

// ---------------------------------------------------------------------------------------------
// Navigation helpers. Names are matched by their qualified name (`p:sp`); helpers suffixed with
// `ByLocalName` ignore the prefix, for parts whose prefixes vary between producers.
// ---------------------------------------------------------------------------------------------

/** Helpers accept missing elements so lookups can be chained without null checks. */
export type MaybeElement = XmlElement | null | undefined;

export const localName = (name: string): string => name.slice(name.indexOf(':') + 1);

/** First direct child with the given qualified name. */
export function child(element: MaybeElement, name: string): XmlElement | undefined {
  return element?.children.find((candidate) => candidate.name === name);
}

/** All direct children with the given qualified name, in document order. */
export function children(element: MaybeElement, name: string): XmlElement[] {
  return element?.children.filter((candidate) => candidate.name === name) ?? [];
}

/** Follows a path of qualified child names, e.g. `path(sld, 'p:cSld', 'p:spTree')`. */
export function path(element: MaybeElement, ...names: string[]): XmlElement | undefined {
  let current = element ?? undefined;
  for (const name of names) current = child(current, name);
  return current;
}

export function attr(element: MaybeElement, name: string): string | undefined {
  return element?.attributes[name];
}

/** Attribute parsed as an integer; `undefined` if missing or not numeric. */
export function intAttr(element: MaybeElement, name: string): number | undefined {
  const value = attr(element, name);
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** OOXML booleans: `1`/`true` and `0`/`false`. */
export function boolAttr(element: MaybeElement, name: string): boolean | undefined {
  const value = attr(element, name);
  if (value === undefined) return undefined;
  return value === '1' || value === 'true';
}

/**
 * Depth-first search (document order) for the first matching descendant. Subtrees for which
 * `skip` returns true are not entered.
 */
export function findDescendant(
  element: MaybeElement,
  matches: (candidate: XmlElement) => boolean,
  skip: (candidate: XmlElement) => boolean = () => false,
): XmlElement | undefined {
  for (const candidate of element?.children ?? []) {
    if (skip(candidate)) continue;
    if (matches(candidate)) return candidate;
    const found = findDescendant(candidate, matches, skip);
    if (found) return found;
  }
  return undefined;
}

/** First descendant with the given local name, whatever its namespace prefix. */
export function findByLocalName(element: MaybeElement, name: string): XmlElement | undefined {
  return findDescendant(element, (candidate) => localName(candidate.name) === name);
}

/** All descendants with the given qualified name, in document order. */
export function descendants(element: MaybeElement, name: string): XmlElement[] {
  const found: XmlElement[] = [];
  const visit = (node: XmlElement): void => {
    for (const candidate of node.children) {
      if (candidate.name === name) found.push(candidate);
      visit(candidate);
    }
  };
  if (element) visit(element);
  return found;
}
