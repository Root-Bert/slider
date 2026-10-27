import {
  attr,
  attributeNames,
  buildPart,
  childrenOf,
  decode,
  elementChildren,
  escapeAttribute,
  parsePart,
  tagOf,
  textOf,
  type XmlNode,
} from './xml';

/*
 * Merging two changes of a slide (BER-183): several people and AI requests change a deck at once,
 * each from the slide as it was when they started. A change goes in on top of the others as a
 * three-way merge over the XML tree – elements by `xml:id`, the others by tag and position,
 * attributes one by one – so changes of different things fit together and only one thing
 * changed two ways is a conflict.
 */

/** Where two changes of a slide meet: the element (by id and name) and what both changed. */
export interface SlideConflict {
  elementId: string | null;
  name: string | null;
  /** The attribute, `text`, or what else both changed. */
  what: string;
}

/** The merged slide, or – when changes meet – `null` and where they do. */
export type SlideMerge = { xml: string; conflicts: [] } | { xml: null; conflicts: SlideConflict[] };

const ATTRIBUTES = ':@';

const rawAttributes = (node: XmlNode): Record<string, string> =>
  (node[ATTRIBUTES] as Record<string, string> | undefined) ?? {};

/** Text elements, where whitespace between children is text; elsewhere it is layout. */
const keepsWhitespace = (tag: string | null): boolean => tag !== null && tag.startsWith('text:');

const isLayoutWhitespace = (node: XmlNode): boolean => {
  const text = textOf(node);
  return text !== null && text.trim() === '';
};

/** The children that count: without whitespace between elements outside text. */
function significantChildren(node: XmlNode): XmlNode[] {
  const children = childrenOf(node);
  return keepsWhitespace(tagOf(node))
    ? children
    : children.filter((child) => !isLayoutWhitespace(child));
}

const canonical = new WeakMap<XmlNode, string>();

/**
 * The node as a string that is the same for the same content: attributes in order of name,
 * entities decoded, whitespace between elements outside text left out.
 */
function canon(node: XmlNode): string {
  const known = canonical.get(node);
  if (known !== undefined) return known;
  const tag = tagOf(node);
  let result: string;
  if (tag === null) {
    result = JSON.stringify(textOf(node) ?? '');
  } else {
    const attributes = attributeNames(node)
      .sort()
      .map((name) => `${name}=${JSON.stringify(attr(node, name))}`)
      .join(' ');
    result = `<${tag} ${attributes}>${significantChildren(node).map(canon).join('')}</${tag}>`;
  }
  canonical.set(node, result);
  return result;
}

/** Whether two nodes hold the same (see {@link canon}). */
export const sameNode = (a: XmlNode, b: XmlNode): boolean => canon(a) === canon(b);

function pageOf(xml: string): XmlNode {
  const page = parsePart(xml, 'slide').nodes.find((node) => tagOf(node) !== null);
  if (!page) throw new Error('No slide in the XML.');
  return page;
}

/** Whether two `draw:page`s hold the same, however they are written. */
export const sameSlide = (a: string, b: string): boolean => sameNode(pageOf(a), pageOf(b));

interface Owner {
  elementId: string | null;
  name: string | null;
}

/** Children by key: elements with an id by it, the others by tag and how many came before. */
function keyed(node: XmlNode): { order: string[]; nodes: Map<string, XmlNode> } {
  const order: string[] = [];
  const nodes = new Map<string, XmlNode>();
  const counts = new Map<string, number>();
  for (const child of significantChildren(node)) {
    const tag = tagOf(child) ?? '#text';
    const id = tagOf(child) === null ? undefined : attr(child, 'xml:id');
    let key = id ? `id ${id}` : '';
    if (!key || nodes.has(key)) {
      const count = counts.get(tag) ?? 0;
      counts.set(tag, count + 1);
      key = `${tag} ${count}`;
    }
    order.push(key);
    nodes.set(key, child);
  }
  return { order, nodes };
}

