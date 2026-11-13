import {
  OdpDocument,
  OdpError,
  isOdpBytes,
  slidePlaceholders,
  type OdpMasterPage,
} from '@slider/odp';
import {
  MAX_MASTER_LAYOUTS,
  NO_LAYOUTS,
  PptxError,
  masterDeck,
  type MasterLayout,
} from '@slider/pptx';
import type { TemplateColor } from '@slider/shared';
import { badRequest } from '../http/errors';

/*
 * A company design uploaded as slide masters: a template, OpenDocument (`.otp`) or PowerPoint
 * (`.potx`). Read here into its layouts – an ODP's master pages are one each, PowerPoint's
 * masters have several – and a deck with one slide per layout, for LibreOffice to draw them as
 * pictures. A presentation is refused: it would bring its slides along, content no design needs.
 */

export interface MasterFile {
  format: 'pptx' | 'odp';
  /** The file as kept: no external links, still a template (`.otp`, `.potx`). */
  file: Uint8Array;
  /** One slide per layout, in `layouts`' order. */
  deck: Uint8Array;
  layouts: MasterLayout[];
  /** Width / height of its slides. */
  aspectRatio: number;
  /** Its theme's colours, as a template's („Farben“) – empty when it has no theme. */
  colors: TemplateColor[];
}

/**
 * The theme slots a design's colours come from – PowerPoint's name, LibreOffice's, what Slider
 * calls it – in the order of PowerPoint's colour picker, without the two link colours.
 */
const THEME_SLOTS = [
  ['lt1', 'light1', 'Hintergrund 1'],
  ['dk1', 'dark1', 'Text 1'],
  ['lt2', 'light2', 'Hintergrund 2'],
  ['dk2', 'dark2', 'Text 2'],
  ...[1, 2, 3, 4, 5, 6].map((n) => [`accent${n}`, `accent${n}`, `Akzent ${n}`]),
] as const;

/** A theme's colours (by PowerPoint's or LibreOffice's slot names) as a template's, each once. */
export function themeTemplateColors(theme: ReadonlyMap<string, string>): TemplateColor[] {
  const colors: TemplateColor[] = [];
  for (const [pptx, odp, name] of THEME_SLOTS) {
    const color = (theme.get(pptx) ?? theme.get(odp))?.toLowerCase();
    if (color && !colors.some((kept) => kept.color === color)) colors.push({ color, name });
  }
  return colors;
}

/** The colours of a design's file as kept (`MasterFile.file`); empty when it has no theme. */
export async function masterFileColors(bytes: Uint8Array): Promise<TemplateColor[]> {
  if (isOdpBytes(bytes)) return themeTemplateColors((await OdpDocument.open(bytes)).themeColors());
  return themeTemplateColors((await masterDeck(bytes)).colors);
}

const escapeXml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!,
  );

const NO_MASTER = 'In der Datei ist kein Folienmaster.';
const NOT_A_TEMPLATE =
  'Das ist eine Präsentation. Bitte als Vorlage speichern und erneut hochladen.';
const UNREADABLE = 'Das ist keine Präsentation oder Vorlage, die Slider lesen kann.';

/** What a master page's placeholders say on its picture. */
const ODP_LABELS = {
  title: 'Titel',
  subtitle: 'Untertitel',
  outline: 'Text',
  picture: 'Bild',
} as const;

/** A placeholder's frame and its kind on a layout's picture: light grey, like an empty slot. */
const PLACEHOLDER_LINE = '#b4b4b4';
const PLACEHOLDER_TEXT = '#8c8c8c';

