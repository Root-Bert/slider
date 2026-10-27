import { attr, attributeNames, childrenOf, firstChild, tagOf, type XmlNode } from './xml';

/*
 * ODF styles resolved the way LibreOffice reads them: a style's properties are its own over its
 * parent's (`style:parent-style-name`), down to the family's default style. Elements of a slide
 * name their styles from content.xml's automatic styles or styles.xml's common styles; those of
 * a master page from styles.xml's automatic or common styles.
 */

export type Properties = Record<string, string>;

/** `style:text-properties`, `style:paragraph-properties`, `style:graphic-properties`. */
export type PropertyKind = 'text' | 'paragraph' | 'graphic';

const PROPERTY_TAG: Record<PropertyKind, string> = {
  text: 'style:text-properties',
  paragraph: 'style:paragraph-properties',
  graphic: 'style:graphic-properties',
};

/** Paragraph styles may carry graphic properties under LibreOffice's own name. */
const ALSO_TAG: Partial<Record<PropertyKind, string>> = { graphic: 'loext:graphic-properties' };

const MAX_DEPTH = 20;

export const propertiesOf = (style: XmlNode, kind: PropertyKind): Properties => {
  const out: Properties = {};
  for (const tag of [PROPERTY_TAG[kind], ALSO_TAG[kind]]) {
    const node = tag && firstChild(style, tag);
    if (!node) continue;
    for (const name of attributeNames(node)) out[name] = attr(node, name) ?? '';
  }
  return out;
};

export class StyleIndex {
  private readonly byKey = new Map<string, XmlNode>();
  private readonly defaults = new Map<string, XmlNode>();
  private readonly lists = new Map<string, XmlNode>();
  private readonly fonts = new Map<string, string>();

  /**
   * `containers` in lookup order: the first that has a name wins (content.xml's automatic
   * styles before the common ones). `fontDecls` are the `office:font-face-decls` of both parts.
   */
  constructor(containers: readonly XmlNode[], fontDecls: readonly XmlNode[]) {
    for (const container of containers) {
      for (const node of childrenOf(container)) {
        const tag = tagOf(node);
        const name = attr(node, 'style:name');
        if (tag === 'style:default-style') {
          const family = attr(node, 'style:family') ?? '';
          if (!this.defaults.has(family)) this.defaults.set(family, node);
        } else if (tag === 'style:style' && name) {
          const key = `${attr(node, 'style:family')}:${name}`;
          if (!this.byKey.has(key)) this.byKey.set(key, node);
        } else if (tag === 'text:list-style' && name && !this.lists.has(name)) {
          this.lists.set(name, node);
        }
      }
    }
    for (const decls of fontDecls) {
      for (const face of childrenOf(decls)) {
        const name = attr(face, 'style:name');
        const family = attr(face, 'svg:font-family');
        if (tagOf(face) === 'style:font-face' && name && family && !this.fonts.has(name)) {
          this.fonts.set(name, unquote(family));
        }
      }
    }
  }

  style(family: string, name: string | undefined): XmlNode | undefined {
    return name ? this.byKey.get(`${family}:${name}`) : undefined;
  }

  has(family: string, name: string): boolean {
    return this.byKey.has(`${family}:${name}`);
  }

  /** The style and its parents, root first. */
  chain(family: string, name: string | undefined): XmlNode[] {
    const chain: XmlNode[] = [];
    let current = this.style(family, name);
    while (current && chain.length < MAX_DEPTH && !chain.includes(current)) {
      chain.unshift(current);
      current = this.style(family, attr(current, 'style:parent-style-name'));
    }
    return chain;
  }

  defaultStyle(family: string): XmlNode | undefined {
    return this.defaults.get(family);
  }

  /** Properties of a style with its parents, without the family's default. */
  resolve(family: string, name: string | undefined, kind: PropertyKind): Properties {
    return Object.assign({}, ...this.chain(family, name).map((style) => propertiesOf(style, kind)));
  }

  /** The style's list style: its own `style:list-style-name`, or one inside its graphic properties. */
  listStyleOf(family: string, name: string | undefined): XmlNode | undefined {
    for (const style of this.chain(family, name).reverse()) {
      const named = attr(style, 'style:list-style-name');
      if (named && this.lists.has(named)) return this.lists.get(named);
      const graphic = firstChild(style, 'style:graphic-properties');
      const inner = graphic && firstChild(graphic, 'text:list-style');
      if (inner) return inner;
    }
    return undefined;
  }

  list(name: string | undefined): XmlNode | undefined {
    return name ? this.lists.get(name) : undefined;
  }

  /** The family name a `style:font-name` stands for. */
  font(name: string): string {
    return this.fonts.get(name) ?? name;
  }

  /** The `style:font-face` name for a family, if the file declares one. */
  fontFaceFor(family: string): string | undefined {
    for (const [name, value] of this.fonts) if (value === family) return name;
    return undefined;
  }

  /** Every style name of `family` (for picking free names). */
  names(): Set<string> {
    return new Set([...this.byKey.keys()].map((key) => key.slice(key.indexOf(':') + 1)));
  }
}

export const unquote = (family: string): string =>
  family
    .split(',')[0]!
    .trim()
    .replace(/^['"]|['"]$/g, '');