const sameOrder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((key, i) => key === b[i]);

class Merger {
  readonly conflicts: SlideConflict[] = [];

  private conflict(owner: Owner, what: string): void {
    if (!this.conflicts.some((item) => item.elementId === owner.elementId && item.what === what)) {
      this.conflicts.push({ ...owner, what });
    }
  }

  /** `base` changed to `ours` and to `theirs`: both changes in one node. */
  node(base: XmlNode, ours: XmlNode, theirs: XmlNode, owner: Owner): XmlNode {
    const b = canon(base);
    const o = canon(ours);
    const t = canon(theirs);
    if (o === b || o === t) return theirs;
    if (t === b) return ours;
    const tag = tagOf(base);
    if (tag === null || tagOf(ours) !== tag || tagOf(theirs) !== tag) {
      this.conflict(owner, tag === null || keepsWhitespace(tag) ? 'text' : `<${tag}>`);
      return theirs;
    }
    const id = attr(theirs, 'xml:id');
    const here: Owner = id ? { elementId: id, name: attr(theirs, 'draw:name') ?? null } : owner;
    const attributes = this.attributes(base, ours, theirs, here, tag);
    const merged: XmlNode = { [tag]: this.children(base, ours, theirs, here) };
    if (Object.keys(attributes).length > 0) merged[ATTRIBUTES] = attributes;
    return merged;
  }

  private attributes(
    base: XmlNode,
    ours: XmlNode,
    theirs: XmlNode,
    owner: Owner,
    tag: string,
  ): Record<string, string> {
    const b = rawAttributes(base);
    const o = rawAttributes(ours);
    const t = rawAttributes(theirs);
    const merged: Record<string, string> = {};
    const names = [...new Set([...Object.keys(t), ...Object.keys(o), ...Object.keys(b)])];
    for (const name of names) {
      const [vb, vo, vt] = [b[name], o[name], t[name]].map((value) =>
        value === undefined ? undefined : decode(value),
      );
      let value: string | undefined;
      if (vo === vb) value = t[name];
      else if (vt === vb || vo === vt) value = o[name];
      else {
        this.conflict(owner, keepsWhitespace(tag) ? 'text' : name);
        value = t[name];
      }
      if (value !== undefined) merged[name] = value;
    }
    return merged;
  }

  private children(base: XmlNode, ours: XmlNode, theirs: XmlNode, owner: Owner): XmlNode[] {
    const b = keyed(base);
    const o = keyed(ours);
    const t = keyed(theirs);
    const textual = keepsWhitespace(tagOf(base));
    const result = new Map<string, XmlNode>();
    const conflict = (node: XmlNode) => {
      const tag = tagOf(node);
      const id = tag === null ? undefined : attr(node, 'xml:id');
      this.conflict(
        id ? { elementId: id, name: attr(node, 'draw:name') ?? null } : owner,
        textual || tag === null ? 'text' : `<${tag}>`,
      );
    };
    for (const key of new Set([...t.order, ...o.order, ...b.order])) {
      const nb = b.nodes.get(key);
      const no = o.nodes.get(key);
      const nt = t.nodes.get(key);
      if (nb && no && nt) result.set(key, this.node(nb, no, nt, owner));
      else if (nb && !no && nt) {
        // We removed it: gone, unless they changed it meanwhile.
        if (!sameNode(nb, nt)) {
          conflict(nt);
          result.set(key, nt);
        }
      } else if (nb && no && !nt) {
        // They removed it: gone, unless we changed it.
        if (!sameNode(nb, no)) conflict(no);
      } else if (!nb && no && nt) {
        // Both added something here.
        if (!sameNode(no, nt)) conflict(nt);
        result.set(key, nt);
      } else if (!nb && no) result.set(key, no);
      else if (!nb && nt) result.set(key, nt);
    }

    // The order: theirs, unless only we moved things – then ours; moved both ways is a conflict.
    const common = (order: string[]) =>
      order.filter((key) => b.nodes.has(key) && o.nodes.has(key) && t.nodes.has(key));
    const [cb, co, ct] = [common(b.order), common(o.order), common(t.order)];
    let lead = t;
    let other = o;
    if (!sameOrder(co, cb) && sameOrder(ct, cb)) {
      lead = o;
      other = t;
    } else if (!sameOrder(co, cb) && !sameOrder(co, ct)) {
      this.conflict(owner, 'order');
    }
    const sequence = lead.order.filter((key) => result.has(key));
    // What only the other side added goes after what comes before it there.
    other.order.forEach((key, i) => {
      if (!result.has(key) || sequence.includes(key)) return;
      const before = other.order
        .slice(0, i)
        .reverse()
        .find((previous) => sequence.includes(previous));
      sequence.splice(before === undefined ? 0 : sequence.indexOf(before) + 1, 0, key);
    });
    return sequence.map((key) => result.get(key) as XmlNode);
  }
}

