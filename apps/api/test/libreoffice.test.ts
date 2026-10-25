import { EventEmitter } from 'node:events';
import { spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it, vi } from 'vitest';
import {
  ConversionAborted,
  ConversionFailed,
  ConversionTimedOut,
  createLibreOfficeDocumentPdf,
  createLibreOfficePdf,
  DOCUMENT_IMPORT_FILTERS,
  findSoffice,
  MAX_PARALLEL_CONVERSIONS,
  resumeConversions,
  stopRunningConversions,
} from '../src/import/libreoffice';
import { STANDARD_FONTS } from '../src/import/pdf-pages';
import { silentLogger } from '../src/logger';
import { makePdf } from './pdf';
import { storedZip, unzipText } from './zip';

const IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const SLIDE_RELS = 'ppt/slides/_rels/slide1.xml.rels';
/** A package with one internal and two external links (a linked picture, a local file). */
const DECK = storedZip({
  'ppt/slides/slide1.xml': '<p:sld/>',
  [SLIDE_RELS]:
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${IMAGE}" Target="../media/image1.png"/>` +
    `<Relationship Id="rId2" Type="${IMAGE}" Target="http://169.254.169.254/latest" TargetMode="External"/>` +
    `<Relationship Id="rId3" Type="${IMAGE}" Target="file:///etc/passwd" TargetMode="External"/>` +
    '</Relationships>',
});

type Behaviour = 'pdf' | 'nothing' | 'fail' | 'hang' | 'held';

/** A fake `soffice`: reads the arguments like LibreOffice would and writes `<outdir>/deck.pdf`. */
function fakeSoffice(behaviour: Behaviour) {
  const calls: { command: string; args: string[] }[] = [];
  /** The `deck.pptx` each run was given. */
  const inputs: Uint8Array[] = [];
  /** The profile (`registrymodifications.xcu`) each run was given. */
  const profiles: string[] = [];
  /** `held`: runs waiting to be let finish, with a PDF. */
  const held: (() => void)[] = [];
  const spawn = vi.fn((command: string, args: string[]) => {
    calls.push({ command, args });
    const child = new EventEmitter() as ChildProcess;
    Object.assign(child, {
      pid: undefined,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => {
        queueMicrotask(() => child.emit('close', null, 'SIGKILL'));
        return true;
      }),
    });
    void (async () => {
      // Like a real process: events only after `spawn` returned and listeners are attached.
      await new Promise((resolve) => setImmediate(resolve));
      inputs.push(new Uint8Array(await readFile(args.at(-1) ?? '')));
      const profile = new URL(args[0]?.replace('-env:UserInstallation=', '') ?? '');
      profiles.push(
        await readFile(path.join(profile.pathname, 'user/registrymodifications.xcu'), 'utf8'),
      );
      if (behaviour === 'hang') return;
      if (behaviour === 'held') await new Promise<void>((resolve) => held.push(resolve));
      const outDir = args[args.indexOf('--outdir') + 1] ?? '';
      if (behaviour === 'pdf' || behaviour === 'held') {
        await mkdir(outDir, { recursive: true });
        await writeFile(path.join(outDir, 'deck.pdf'), makePdf(1));
      }
      if (behaviour === 'fail')
        child.stderr?.emit('data', Buffer.from('Error: source file could not be loaded'));
      child.emit('close', behaviour === 'fail' ? 1 : 0, null);
    })();
    return child;
  });
  return { spawn, calls, inputs, profiles, held };
}

