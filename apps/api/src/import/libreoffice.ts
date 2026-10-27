import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { access, constants, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { OdpDocument, isOdpBytes, type EmbeddedFont } from '@slider/odp';
import { withoutExternalLinks } from '@slider/pptx';
import JSZip from 'jszip';
import { OFFICE_FONT_SUBSTITUTES, officeFontFor } from '@slider/shared';
import type { Logger } from '../logger';
import { isPdfBytes } from '../sources/safe-fetch';
import { PoolUnavailable, type OfficePool, type PoolPriority } from './office-pool';

/**
 * A PPTX (or ODP, BER-177) turned into a PDF by an office suite (LibreOffice), for uploads
 * (BER-94). `pages`, when present, draws only some slides of an ODP – what an edit changed:
 * 1-based positions in the file, hidden slides counted (as LibreOffice's page range counts
 * them); ask for visible slides only, a hidden one is not drawn. `priority`: someone waits for it
 * on screen (`interactive`, the default) or it is drawn ahead (`background`) – with the render
 * pool, the first go first.
 */
export type PptxToPdf = ((
  pptx: Uint8Array,
  options?: {
    /** The workspace's own fonts: drawn in them where the deck names them. */
    fonts?: readonly EmbeddedFont[];
  },
) => Promise<Uint8Array>) & {
  pages?: (
    deck: Uint8Array,
    pages: readonly number[],
    options?: {
      priority?: PoolPriority;
      key?: string;
      /**
       * The deck is already as LibreOffice is to draw it (`OdpDocument.toDrawingBytes`, the
       * workspace's fonts embedded).
       */
      prepared?: boolean;
      /** The workspace's own fonts, for a deck not prepared yet. */
      fonts?: readonly EmbeddedFont[];
    },
  ) => Promise<Uint8Array>;
  /** A drawing asked for ahead (`key`) is now waited for: it goes first (render pool only). */
  promote?: (key: string) => void;
};

/** Documents LibreOffice turns into a review deck: Word, Excel, PowerPoint variants and text. */
export type OfficeDocumentKind = keyof typeof DOCUMENT_IMPORT_FILTERS;

/** Any other document as a PDF, for files picked in a cloud that are no deck yet. */
export type DocumentToPdf = (bytes: Uint8Array, kind: OfficeDocumentKind) => Promise<Uint8Array>;

/** A conversion that takes longer is killed; the slides keep their SVG preview. */
export const LIBREOFFICE_TIMEOUT_MS = 120_000;

/** LibreOffice's import filter for .pptx (OOXML presentations). */
const PPTX_IMPORT_FILTER = 'Impress MS PowerPoint 2007 XML';
/** … and for .odp, its own format. */
const ODP_IMPORT_FILTER = 'impress8';

/** The PDF export of only some pages (LibreOffice's `PageRange` filter option). */
const pdfOfPages = (pages: readonly number[]) =>
  `pdf:impress_pdf_Export:${JSON.stringify({ PageRange: { type: 'string', value: pages.join(',') } })}`;

/** An ODP without links LibreOffice could follow (Slider stores them so; this is the second line). */
async function withoutOdpLinks(odp: Uint8Array): Promise<Uint8Array> {
  const document = await OdpDocument.open(odp);
  return document.removeExternalLinks() > 0 ? document.toBytes() : odp;
}

/**
 * What LibreOffice draws a font as: the same pairs as its replacement table
 * ({@link fontReplacements}) – but a family the workspace has fonts of (`own`) stays itself.
 */
export function fontSubstituteFor(
  own: readonly { family: string }[] = [],
): (family: string) => string | null {
  const kept = new Set(own.map((font) => font.family.toLowerCase()));
  return (family) => {
    if (kept.has(family.toLowerCase())) return null;
    const substitute = OFFICE_FONT_SUBSTITUTES[family] ?? officeFontFor(family);
    return substitute && substitute !== family ? substitute : null;
  };
}

/** {@link fontSubstituteFor} a workspace without fonts of its own. */
export const fontSubstitute = fontSubstituteFor();

/**
 * An ODP as an edit is drawn: without links, and its fonts named by what LibreOffice's
 * replacement table would draw them as – the render pool's LibreOffice keeps one profile for
 * every deck, so the deck's own pairs go into the file.
 */
async function odpForDrawing(
  odp: Uint8Array,
  fonts: readonly EmbeddedFont[] = [],
): Promise<Uint8Array> {
  const document = await OdpDocument.open(odp);
  const changed =
    document.removeExternalLinks() +
    document.embedFonts(fonts) +
    document.replaceFonts(fontSubstituteFor(fonts));
  return changed > 0 ? document.toBytes() : odp;
}

/**
 * The documents {@link createLibreOfficeDocumentPdf} takes, by extension, with the one import
 * filter each is read with. Office Open XML only (its external links can be dropped before
 * LibreOffice sees it) and plain text – no format LibreOffice could be made to fetch from.
 */
export const DOCUMENT_IMPORT_FILTERS = {
  docx: 'MS Word 2007 XML',
  docm: 'MS Word 2007 XML VBA',
  xlsx: 'Calc MS Excel 2007 XML',
  xlsm: 'Calc MS Excel 2007 VBA XML',
  pptm: 'Impress MS PowerPoint 2007 XML VBA',
  ppsx: 'Impress MS PowerPoint 2007 XML AutoPlay',
  txt: 'Text (encoded):UTF8',
  md: 'Text (encoded):UTF8',
  // Comma-separated, double quotes, UTF-8 (tokens 1–3), from line 1, standard columns, system
  // language, special numbers (dates) detected as before – and token 13 `false`: formulas stay
  // text, so a cell like `=WEBSERVICE("http://…")` is never evaluated (LibreOffice's "Filter
  // Options for the CSV Filter"; tokens 9–12 are for export only).
  csv: 'Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,,false',
} as const;

const isOoxml = (kind: OfficeDocumentKind) => !['txt', 'md', 'csv'].includes(kind);

/**
 * LibreOffice's font replacement table: Office's fonts always drawn in their free twins, the
 * same the browser draws live elements in (`OFFICE_FONT_SUBSTITUTES`) – whatever is installed –
 * and every other font a deck names in a free one of its kind (`officeFontFor`), not in
 * whatever the computer falls back to (a serif for a sans on macOS).
 */
function fontReplacements(fonts: readonly string[] = [], own: readonly string[] = []): string {
  const escape = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  // The workspace's own fonts are drawn as themselves – even one named like an Office font.
  const kept = new Set(own.map((family) => family.toLowerCase()));
  const pairs = new Map(
    Object.entries(OFFICE_FONT_SUBSTITUTES).filter(([font]) => !kept.has(font.toLowerCase())),
  );
  for (const font of fonts) {
    if (kept.has(font.toLowerCase())) continue;
    const substitute = officeFontFor(font);
    if (substitute && substitute !== font && !pairs.has(font)) pairs.set(font, substitute);
  }
  return [...pairs]
    .map(
      ([font, substitute], i) =>
        `<item oor:path="/org.openoffice.Office.Common/Font/Substitution/FontPairs"><node oor:name="_${i}" oor:op="replace">` +
        `<prop oor:name="Always" oor:op="fuse"><value>true</value></prop>` +
        `<prop oor:name="OnScreenOnly" oor:op="fuse"><value>false</value></prop>` +
        `<prop oor:name="ReplaceFont" oor:op="fuse"><value>${escape(font)}</value></prop>` +
        `<prop oor:name="SubstituteFont" oor:op="fuse"><value>${escape(substitute)}</value></prop>` +
        `</node></item>`,
    )
    .join('\n');
}

/**
 * Families an ODP brings along (embedded fonts: a `style:font-face` with a source in the file,
 * as `OdpDocument.embedFonts` adds them) – drawn as themselves, never replaced.
 */
export async function embeddedFonts(bytes: Uint8Array): Promise<string[]> {
  if (!isOdpBytes(bytes)) return [];
  let styles: string;
  try {
    styles = (await (await JSZip.loadAsync(bytes)).file('styles.xml')?.async('string')) ?? '';
  } catch {
    return [];
  }
  const pattern =
    /<style:font-face\b[^>]*\bsvg:font-family="([^"]{1,100})"[^>]*>\s*<svg:font-face-src>/g;
  return [...styles.matchAll(pattern)].map((match) =>
    (match[1] as string).replace(/&apos;|&quot;|['"]/g, '').trim(),
  );
}

/** Font names a deck (ODP or PowerPoint) uses – at most a few hundred, from its XML parts. */
export async function deckFonts(bytes: Uint8Array): Promise<string[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return [];
  }
  const fonts = new Set<string>();
  const pattern = /(?:fo:font-family|svg:font-family|style:font-name|typeface)="([^"]{1,100})"/g;
  for (const file of Object.values(zip.files)) {
    if (file.dir || !file.name.endsWith('.xml')) continue;
    for (const match of (await file.async('string')).matchAll(pattern)) {
      const name = (match[1] as string).replace(/&apos;|&quot;|['"]/g, '').trim();
      // `+mn-lt`: a theme font, named in the theme itself.
      if (name && !name.startsWith('+')) fonts.add(name);
      if (fonts.size >= 300) return [...fonts];
    }
  }
  return [...fonts];
}

/**
 * The profile every run starts with: no macros, no OLE or DDE, no links followed out of the
 * document – a second line behind dropping the external links from the file itself. Links are
 * never updated on load (officecfg `Content/Update/Link`: Writer `0` = never, Calc `1` = never –
 * the enums differ), and Excel files are not recalculated on load (`OOXMLRecalcMode` `1` = never),
 * so a formula that fetches does not run; the PDF shows the values the file was saved with.
 *
 * `poolScript`: the render pool's LibreOffice runs Slider's own script (`office-worker.py`, in the
 * profile), which `DisableMacrosExecution` would block too. Documents still run none: the security
 * level trusts no location or signature, and the script opens every file with
 * `MacroExecutionMode` never.
 *
 * `replacements: false`: no font replacement table – for the render pool, which only draws files
 * whose fonts are named already as they are to be drawn (`replaceFonts`); a table there would
 * replace a workspace's own font named like an Office one (its own Calibri) by its twin.
 */
export const hardenedProfile = (
  fonts: readonly string[] = [],
  {
    poolScript = false,
    own = [],
    replacements = true,
  }: { poolScript?: boolean; own?: readonly string[]; replacements?: boolean } = {},
) => `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>${!poolScript}</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableActiveContent" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>1</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>1</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Font/Substitution"><prop oor:name="Replacement" oor:op="fuse"><value>${replacements}</value></prop></item>
${replacements ? fontReplacements(fonts, own) : ''}
</oor:items>
`;

/** Where LibreOffice lives when it is not on the PATH (the macOS app bundle). */
const WELL_KNOWN_SOFFICE = ['/Applications/LibreOffice.app/Contents/MacOS/soffice'];

type Spawn = (
  command: string,
  args: string[],
  options: { detached: boolean; env?: NodeJS.ProcessEnv },
) => ChildProcess;

/**
 * Conversions still running, with their temp folder. They run in their own process group, so
 * they would outlive the server: {@link stopRunningConversions} takes them down on shutdown.
 */
const running = new Map<ChildProcess, string>();
/** Set by {@link stopRunningConversions}: the process is going down. */
let stopping = false;

/**
 * A conversion cut off by shutdown – not a failure of the deck. Imports and re-renders let it
 * through instead of falling back to the SVG preview, so the next start resumes them.
 */
export class ConversionAborted extends Error {
  constructor() {
    super('LibreOffice conversion stopped: the server is shutting down');
    this.name = 'ConversionAborted';
  }
}

/**
 * LibreOffice ran, but made no PDF of the file: it exited with an error or wrote nothing usable –
 * the file is broken, password protected or not what its name says.
 */
export class ConversionFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversionFailed';
  }
}