/**
 * Merges two changes of a slide: `base` as both started from, changed to `ours` (the change
 * going in) and meanwhile to `theirs` (the slide as it is now). What only one side changed is
 * taken from it; what both changed alike is fine; what both changed differently is a conflict.
 */
export function mergeSlide(base: string, ours: string, theirs: string): SlideMerge {
  const merger = new Merger();
  const page = merger.node(pageOf(base), pageOf(ours), pageOf(theirs), {
    elementId: null,
    name: null,
  });
  if (merger.conflicts.length > 0) return { xml: null, conflicts: merger.conflicts };
  return { xml: buildPart({ declaration: '', nodes: [page] }), conflicts: [] };
}

/** Attributes that name a style but do not end in `-name`. */
const OTHER_STYLE_REFERENCES = new Set([
  'draw:marker-start',
  'draw:marker-end',
  'draw:stroke-dash',
  'draw:stroke-dash-names',
]);

const refersToStyle = (name: string): boolean =>
  (name.endsWith('-name') && name !== 'style:display-name') || OTHER_STYLE_REFERENCES.has(name);

/** Points references to renamed styles at their new names, in `nodes` and everything below. */
export function renameStyleReferences(
  nodes: readonly XmlNode[],
  renames: ReadonlyMap<string, string>,
): void {
  if (renames.size === 0) return;
  const walk = (node: XmlNode) => {
    const attributes = rawAttributes(node);
    for (const name of Object.keys(attributes)) {
      if (!refersToStyle(name)) continue;
      const value = decode(attributes[name] as string);
      const renamed = value
        .split(' ')
        .map((part) => renames.get(part) ?? part)
        .join(' ');
      if (renamed !== value) attributes[name] = escapeAttribute(renamed);
    }
    for (const child of elementChildren(node)) walk(child);
  };
  for (const node of nodes) walk(node);
}

/**
 * XML (a slide, or styles one after another) with references to renamed styles pointing at
 * their new names – and, with `own`, styles named in `renames` renamed themselves.
 */
export function renameStyles(
  xml: string,
  renames: ReadonlyMap<string, string>,
  { own = false }: { own?: boolean } = {},
): string {
  if (renames.size === 0) return xml;
  const [root] = parsePart(`<fragment>${xml}</fragment>`, 'styles').nodes;
  const nodes = root ? childrenOf(root) : [];
  const elements = nodes.filter((node) => tagOf(node) !== null);
  renameStyleReferences(elements, renames);
  if (own) {
    for (const node of elements) {
      for (const name of ['style:name', 'draw:name']) {
        const value = attr(node, name);
        const renamed = value === undefined ? undefined : renames.get(value);
        if (renamed) rawAttributes(node)[name] = escapeAttribute(renamed);
      }
    }
  }
  return buildPart({ declaration: '', nodes });
}
