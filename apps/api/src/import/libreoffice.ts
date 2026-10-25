import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { access, constants, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { withoutExternalLinks } from '@slider/pptx';
import type { Logger } from '../logger';
import { isPdfBytes } from '../sources/safe-fetch';

/** A PPTX turned into a PDF by an office suite (LibreOffice), for uploads (BER-94). */
export type PptxToPdf = (pptx: Uint8Array) => Promise<Uint8Array>;

/** Documents LibreOffice turns into a review deck: Word, Excel, PowerPoint variants and text. */
export type OfficeDocumentKind = keyof typeof DOCUMENT_IMPORT_FILTERS;

/** Any other document as a PDF, for files picked in a cloud that are no deck yet. */
export type DocumentToPdf = (bytes: Uint8Array, kind: OfficeDocumentKind) => Promise<Uint8Array>;

/** A conversion that takes longer is killed; the slides keep their SVG preview. */
export const LIBREOFFICE_TIMEOUT_MS = 120_000;

/** LibreOffice's import filter for .pptx (OOXML presentations). */
const PPTX_IMPORT_FILTER = 'Impress MS PowerPoint 2007 XML';

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
 * The profile every run starts with: no macros, no OLE or DDE, no links followed out of the
 * document – a second line behind dropping the external links from the file itself. Links are
 * never updated on load (officecfg `Content/Update/Link`: Writer `0` = never, Calc `1` = never –
 * the enums differ), and Excel files are not recalculated on load (`OOXMLRecalcMode` `1` = never),
 * so a formula that fetches does not run; the PDF shows the values the file was saved with.
 */
const HARDENED_PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableActiveContent" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>1</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>1</value></prop></item>
</oor:items>
`;

/** Where LibreOffice lives when it is not on the PATH (the macOS app bundle). */
const WELL_KNOWN_SOFFICE = ['/Applications/LibreOffice.app/Contents/MacOS/soffice'];

type Spawn = (command: string, args: string[], options: { detached: boolean }) => ChildProcess;

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
}

/**
 * Converts with `soffice --headless --convert-to pdf`. Every run gets its own temp folder and
 * its own LibreOffice profile (`-env:UserInstallation`, hardened: {@link HARDENED_PROFILE}), so
 * conversions can run side by side without fighting over the profile lock; the folder is removed
 * afterwards. A run that takes longer than {@link LIBREOFFICE_TIMEOUT_MS} is killed (with its
 * whole process group). Like PowerPoint's PDF, LibreOffice's leaves hidden slides out. The deck
 * is handed over without its external links ({@link withoutExternalLinks}); a deck that is not a
 * readable package is not converted at all.
 */
export function createLibreOfficePdf(options: LibreOfficeOptions): PptxToPdf {
  const convert = converter(options);
  return async (pptx) =>
    // LibreOffice loads linked pictures, media and OLE links while it draws the PDF: an
    // uploaded deck must not make the server fetch internal URLs or read local files.
    convert(await withoutExternalLinks(pptx), 'pptx', PPTX_IMPORT_FILTER);
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

function converter({
  binary,
  log,
  timeoutMs = LIBREOFFICE_TIMEOUT_MS,
  spawn = nodeSpawn,
}: LibreOfficeOptions) {
  return (bytes: Uint8Array, extension: string, filter: string): Promise<Uint8Array> =>
    inConversionSlot(() => convertOnce(bytes, extension, filter));

  async function convertOnce(bytes: Uint8Array, extension: string, filter: string) {
    const dir = await mkdtemp(path.join(tmpdir(), 'slider-soffice-'));
    try {
      const input = path.join(dir, `deck.${extension}`);
      const outDir = path.join(dir, 'out');
      const profile = path.join(dir, 'profile');
      await mkdir(path.join(profile, 'user'), { recursive: true });
      await writeFile(path.join(profile, 'user', 'registrymodifications.xcu'), HARDENED_PROFILE);
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
          'pdf',
          '--outdir',
          outDir,
          input,
        ],
        timeoutMs,
        dir,
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

function run(
  spawn: Spawn,
  binary: string,
  args: string[],
  timeoutMs: number,
  dir: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (stopping) {
      reject(new ConversionAborted());
      return;
    }
    // Own process group: on Linux `soffice` is a script that starts `soffice.bin`; a timeout
    // must take both down.
    const child = spawn(binary, args, { detached: true });
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