/** LibreOffice's encoded style names: `Title_20_Slide` → "Title Slide". */
const decodeStyleName = (name: string) =>
  name.replace(/_([0-9a-f]{2})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

/**
 * What LibreOffice names a PowerPoint layout it takes in – `Master1-Layout3-cust-Title-with-
 * Picture-2`, the master alone `Master1-RetroFormFusion` – read back as PowerPoint showed it:
 * "Title with Picture 2", "RetroFormFusion". Other names stay as they are.
 */
const IMPORTED_LAYOUT = /^Master\d+-(?:Layout\d+-[A-Za-z]+-)?(.+)$/;

/** An ODP master page's layout name, as a design keeps it. */
export const odpLayoutName = (master: OdpMasterPage) => {
  const name = master.displayName ?? decodeStyleName(master.name);
  const imported = IMPORTED_LAYOUT.exec(name)?.[1];
  return imported ? imported.replaceAll('-', ' ') : name;
};

/** The master pages of an ODP design that are its layouts, in their order. */
export const odpLayoutPages = (document: OdpDocument) =>
  document.masterPages().slice(0, MAX_MASTER_LAYOUTS);

/**
 * A presentation of `document`'s layouts, one slide each with its placeholders labelled, none of
 * its own slides – for LibreOffice to draw them. `document` stays as it is.
 */
export async function odpLayoutDeck(document: OdpDocument): Promise<Uint8Array> {
  // LibreOffice draws a presentation; a template would open as a new, unnamed one.
  const deck = await OdpDocument.open(await document.toBytes());
  deck.markAsPresentation();
  const own = deck.slides().length;
  // Placeholders drawn as what they are – a frame to fill, its kind in grey – not in the look
  // the master gives their text (a coloured fill, white letters …): one style each on top of it.
  const placeholderLooks = new Map<string, string>();
  const lookOf = (style: string | null) => {
    const kept = placeholderLooks.get(style ?? '');
    if (kept) return kept;
    const name = `SliderPlaceholder${placeholderLooks.size + 1}`;
    const renames = deck.addOwnStyles(
      `<style:style style:name="${name}" style:family="presentation"${style ? ` style:parent-style-name="${escapeXml(style)}"` : ''}><style:graphic-properties draw:fill="none" draw:stroke="solid" svg:stroke-width="0.03cm" svg:stroke-color="${PLACEHOLDER_LINE}" draw:shadow="hidden"/><style:text-properties fo:color="${PLACEHOLDER_TEXT}"/></style:style>`,
    );
    const look = renames.get(name) ?? name;
    placeholderLooks.set(style ?? '', look);
    return look;
  };
  odpLayoutPages(deck).forEach((master, index) => {
    // Each labelled with what it asks for when designed in Slider, else with its kind.
    const frames = slidePlaceholders(master)
      .map((frame) => {
        const label = (frame.prompt || ODP_LABELS[frame.kind])
          .split('\n')
          .map((line) => `<text:p>${escapeXml(line)}</text:p>`)
          .join('');
        return `<draw:frame presentation:style-name="${escapeXml(lookOf(frame.style))}" draw:layer="layout"${frame.kind === 'picture' ? '' : ` presentation:class="${frame.kind}"`} svg:x="${escapeXml(frame.x)}" svg:y="${escapeXml(frame.y)}" svg:width="${escapeXml(frame.width)}" svg:height="${escapeXml(frame.height)}"><draw:text-box>${label}</draw:text-box></draw:frame>`;
      })
      .join('');
    deck.insertSlide(
      own + index,
      `<draw:page draw:name="slider-master-${index + 1}" draw:master-page-name="${escapeXml(master.name)}">${frames}</draw:page>`,
    );
  });
  for (let i = 0; i < own; i += 1) deck.removeSlide(0);
  return deck.toBytes();
}

async function odpMasterFile(bytes: Uint8Array): Promise<MasterFile> {
  const document = await OdpDocument.open(bytes);
  if (!document.isTemplate()) throw badRequest(NOT_A_TEMPLATE);
  document.ensureIds();
  document.removeExternalLinks();
  const file = await document.toBytes();

  const masters = odpLayoutPages(document);
  if (masters.length === 0) throw badRequest(NO_MASTER);
  const size = document.pageSize();
  return {
    format: 'odp',
    file,
    deck: await odpLayoutDeck(document),
    layouts: masters.map((master) => ({ master: null, name: odpLayoutName(master) })),
    aspectRatio: size.width / size.height,
    colors: themeTemplateColors(document.themeColors()),
  };
}

/**
 * Reads an uploaded design. A file that is no template, or has no master, is a `400` with a
 * German reason.
 */
export async function readMasterFile(bytes: Uint8Array): Promise<MasterFile> {
  try {
    if (isOdpBytes(bytes)) return await odpMasterFile(bytes);
    const read = await masterDeck(bytes);
    if (!read.template) throw badRequest(NOT_A_TEMPLATE);
    return {
      format: 'pptx',
      file: read.file,
      deck: read.deck,
      layouts: read.layouts,
      aspectRatio: read.size.cx / read.size.cy,
      colors: themeTemplateColors(read.colors),
    };
  } catch (error) {
    if (error instanceof PptxError) {
      throw badRequest(
        error.code === 'encrypted'
          ? 'Die Datei ist passwortgeschützt. Bitte ohne Kennwort speichern und erneut hochladen.'
          : error.message === NO_LAYOUTS
            ? NO_MASTER
            : UNREADABLE,
      );
    }
    if (error instanceof OdpError) throw badRequest(UNREADABLE);
    throw error;
  }
}