describe('createLibreOfficePdf (BER-94)', () => {
  it('converts headless with its own profile and cleans up its temp folder', async () => {
    const { spawn, calls } = fakeSoffice('pdf');
    const convert = createLibreOfficePdf({ binary: '/opt/soffice', log: silentLogger, spawn });
    const pdf = await convert(DECK);
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe('%PDF-');

    const [call] = calls;
    expect(call?.command).toBe('/opt/soffice');
    const args = call?.args ?? [];
    expect(args).toEqual(
      expect.arrayContaining(['--headless', '--norestore', '--convert-to', 'pdf', '--outdir']),
    );
    const profile = args.find((arg) => arg.startsWith('-env:UserInstallation=file://'));
    expect(profile).toBeDefined();
    const input = args.at(-1) ?? '';
    expect(input.endsWith('deck.pptx')).toBe(true);
    expect(existsSync(path.dirname(input))).toBe(false);
  });

  it('hands LibreOffice the deck without external links, through the PowerPoint filter only', async () => {
    const { spawn, calls, inputs } = fakeSoffice('pdf');
    const convert = createLibreOfficePdf({ binary: 'soffice', log: silentLogger, spawn });
    await convert(DECK);
    expect(calls[0]?.args).toContain('--infilter=Impress MS PowerPoint 2007 XML');
    const rels = unzipText(inputs[0] ?? new Uint8Array())[SLIDE_RELS] ?? '';
    expect(rels).toContain('Target="../media/image1.png"');
    expect(rels).not.toMatch(/169\.254|file:|External/);

    // What is not a readable package is not converted at all.
    await expect(convert(new Uint8Array([1, 2, 3]))).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('gives every run its own profile, so runs can overlap', async () => {
    const { spawn, calls } = fakeSoffice('pdf');
    const convert = createLibreOfficePdf({ binary: 'soffice', log: silentLogger, spawn });
    await Promise.all([convert(DECK), convert(DECK)]);
    const profiles = calls.map(({ args }) => args[0]);
    expect(new Set(profiles).size).toBe(2);
  });

  it('fails when LibreOffice exits with an error or writes no PDF', async () => {
    const failing = createLibreOfficePdf({
      binary: 'soffice',
      log: silentLogger,
      spawn: fakeSoffice('fail').spawn,
    });
    await expect(failing(DECK)).rejects.toThrow(/exited with 1.*could not be loaded/);
    await expect(failing(DECK)).rejects.toBeInstanceOf(ConversionFailed);
    const silent = createLibreOfficePdf({
      binary: 'soffice',
      log: silentLogger,
      spawn: fakeSoffice('nothing').spawn,
    });
    await expect(silent(DECK)).rejects.toThrow('LibreOffice wrote no PDF');
  });

  it('kills a conversion that takes too long', async () => {
    const { spawn } = fakeSoffice('hang');
    const convert = createLibreOfficePdf({
      binary: 'soffice',
      log: silentLogger,
      spawn,
      timeoutMs: 20,
    });
    await expect(convert(DECK)).rejects.toThrow('timed out after 20 ms');
    await expect(convert(DECK)).rejects.toBeInstanceOf(ConversionTimedOut);
    const child = spawn.mock.results[0]?.value as ChildProcess;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it.skipIf(process.platform === 'win32')(
    'kills the whole process group of a real conversion on timeout, not just the launcher',
    async () => {
      // Like Linux `soffice`: a launcher script whose real work runs in a child (`soffice.bin`).
      const dir = await mkdtemp(path.join(tmpdir(), 'slider-soffice-test-'));
      try {
        const pidFile = path.join(dir, 'worker.pid');
        const binary = path.join(dir, 'soffice');
        await writeFile(binary, `#!/bin/sh\nsleep 60 &\necho $! > "${pidFile}"\nwait\n`, {
          mode: 0o755,
        });
        // Generous enough that the launcher has started its worker even on a busy CI runner.
        const convert = createLibreOfficePdf({ binary, log: silentLogger, timeoutMs: 8000 });
        await expect(convert(DECK)).rejects.toThrow('timed out after 8000 ms');

        const worker = Number(await readFile(pidFile, 'utf8'));
        expect(worker).toBeGreaterThan(0);
        const alive = () => {
          try {
            process.kill(worker, 0);
          } catch {
            return false;
          }
          // A killed worker can linger as a zombie until PID 1 reaps it, which takes a while on
          // a loaded machine; `kill(pid, 0)` still succeeds then, but it no longer runs.
          const state = spawnSync('ps', ['-o', 'stat=', '-p', String(worker)], {
            encoding: 'utf8',
          });
          return !state.stdout.trim().startsWith('Z') && state.stdout.trim() !== '';
        };
        await vi.waitFor(() => expect(alive()).toBe(false), { timeout: 10_000, interval: 100 });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it('kills running conversions and removes their temp folder on shutdown', async () => {
    const { spawn, calls } = fakeSoffice('hang');
    const convert = createLibreOfficePdf({ binary: 'soffice', log: silentLogger, spawn });
    const result = convert(DECK);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const dir = path.dirname(calls[0]?.args.at(-1) ?? '');
    expect(existsSync(dir)).toBe(true);

    try {
      stopRunningConversions();
      // Synchronously: the process exits right after, before the conversion's own clean-up runs.
      expect(existsSync(dir)).toBe(false);
      const child = spawn.mock.results[0]?.value as ChildProcess;
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      // Not a failure of the deck: imports let it through instead of keeping the SVG preview.
      await expect(result).rejects.toBeInstanceOf(ConversionAborted);
      // Nothing new starts while the server goes down.
      await expect(convert(DECK)).rejects.toBeInstanceOf(ConversionAborted);
      expect(calls).toHaveLength(1);

      // Finished conversions are forgotten: nothing left to kill.
      stopRunningConversions();
      expect(child.kill).toHaveBeenCalledTimes(1);
    } finally {
      resumeConversions();
    }
  });
});

describe('LibreOffice hardening and limits', () => {
  it('starts every run with links never updated, no macros and no recalculation on load', async () => {
    const { spawn, profiles } = fakeSoffice('pdf');
    await createLibreOfficePdf({ binary: 'soffice', log: silentLogger, spawn })(DECK);
    const profile = profiles[0] ?? '';
    expect(profile).toContain('<prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true');
    // Writer counts 0 as never, Calc 1.
    expect(profile).toMatch(
      /Office\.Writer\/Content\/Update"><prop oor:name="Link" oor:op="fuse"><value>0</,
    );
    expect(profile).toMatch(
      /Office\.Calc\/Content\/Update"><prop oor:name="Link" oor:op="fuse"><value>1</,
    );
    expect(profile).toMatch(/OOXMLRecalcMode" oor:op="fuse"><value>1</);
  });

  it('reads a CSV with formulas as text (CSV filter token 13 off)', async () => {
    const { spawn, calls } = fakeSoffice('pdf');
    const convert = createLibreOfficeDocumentPdf({ binary: 'soffice', log: silentLogger, spawn });
    await convert(new TextEncoder().encode('a,b\n1,=1+1\n'), 'csv');
    const filter = calls[0]?.args.find((arg) => arg.startsWith('--infilter='));
    expect(filter).toBe(`--infilter=${DOCUMENT_IMPORT_FILTERS.csv}`);
    const tokens = DOCUMENT_IMPORT_FILTERS.csv.split(':')[1]?.split(',') ?? [];
    expect(tokens.slice(0, 3)).toEqual(['44', '34', '76']);
    expect(tokens[12]).toBe('false');
  });

  it(`runs at most ${MAX_PARALLEL_CONVERSIONS} conversions at once, across converters; the rest wait`, async () => {
    const { spawn, calls, held } = fakeSoffice('held');
    const slides = createLibreOfficePdf({ binary: 'soffice', log: silentLogger, spawn });
    const documents = createLibreOfficeDocumentPdf({ binary: 'soffice', log: silentLogger, spawn });
    const text = new TextEncoder().encode('Hallo');
    const results = [slides(DECK), documents(text, 'txt'), slides(DECK), documents(text, 'md')];
    await vi.waitFor(() => expect(held).toHaveLength(MAX_PARALLEL_CONVERSIONS));
    // Give a third run every chance to start: it must not.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toHaveLength(MAX_PARALLEL_CONVERSIONS);

    // One finishes: the next one waiting starts, in order of arrival.
    held.shift()?.();
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2]?.args.at(-1)).toMatch(/deck\.pptx$/);
    while (calls.length < 4 || held.length > 0) {
      await vi.waitFor(() => expect(held.length).toBeGreaterThan(0));
      held.shift()?.();
    }
    await expect(Promise.all(results)).resolves.toHaveLength(4);
  });

  it('logs why a document could not be converted', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const convert = createLibreOfficeDocumentPdf({
      binary: 'soffice',
      log,
      spawn: fakeSoffice('fail').spawn,
    });
    await expect(convert(new TextEncoder().encode('x'), 'txt')).rejects.toBeInstanceOf(
      ConversionFailed,
    );
    expect(log.warn).toHaveBeenCalledWith(
      'LibreOffice could not convert a .txt file',
      expect.any(ConversionFailed),
    );
  });

  it('never fetches from a CSV formula with a real LibreOffice, when installed', async () => {
    const soffice = await findSoffice();
    if (!soffice) return;
    const hits: string[] = [];
    const server = createServer((request, response) => {
      hits.push(request.url ?? '');
      response.end('geholt');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const csv = `a,b\n1,=1+1\n2,"=WEBSERVICE(""http://127.0.0.1:${port}/csv"")"\n`;
      const convert = createLibreOfficeDocumentPdf({ binary: soffice, log: silentLogger });
      const pdf = await convert(new TextEncoder().encode(csv), 'csv');
      expect(hits).toEqual([]);
      // Formulas are not evaluated at all: the cells show them as text.
      const loading = getDocument({
        data: pdf.slice(),
        standardFontDataUrl: STANDARD_FONTS,
        verbosity: 0,
      });
      const document = await loading.promise;
      const page = await document.getPage(1);
      const text = (await page.getTextContent()).items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      expect(text).toContain('=1+1');
      expect(text).toContain('WEBSERVICE');
      await loading.destroy();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 60_000);
});

describe('findSoffice', () => {
  const only =
    (...files: string[]) =>
    async (file: string) =>
      files.includes(file);

  it('takes LIBREOFFICE_PATH when it is executable', async () => {
    expect(await findSoffice({ configured: '/x/soffice', isExecutable: only('/x/soffice') })).toBe(
      '/x/soffice',
    );
    expect(await findSoffice({ configured: '/x/soffice', isExecutable: only() })).toBeNull();
  });

  it('searches the PATH, then the macOS app', async () => {
    const searchPath = ['/usr/local/bin', '/usr/bin'].join(path.delimiter);
    expect(await findSoffice({ searchPath, isExecutable: only('/usr/bin/soffice') })).toBe(
      '/usr/bin/soffice',
    );
    const app = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
    expect(await findSoffice({ searchPath, isExecutable: only(app) })).toBe(app);
    expect(await findSoffice({ searchPath, isExecutable: only() })).toBeNull();
  });
});
