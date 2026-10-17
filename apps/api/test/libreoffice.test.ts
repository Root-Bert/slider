import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  ConversionAborted,
  createLibreOfficePdf,
  findSoffice,
  resumeConversions,
  stopRunningConversions,
} from '../src/import/libreoffice';
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

type Behaviour = 'pdf' | 'nothing' | 'fail' | 'hang';

/** A fake `soffice`: reads the arguments like LibreOffice would and writes `<outdir>/deck.pdf`. */
function fakeSoffice(behaviour: Behaviour) {
  const calls: { command: string; args: string[] }[] = [];
  /** The `deck.pptx` each run was given. */
  const inputs: Uint8Array[] = [];
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
      if (behaviour === 'hang') return;
      const outDir = args[args.indexOf('--outdir') + 1] ?? '';
      if (behaviour === 'pdf') {
        await mkdir(outDir, { recursive: true });
        await writeFile(path.join(outDir, 'deck.pdf'), makePdf(1));
      }
      if (behaviour === 'fail')
        child.stderr?.emit('data', Buffer.from('Error: source file could not be loaded'));
      child.emit('close', behaviour === 'fail' ? 1 : 0, null);
    })();
    return child;
  });
  return { spawn, calls, inputs };
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
        const convert = createLibreOfficePdf({ binary, log: silentLogger, timeoutMs: 3000 });
        await expect(convert(DECK)).rejects.toThrow('timed out after 3000 ms');

        const worker = Number(await readFile(pidFile, 'utf8'));
        expect(worker).toBeGreaterThan(0);
        const alive = () => {
          try {
            process.kill(worker, 0);
            return true;
          } catch {
            return false;
          }
        };
        // Re-parented to PID 1 and reaped there once killed.
        await vi.waitFor(() => expect(alive()).toBe(false), { timeout: 5000 });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    15_000,
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
