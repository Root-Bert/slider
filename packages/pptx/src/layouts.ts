import { REL, type Archive } from './archive';
import { readColorScheme, resolveColor, type ColorScheme } from './colors';
import { readExtGuides, type EmuGuide } from './guides';
import { walkShapeTree, type PlaceholderRef } from './shape-tree';
import {
  mergeTextDefaults,
  NO_TEXT_DEFAULTS,
  readListStyleDefaults,
  type TextDefaults,
} from './text';
import type { EmuRect } from './transform';
import { attr, child, path, type XmlElement } from './xml';

/** A placeholder as defined on a layout or master: where it sits and how its text looks. */
interface PlaceholderTemplate extends PlaceholderRef {
  box: EmuRect | null;
  text: TextDefaults;
}

interface MasterInfo {
  placeholders: PlaceholderTemplate[];
  titleStyle: TextDefaults;
  bodyStyle: TextDefaults;
  background: string | null;
  scheme: ColorScheme;
  guides: EmuGuide[];
}

/** What a slide inherits from its layout and, through it, from the slide master. */
export interface LayoutContext {
  name: string | null;
  background: string | null;
  scheme: ColorScheme;
  /** Guides set in slide master view, on the master or the layout. */
  guides: EmuGuide[];
  /** Position and text defaults for a slide placeholder (both may be unknown). */
  resolvePlaceholder(ref: PlaceholderRef): { box: EmuRect | null; text: TextDefaults };
}

/**
 * Masters place placeholders by type only, and several content types share the master's body
 * placeholder. Layout placeholders are matched by `idx` first and fall back to this, too.
 */
const MASTER_PLACEHOLDER_TYPE: Record<string, string> = {
  ctrTitle: 'title',
  subTitle: 'body',
  obj: 'body',
  pic: 'body',
  tbl: 'body',
  chart: 'body',
  dgm: 'body',
  media: 'body',
  clipArt: 'body',
};

const masterTypeOf = (type: string): string => MASTER_PLACEHOLDER_TYPE[type] ?? type;
const isTitleType = (type: string): boolean => masterTypeOf(type) === 'title';

const EMPTY_SCHEME: ColorScheme = new Map();

/** Loads layouts and masters on demand and caches them per part. */
export class LayoutResolver {
  private readonly layouts = new Map<string, Promise<LayoutContext>>();
  private readonly masters = new Map<string, Promise<MasterInfo | null>>();

  constructor(private readonly archive: Archive) {}

  /** Context for a slide, based on its `slideLayout` relationship. */
  async forSlide(slidePath: string): Promise<LayoutContext> {
    const [layoutRel] = await this.archive.relationshipsOfType(slidePath, REL.slideLayout);
    const layoutPath = layoutRel?.target ?? '';
    let context = this.layouts.get(layoutPath);
    if (!context) {
      context = this.loadLayout(layoutPath);
      this.layouts.set(layoutPath, context);
    }
    return context;
  }

  private async loadLayout(layoutPath: string): Promise<LayoutContext> {
    const layout = layoutPath ? await this.archive.readXml(layoutPath) : null;
    const [masterRel] = layout
      ? await this.archive.relationshipsOfType(layoutPath, REL.slideMaster)
      : [];
    const master = masterRel ? await this.master(masterRel.target) : null;
    const scheme = master?.scheme ?? EMPTY_SCHEME;
    const cSld = child(layout, 'p:cSld');
    const layoutPlaceholders = readPlaceholderTemplates(cSld);
    const masterPlaceholders = master?.placeholders ?? [];

    return {
      name: attr(cSld, 'name') ?? null,
      background: readBackground(cSld, scheme) ?? master?.background ?? null,
      scheme,
      guides: [...(master?.guides ?? []), ...readExtGuides(layout)],
      resolvePlaceholder(ref) {
        const onLayout = findPlaceholder(layoutPlaceholders, ref);
        const onMaster = findPlaceholder(masterPlaceholders, {
          type: masterTypeOf(onLayout?.type ?? ref.type),
          idx: null,
        });
        const textStyle = isTitleType(ref.type) ? master?.titleStyle : master?.bodyStyle;
        return {
          box: onLayout?.box ?? onMaster?.box ?? null,
          text: [onLayout?.text, onMaster?.text, textStyle].reduce<TextDefaults>(
            (merged, next) => (next ? mergeTextDefaults(merged, next) : merged),
            NO_TEXT_DEFAULTS,
          ),
        };
      },
    };
  }

  private master(masterPath: string): Promise<MasterInfo | null> {
    let master = this.masters.get(masterPath);
    if (!master) {
      master = this.loadMaster(masterPath);
      this.masters.set(masterPath, master);
    }
    return master;
  }

  private async loadMaster(masterPath: string): Promise<MasterInfo | null> {
    const master = await this.archive.readXml(masterPath);
    if (!master) return null;
    const [themeRel] = await this.archive.relationshipsOfType(masterPath, REL.theme);
    const scheme = readColorScheme(themeRel ? await this.archive.readXml(themeRel.target) : null);
    const cSld = child(master, 'p:cSld');
    return {
      placeholders: readPlaceholderTemplates(cSld),
      titleStyle: readListStyleDefaults(path(master, 'p:txStyles', 'p:titleStyle')),
      bodyStyle: readListStyleDefaults(path(master, 'p:txStyles', 'p:bodyStyle')),
      background: readBackground(cSld, scheme),
      scheme,
      guides: readExtGuides(master),
    };
  }
}

/** Solid background of a `p:cSld`: `p:bg/p:bgPr/a:solidFill`, or the colour of `p:bg/p:bgRef`. */
export function readBackground(cSld: XmlElement | undefined, scheme: ColorScheme): string | null {
  const background = child(cSld, 'p:bg');
  return (
    resolveColor(path(background, 'p:bgPr', 'a:solidFill'), scheme) ??
    resolveColor(child(background, 'p:bgRef'), scheme)
  );
}

function readPlaceholderTemplates(cSld: XmlElement | undefined): PlaceholderTemplate[] {
  const templates: PlaceholderTemplate[] = [];
  for (const shape of walkShapeTree(child(cSld, 'p:spTree'))) {
    if (!shape.placeholder) continue;
    templates.push({
      ...shape.placeholder,
      box: shape.box,
      text: readListStyleDefaults(path(shape.element, 'p:txBody', 'a:lstStyle')),
    });
  }
  return templates;
}

/** Matches by `idx` first, then by type (exact, then by the master's type family). */
function findPlaceholder(
  templates: PlaceholderTemplate[],
  ref: PlaceholderRef,
): PlaceholderTemplate | undefined {
  return (
    (ref.idx !== null ? templates.find((template) => template.idx === ref.idx) : undefined) ??
    templates.find((template) => template.type === ref.type) ??
    templates.find((template) => masterTypeOf(template.type) === masterTypeOf(ref.type))
  );
}
