import { attr, attributeNames, childrenOf, firstChild, tagOf, type XmlNode } from './xml';

/*
 * ODF styles resolved the way LibreOffice reads them: a style's properties are its own over its
 * parent's (`style:parent-style-name`), down to the family's default style. Elements of a slide
 * name their styles from content.xml's automatic styles or styles.xml's common styles; those of
 * a master page from styles.xml's automatic or common styles. A parent is always a common style:
 * LibreOffice ignores a parent named among the automatic styles (ODF allows no other).
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
  /** styles.xml's common styles: the only ones a style can have as its parent. */
  private readonly commonByKey = new Map<string, XmlNode>();
  /** content.xml's automatic styles and the faces content.xml declares (`content`). */
  private readonly contentStyles = new Set<XmlNode>();
  private readonly contentFonts: Set<string> | null = null;
  private readonly defaults = new Map<string, XmlNode>();
  private readonly lists = new Map<string, XmlNode>();
  private readonly dashes = new Map<string, XmlNode>();
  private readonly markers = new Map<string, XmlNode>();
  private readonly gradients = new Map<string, XmlNode>();
  private readonly fillImages = new Map<string, XmlNode>();
  private readonly opacities = new Map<string, XmlNode>();
  private readonly fonts = new Map<string, string>();

  /**
   * `containers` in lookup order: the first that has a name wins (content.xml's automatic
   * styles before the common ones). `fontDecls` are the `office:font-face-decls` of both parts.
   * `common`: styles.xml's `office:styles`, where parents are looked up. `content`: content.xml's
   * automatic styles and font declarations – LibreOffice resolves a `style:font-name` there
   * only among content.xml's faces.
   */
  constructor(
    containers: readonly XmlNode[],
    fontDecls: readonly XmlNode[],
    common?: XmlNode,
    content?: { styles?: XmlNode; fonts?: XmlNode },
  ) {
    if (content) {
      for (const node of content.styles ? childrenOf(content.styles) : []) {
        this.contentStyles.add(node);
      }
      this.contentFonts = new Set(
        (content.fonts ? childrenOf(content.fonts) : [])
          .filter((face) => tagOf(face) === 'style:font-face')
          .map((face) => attr(face, 'style:name'))
          .filter((name): name is string => !!name),
      );
    }
    for (const node of common ? childrenOf(common) : []) {
      const name = attr(node, 'style:name');
      if (tagOf(node) === 'style:style' && name) {
        this.commonByKey.set(`${attr(node, 'style:family')}:${name}`, node);
      }
    }
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
        } else if (tag === 'draw:stroke-dash') {
          const dash = attr(node, 'draw:name');
          if (dash && !this.dashes.has(dash)) this.dashes.set(dash, node);
        } else if (tag === 'draw:marker') {
          const marker = attr(node, 'draw:name');
          if (marker && !this.markers.has(marker)) this.markers.set(marker, node);
        } else if (tag === 'draw:gradient' || tag === 'draw:fill-image' || tag === 'draw:opacity') {
          const named =
            tag === 'draw:gradient'
              ? this.gradients
              : tag === 'draw:opacity'
                ? this.opacities
                : this.fillImages;
          const fill = attr(node, 'draw:name');
          if (fill && !named.has(fill)) named.set(fill, node);
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

  /** The style and its parents (common styles only, as LibreOffice reads them), root first. */
  chain(family: string, name: string | undefined): XmlNode[] {
    const chain: XmlNode[] = [];
    let current = this.style(family, name);
    while (current && chain.length < MAX_DEPTH && !chain.includes(current)) {
      chain.unshift(current);
      const parent = attr(current, 'style:parent-style-name');
      current = parent ? this.commonByKey.get(`${family}:${parent}`) : undefined;
    }
    return chain;
  }

  defaultStyle(family: string): XmlNode | undefined {
    return this.defaults.get(family);
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

  /** A dash pattern (`draw:stroke-dash`) by its `draw:name`. */
  dash(name: string | undefined): XmlNode | undefined {
    return name ? this.dashes.get(name) : undefined;
  }

  /** A line end (`draw:marker`, an arrow head) by its `draw:name`. */
  marker(name: string | undefined): XmlNode | undefined {
    return name ? this.markers.get(name) : undefined;
  }

  /** A gradient (`draw:gradient`) by its `draw:name`. */
  gradient(name: string | undefined): XmlNode | undefined {
    return name ? this.gradients.get(name) : undefined;
  }

  /** A see-through gradient (`draw:opacity`) by its `draw:name`. */
  opacity(name: string | undefined): XmlNode | undefined {
    return name ? this.opacities.get(name) : undefined;
  }

  /** A fill picture (`draw:fill-image`) by its `draw:name`. */
  fillImage(name: string | undefined): XmlNode | undefined {
    return name ? this.fillImages.get(name) : undefined;
  }

  /** The family name a `style:font-name` stands for. */
  font(name: string): string {
    return this.fonts.get(name) ?? name;
  }

  /**
   * A style's properties as LibreOffice reads them: a `style:font-name` of content.xml naming a
   * face only styles.xml declares means nothing (decks started blank declare Inter there only).
   */
  propertiesOf(style: XmlNode, kind: PropertyKind): Properties {
    const props = propertiesOf(style, kind);
    const name = props['style:font-name'];
    if (
      name &&
      this.contentFonts &&
      this.contentStyles.has(style) &&
      !this.contentFonts.has(name)
    ) {
      delete props['style:font-name'];
    }
    return props;
  }

  /**
   * The `style:font-face` name for a family, for a style of content.xml: one content.xml
   * declares (LibreOffice looks no further), else none – the family is then named as it is.
   */
  fontFaceFor(family: string): string | undefined {
    for (const [name, value] of this.fonts) {
      if (value === family && (!this.contentFonts || this.contentFonts.has(name))) return name;
    }
    return undefined;
  }
}

export const unquote = (family: string): string =>
  family
    .split(',')[0]!
    .trim()
    .replace(/^['"]|['"]$/g, '');
