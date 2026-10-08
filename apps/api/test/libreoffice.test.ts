import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createLibreOfficePdf, findSoffice } from '../src/import/libreoffice';
import { silentLogger } from '../src/logger';
import { makePdf } from './pdf';

type Behaviour = 'pdf' | 'nothing' | 'fail' | 'hang';

/** A fake `soffice`: reads the arguments like LibreOffice would and writes `<outdir>/deck.pdf`. */
function fakeSoffice(behaviour: Behaviour) {
  const calls: { command: string; args: string[] }[] = [];
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
  return { spawn, calls };
}

describe('createLibreOfficePdf (BER-94)', () => {
  it('converts headless with its own profile and cleans up its temp folder', async () => {
    const { spawn, calls } = fakeSoffice('pdf');
    const convert = createLibreOfficePdf({ binary: '/opt/soffice', log: silentLogger, spawn });
    const pdf = await convert(new Uint8Array([80, 75, 3, 4]));
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

  it('gives every run its own profile, so runs can overlap', async () => {
    const { spawn, calls } = fakeSoffice('pdf');
    const convert = createLibreOfficePdf({ binary: 'soffice', log: silentLogger, spawn });
    await Promise.all([convert(new Uint8Array([1])), convert(new Uint8Array([2]))]);
    const profiles = calls.map(({ args }) => args[0]);
    expect(new Set(profiles).size).toBe(2);
  });

  it('fails when LibreOffice exits with an error or writes no PDF', async () => {
    const failing = createLibreOfficePdf({
      binary: 'soffice',
      log: silentLogger,
      spawn: fakeSoffice('fail').spawn,
    });
    await expect(failing(new Uint8Array([1]))).rejects.toThrow(
      /exited with 1.*could not be loaded/,
    );
    const silent = createLibreOfficePdf({
      binary: 'soffice',
      log: silentLogger,
      spawn: fakeSoffice('nothing').spawn,
    });
    await expect(silent(new Uint8Array([1]))).rejects.toThrow('LibreOffice wrote no PDF');
  });

  it('kills a conversion that takes too long', async () => {
    const { spawn } = fakeSoffice('hang');
    const convert = createLibreOfficePdf({
      binary: 'soffice',
      log: silentLogger,
      spawn,
      timeoutMs: 20,
    });
    await expect(convert(new Uint8Array([1]))).rejects.toThrow('timed out after 20 ms');
    const child = spawn.mock.results[0]?.value as ChildProcess;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
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
