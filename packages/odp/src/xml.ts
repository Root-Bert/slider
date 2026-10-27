import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';
import { OdpError } from './errors';

/**
 * A lossless XML tree for ODF parts.
 *
 * `@slider/pptx` folds an element's text into one string, which is fine for reading but loses the
 * order of text and inline elements (`text:span`, `text:s`, …). Here we write the parts back, so
 * the tree is fast-xml-parser's own `preserveOrder` output, kept as is: building it again gives
 * the source byte for byte (the XML declaration is kept aside). Entities are not processed –
 * text and attribute values stay encoded as in the file, and everything we put in is escaped.
 */

/** An element (`{ 'draw:frame': [...children], ':@': { ...attributes } }`) or a text node. */
export type XmlNode = { [key: string]: XmlNode[] | Record<string, string> | string | undefined };

const ATTRIBUTES = ':@';
const TEXT = '#text';

const options = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  suppressEmptyNode: true,
  suppressBooleanAttributes: false,
} as const;

const parser = new XMLParser(options);
const builder = new XMLBuilder(options);

/** A parsed XML part: its declaration and its nodes. */
export interface XmlPart {
  declaration: string;
  nodes: XmlNode[];
}

const DECLARATION = /^\s*<\?xml[^>]*\?>\s*/;

export function parsePart(source: string, name: string): XmlPart {
  const validation = XMLValidator.validate(source);
  if (validation !== true) {
    throw new OdpError('corrupt', `${name}: ${validation.err.msg} (line ${validation.err.line})`);
  }
  const declaration = DECLARATION.exec(source)?.[0] ?? '';
  try {
    return { declaration, nodes: parser.parse(source.slice(declaration.length)) as XmlNode[] };
  } catch (error) {
    throw new OdpError(
      'corrupt',
      `${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export const buildPart = (part: XmlPart): string =>
  part.declaration + (builder.build(part.nodes) as string);

/** The element's qualified name, or `null` for a text node. */
export function tagOf(node: XmlNode): string | null {
  for (const key of Object.keys(node)) {
    if (key !== ATTRIBUTES && key !== TEXT) return key;
  }
  return null;
}

export const isElement = (node: XmlNode, tag?: string): boolean => {
  const name = tagOf(node);
  return name !== null && (tag === undefined || name === tag);
};

export function childrenOf(node: XmlNode): XmlNode[] {
  const tag = tagOf(node);
  if (!tag) return [];
  const children = node[tag];
  if (Array.isArray(children)) return children;
  const created: XmlNode[] = [];
  node[tag] = created;
  return created;
}

export const elementChildren = (node: XmlNode): XmlNode[] =>
  childrenOf(node).filter((child) => tagOf(child) !== null);

export const firstChild = (node: XmlNode, tag: string): XmlNode | undefined =>
  childrenOf(node).find((child) => tagOf(child) === tag);

function attributesOf(node: XmlNode): Record<string, string> {
  const existing = node[ATTRIBUTES];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as Record<string, string>;
  }
  const created: Record<string, string> = {};
  node[ATTRIBUTES] = created;
  return created;
}

/** An attribute's value, decoded. */
export function attr(node: XmlNode, name: string): string | undefined {
  const raw = (node[ATTRIBUTES] as Record<string, string> | undefined)?.[name];
  return raw === undefined ? undefined : decode(raw);
}

/** Sets an attribute; `value` is plain text and gets escaped. */
export function setAttr(node: XmlNode, name: string, value: string): void {
  attributesOf(node)[name] = escapeAttribute(value);
}

export function removeAttr(node: XmlNode, name: string): void {
  const attributes = node[ATTRIBUTES] as Record<string, string> | undefined;
  if (attributes) delete attributes[name];
}

export const attributeNames = (node: XmlNode): string[] =>
  Object.keys((node[ATTRIBUTES] as Record<string, string> | undefined) ?? {});

/** A text node's decoded text, or `null` for an element. */
export function textOf(node: XmlNode): string | null {
  const raw = node[TEXT];
  return typeof raw === 'string' ? decode(raw) : null;
}

/** A new element; attribute values and nothing else get escaped. */
export function element(
  tag: string,
  attributes: Record<string, string> = {},
  children: XmlNode[] = [],
): XmlNode {
  const node: XmlNode = { [tag]: children };
  if (Object.keys(attributes).length > 0) {
    node[ATTRIBUTES] = Object.fromEntries(
      Object.entries(attributes).map(([key, value]) => [key, escapeAttribute(value)]),
    );
  }
  return node;
}

export const textNode = (text: string): XmlNode => ({ [TEXT]: escapeText(text) });

/** A deep copy, e.g. to clone a paragraph as the template of a new one. */
export const cloneNode = (node: XmlNode): XmlNode => structuredClone(node);

/** Every element below `node` (not `node` itself), depth first, in document order. */
export function* descendants(node: XmlNode): Generator<XmlNode> {
  for (const child of childrenOf(node)) {
    if (tagOf(child) === null) continue;
    yield child;
    yield* descendants(child);
  }
}

export function findDescendant(node: XmlNode, tag: string): XmlNode | undefined {
  for (const child of descendants(node)) if (tagOf(child) === tag) return child;
  return undefined;
}

/** Path from a root list to `target`: the parents, outermost first. */
export function parentsOf(roots: XmlNode[], target: XmlNode): XmlNode[] | null {
  const walk = (node: XmlNode, trail: XmlNode[]): XmlNode[] | null => {
    if (node === target) return trail;
    for (const child of childrenOf(node)) {
      if (tagOf(child) === null) continue;
      const found = walk(child, [...trail, node]);
      if (found) return found;
    }
    return null;
  };
  for (const root of roots) {
    const found = walk(root, []);
    if (found) return found;
  }
  return null;
}

/** Removes `node` from `parent`; returns whether it was there. */
export function removeChild(parent: XmlNode, node: XmlNode): boolean {
  const children = childrenOf(parent);
  const index = children.indexOf(node);
  if (index < 0) return false;
  children.splice(index, 1);
  return true;
}

export function insertAfter(parent: XmlNode, reference: XmlNode, node: XmlNode): void {
  const children = childrenOf(parent);
  const index = children.indexOf(reference);
  children.splice(index < 0 ? children.length : index + 1, 0, node);
}

const ENTITY = /&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decode(raw: string): string {
  return raw.replace(
    ENTITY,
    (match, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
      if (name) return NAMED[name] ?? match;
      const code = hex ? Number.parseInt(hex, 16) : Number(dec);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    },
  );
}

// Characters XML 1.0 does not allow at all; they would make the part unreadable.
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export const escapeText = (text: string): string =>
  text.replace(INVALID_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const escapeAttribute = (text: string): string =>
  escapeText(text).replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;');
