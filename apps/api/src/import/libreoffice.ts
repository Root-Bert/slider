import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { access, constants, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Logger } from '../logger';

/** A PPTX turned into a PDF by an office suite (LibreOffice), for uploads (BER-94). */
export type PptxToPdf = (pptx: Uint8Array) => Promise<Uint8Array>;

/** A conversion that takes longer is killed; the slides keep their SVG preview. */
export const LIBREOFFICE_TIMEOUT_MS = 120_000;

/** Where LibreOffice lives when it is not on the PATH (the macOS app bundle). */
const WELL_KNOWN_SOFFICE = ['/Applications/LibreOffice.app/Contents/MacOS/soffice'];

type Spawn = (command: string, args: string[], options: { detached: boolean }) => ChildProcess;

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
 * its own LibreOffice profile (`-env:UserInstallation`), so conversions can run side by side
 * without fighting over the profile lock; the folder is removed afterwards. A run that takes
 * longer than {@link LIBREOFFICE_TIMEOUT_MS} is killed (with its whole process group).
 * Like PowerPoint's PDF, LibreOffice's leaves hidden slides out.
 */
export function createLibreOfficePdf({
  binary,
  log,
  timeoutMs = LIBREOFFICE_TIMEOUT_MS,
  spawn = nodeSpawn,
}: LibreOfficeOptions): PptxToPdf {
  return async (pptx) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'slider-soffice-'));
    try {
      const input = path.join(dir, 'deck.pptx');
      const outDir = path.join(dir, 'out');
      await writeFile(input, pptx);
      await run(
        spawn,
        binary,
        [
          `-env:UserInstallation=${pathToFileURL(path.join(dir, 'profile')).href}`,
          '--headless',
          '--norestore',
          '--nolockcheck',
          '--nologo',
          '--nodefault',
          '--convert-to',
          'pdf',
          '--outdir',
          outDir,
          input,
        ],
        timeoutMs,
      );
      let pdf: Uint8Array;
      try {
        pdf = new Uint8Array(await readFile(path.join(outDir, 'deck.pdf')));
      } catch {
        throw new Error('LibreOffice wrote no PDF');
      }
      if (!isPdf(pdf)) throw new Error('LibreOffice wrote no valid PDF');
      return pdf;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch((error: unknown) =>
        log.warn(`Could not remove LibreOffice temp folder ${dir}`, error),
      );
    }
  };
}

const isPdf = (bytes: Uint8Array) =>
  bytes.length > 4 && new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';

function run(spawn: Spawn, binary: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // Own process group: on Linux `soffice` is a script that starts `soffice.bin`; a timeout
    // must take both down.
    const child = spawn(binary, args, { detached: true });
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
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`LibreOffice timed out after ${timeoutMs} ms`));
      else if (code === 0) resolve();
      else {
        reject(
          new Error(
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