/** A conversion killed after its timeout – a huge or pathological file, or a busy server. */
export class ConversionTimedOut extends Error {
  constructor(timeoutMs: number) {
    super(`LibreOffice timed out after ${timeoutMs} ms`);
    this.name = 'ConversionTimedOut';
  }
}

/**
 * Kills every running conversion (whole process group) and removes its temp folder right away –
 * for shutdown and the restart after `/einrichtung`, where the process exits before the
 * conversions' own clean-up would run. They and any conversion started afterwards end in
 * {@link ConversionAborted}; their imports are picked up again on the next start.
 */
export function stopRunningConversions(): void {
  stopping = true;
  for (const [child, dir] of running) {
    kill(child);
    rmSync(dir, { recursive: true, force: true });
  }
  running.clear();
}

/**
 * Conversions that run at once, across every converter: uploads, links, picks and syncs convert
 * right in their request, besides the import queue – each run is a whole LibreOffice (hundreds
 * of MB, a CPU core). The rest wait their turn, in order of arrival; the timeout starts with the
 * run, not the wait.
 */
export const MAX_PARALLEL_CONVERSIONS = 2;
let activeConversions = 0;
const waitingConversions: (() => void)[] = [];

async function inConversionSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeConversions < MAX_PARALLEL_CONVERSIONS) activeConversions += 1;
  else await new Promise<void>((resolve) => waitingConversions.push(resolve));
  try {
    return await work();
  } finally {
    // The slot goes straight to the next one waiting, else it is free again.
    const next = waitingConversions.shift();
    if (next) next();
    else activeConversions -= 1;
  }
}

/** Undoes {@link stopRunningConversions} – for tests; a real server never comes back from it. */
export function resumeConversions(): void {
  stopping = false;
}

export interface FindSofficeOptions {
  /** `LIBREOFFICE_PATH`: used as is when set (and executable). */
  configured?: string | null;
  /** `PATH` to search for `soffice`. */
  searchPath?: string;
  /** Injected for tests. */
  isExecutable?: (file: string) => Promise<boolean>;
}

const executable = async (file: string) => {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * The `soffice` binary: `LIBREOFFICE_PATH`, else `soffice` on the PATH, else the macOS app.
 * `null` when LibreOffice is not installed.
 */
export async function findSoffice({
  configured,
  searchPath = process.env.PATH ?? '',
  isExecutable = executable,
}: FindSofficeOptions = {}): Promise<string | null> {
  if (configured) return (await isExecutable(configured)) ? configured : null;
  const candidates = [
    ...searchPath
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => path.join(dir, 'soffice')),
    ...WELL_KNOWN_SOFFICE,
  ];
  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

export interface LibreOfficeOptions {
  /** Path of `soffice`, see {@link findSoffice}. */
  binary: string;
  log: Logger;
  timeoutMs?: number;
  /** Injected for tests. */
  spawn?: Spawn;
  /** LibreOffices kept running: edited slides (`pages`) are drawn there instead. */
  pool?: OfficePool | null;
}

/**
 * Converts with `soffice --headless --convert-to pdf`. Every run gets its own temp folder and
 * its own LibreOffice profile (`-env:UserInstallation`, hardened: {@link hardenedProfile}), so
 * conversions can run side by side without fighting over the profile lock; the folder is removed
 * afterwards. A run that takes longer than {@link LIBREOFFICE_TIMEOUT_MS} is killed (with its
 * whole process group). Like PowerPoint's PDF, LibreOffice's leaves hidden slides out. The deck
 * is handed over without its external links ({@link withoutExternalLinks}); a deck that is not a
 * readable package is not converted at all.
 */
export function createLibreOfficePdf(options: LibreOfficeOptions): PptxToPdf {
  const convert = converter(options);
  const toPdf: PptxToPdf = async (pptx, { fonts = [] } = {}) =>
    // LibreOffice loads linked pictures, media and OLE links while it draws the PDF: an
    // uploaded deck must not make the server fetch internal URLs or read local files.
    isOdpBytes(pptx)
      ? convert(await withoutOdpLinks(pptx), 'odp', ODP_IMPORT_FILTER, 'pdf', fonts)
      : convert(await withoutExternalLinks(pptx), 'pptx', PPTX_IMPORT_FILTER, 'pdf', fonts);
  toPdf.pages = async (deck, pages, { priority, key, prepared = false, fonts = [] } = {}) => {
    if (!isOdpBytes(deck)) throw new ConversionFailed('Only ODP decks are drawn page by page');
    const odp = prepared ? deck : await odpForDrawing(deck, fonts);
    if (options.pool && !stopping) {
      try {
        return await options.pool.convert(odp, {
          extension: 'odp',
          importFilter: ODP_IMPORT_FILTER,
          exportFilter: 'impress_pdf_Export',
          pageRange: pages.join(','),
          priority,
          key,
        });
      } catch (error) {
        // No LibreOffice of the pool running: drawn the old way below.
        if (!(error instanceof PoolUnavailable)) throw error;
      }
    }
    return convert(odp, 'odp', ODP_IMPORT_FILTER, pdfOfPages(pages));
  };
  toPdf.promote = (key) => options.pool?.promote(key);
  return toPdf;
}

/**
 * Word, Excel, PowerPoint variants and text as a PDF – like {@link createLibreOfficePdf}, Office
 * files without their external links, each read with its own import filter only.
 */
export function createLibreOfficeDocumentPdf(options: LibreOfficeOptions): DocumentToPdf {
  const convert = converter(options);
  return async (bytes, kind) => {
    try {
      return await convert(
        isOoxml(kind) ? await withoutExternalLinks(bytes) : bytes,
        kind,
        DOCUMENT_IMPORT_FILTERS[kind],
      );
    } catch (error) {
      // The person only hears "broken or locked" or "try again": the cause is in the log.
      if (!(error instanceof ConversionAborted)) {
        options.log.warn(`LibreOffice could not convert a .${kind} file`, error);
      }
      throw error;
    }
  };
}

const DECK_EXTENSIONS = new Set(['odp', 'pptx', 'pptm', 'ppsx']);

function converter({
  binary,
  log,
  timeoutMs = LIBREOFFICE_TIMEOUT_MS,
  spawn = nodeSpawn,
}: LibreOfficeOptions) {
  return (
    bytes: Uint8Array,
    extension: string,
    filter: string,
    target = 'pdf',
    own: readonly EmbeddedFont[] = [],
  ): Promise<Uint8Array> =>
    inConversionSlot(() => convertOnce(bytes, extension, filter, target, own));

  async function convertOnce(
    bytes: Uint8Array,
    extension: string,
    filter: string,
    target: string,
    own: readonly EmbeddedFont[],
  ) {
    const dir = await mkdtemp(path.join(tmpdir(), 'slider-soffice-'));
    try {
      const input = path.join(dir, `deck.${extension}`);
      const outDir = path.join(dir, 'out');
      const profile = path.join(dir, 'profile');
      await mkdir(path.join(profile, 'user'), { recursive: true });
      // A deck's own fonts join the replacement table (`fontReplacements`).
      const fonts = DECK_EXTENSIONS.has(extension) ? await deckFonts(bytes) : [];
      // The workspace's fonts the deck names: in a font folder of this run (fontconfig).
      const named = new Set(fonts.map((font) => font.toLowerCase()));
      const used = own.filter((font) => named.has(font.family.toLowerCase()));
      const env = used.length > 0 ? await fontFolder(dir, used) : undefined;
      // … and those the file brings along: neither is replaced.
      const embedded = extension === 'odp' ? await embeddedFonts(bytes) : [];
      await writeFile(
        path.join(profile, 'user', 'registrymodifications.xcu'),
        hardenedProfile(fonts, { own: [...used.map((font) => font.family), ...embedded] }),
      );
      await writeFile(input, bytes);
      await run(
        spawn,
        binary,
        [
          `-env:UserInstallation=${pathToFileURL(profile).href}`,
          '--headless',
          '--norestore',
          '--nolockcheck',
          '--nologo',
          '--nodefault',
          // The one import filter – no content sniffing into other formats.
          `--infilter=${filter}`,
          '--convert-to',
          target,
          '--outdir',
          outDir,
          input,
        ],
        timeoutMs,
        dir,
        env,
      );
      let pdf: Uint8Array;
      try {
        pdf = new Uint8Array(await readFile(path.join(outDir, 'deck.pdf')));
      } catch {
        throw new ConversionFailed('LibreOffice wrote no PDF');
      }
      if (!isPdfBytes(pdf)) throw new ConversionFailed('LibreOffice wrote no valid PDF');
      return pdf;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch((error: unknown) =>
        log.warn(`Could not remove LibreOffice temp folder ${dir}`, error),
      );
    }
  }
}

/**
 * Puts fonts into `dir/fonts` and returns the environment that has LibreOffice's fontconfig find
 * them beside the system's fonts – for this run only.
 */
async function fontFolder(dir: string, fonts: readonly EmbeddedFont[]): Promise<NodeJS.ProcessEnv> {
  const folder = path.join(dir, 'fonts');
  await mkdir(folder);
  await Promise.all(
    fonts.map((font, i) => writeFile(path.join(folder, `font-${i}.${font.format}`), font.bytes)),
  );
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const config = path.join(dir, 'fonts.conf');
  await writeFile(
    config,
    `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <dir>${escape(folder)}</dir>
  <cachedir>${escape(path.join(dir, 'fontcache'))}</cachedir>
</fontconfig>
`,
  );
  return { ...process.env, FONTCONFIG_FILE: config };
}

function run(
  spawn: Spawn,
  binary: string,
  args: string[],
  timeoutMs: number,
  dir: string,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (stopping) {
      reject(new ConversionAborted());
      return;
    }
    // Own process group: on Linux `soffice` is a script that starts `soffice.bin`; a timeout
    // must take both down.
    const child = spawn(binary, args, env ? { detached: true, env } : { detached: true });
    running.set(child, dir);
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString();
    });
    child.stdout?.resume();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      kill(child);
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      running.delete(child);
      reject(stopping ? new ConversionAborted() : error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      running.delete(child);
      if (stopping) reject(new ConversionAborted());
      else if (timedOut) reject(new ConversionTimedOut(timeoutMs));
      else if (code === 0) resolve();
      else {
        reject(
          new ConversionFailed(
            `LibreOffice exited with ${code ?? signal}${stderr ? `: ${stderr.trim()}` : ''}`,
          ),
        );
      }
    });
  });
}

function kill(child: ChildProcess): void {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}
