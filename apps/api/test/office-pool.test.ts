import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { ConversionAborted, ConversionFailed, ConversionTimedOut } from '../src/import/libreoffice';
import {
  createOfficePool,
  MAX_WAITING_BACKGROUND,
  PoolBusy,
  PoolUnavailable,
  type OfficePool,
  type PoolJob,
} from '../src/import/office-pool';
import { silentLogger } from '../src/logger';

const FAKE = new URL('./fixtures/fake-soffice.mjs', import.meta.url).pathname;
const JOB: PoolJob = {
  extension: 'odp',
  importFilter: 'impress8',
  exportFilter: 'impress_pdf_Export',
};
const file = (order: string) => new TextEncoder().encode(order);

let pool: OfficePool | null = null;
afterEach(() => {
  pool?.close();
  pool = null;
});

/** A pool of fake LibreOffices (`fixtures/fake-soffice.mjs`); counts the ones started. */
async function fakePool(
  options: { size?: number; jobTimeoutMs?: number; maxJobsPerWorker?: number; start?: 'fail' } = {},
) {
  const started = { count: 0 };
  pool = await createOfficePool({
    binary: 'soffice',
    size: options.size ?? 1,
    log: silentLogger,
    jobTimeoutMs: options.jobTimeoutMs,
    maxJobsPerWorker: options.maxJobsPerWorker,
    restartDelayMs: 10,
    spawn: (_command, _args, spawnOptions) => {
      started.count += 1;
      return spawn(process.execPath, [FAKE], {
        ...spawnOptions,
        env: { ...spawnOptions.env, FAKE_SOFFICE_START: options.start ?? '' },
      });
    },
  });
  return { pool, started };
}

const isPdf = (bytes: Uint8Array) => new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';

describe('LibreOffice render pool', () => {
  it('draws files in LibreOffices kept running', async () => {
    const { pool, started } = await fakePool({ size: 2 });
    const pdfs = await Promise.all([1, 2, 3, 4, 5].map(() => pool.convert(file('deck'), JOB)));
    expect(pdfs.every(isPdf)).toBe(true);
    expect(started.count).toBe(2);
  });

  it('draws what someone waits for before what is drawn ahead', async () => {
    const { pool } = await fakePool();
    const order: string[] = [];
    const busy = pool.convert(file('slow'), JOB);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const ahead = pool
      .convert(file('deck'), { ...JOB, priority: 'background' })
      .then(() => order.push('ahead'));
    const waited = pool.convert(file('deck'), JOB).then(() => order.push('waited'));
    await Promise.all([busy, ahead, waited]);
    expect(order).toEqual(['waited', 'ahead']);
  });

  it('moves a drawing asked for ahead to the front once someone waits for it', async () => {
    const { pool } = await fakePool();
    const order: string[] = [];
    const busy = pool.convert(file('slow'), JOB);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const first = pool
      .convert(file('deck'), { ...JOB, priority: 'background' })
      .then(() => order.push('first'));
    const promoted = pool
      .convert(file('deck'), { ...JOB, priority: 'background', key: 'picked' })
      .then(() => order.push('picked'));
    pool.promote('picked');
    await Promise.all([busy, first, promoted]);
    expect(order).toEqual(['picked', 'first']);
  });

  it('replaces a LibreOffice that hangs, and goes on', async () => {
    const { pool, started } = await fakePool({ jobTimeoutMs: 200 });
    await expect(pool.convert(file('hang'), JOB)).rejects.toBeInstanceOf(ConversionTimedOut);
    expect(isPdf(await pool.convert(file('deck'), JOB))).toBe(true);
    expect(started.count).toBe(2);
  });

  it('tries a file once more when its LibreOffice dies under it', async () => {
    const { pool } = await fakePool({ size: 2 });
    // The second try lands on a fake that crashes too: then it fails.
    await expect(pool.convert(file('crash'), JOB)).rejects.toBeInstanceOf(ConversionFailed);
    expect(isPdf(await pool.convert(file('deck'), JOB))).toBe(true);
  });

  it('says what LibreOffice could not draw', async () => {
    const { pool } = await fakePool();
    await expect(pool.convert(file('fail'), JOB)).rejects.toThrow('could not open');
    expect(isPdf(await pool.convert(file('deck'), JOB))).toBe(true);
  });

  it('starts LibreOffice anew after so many files', async () => {
    const { pool, started } = await fakePool({ maxJobsPerWorker: 2 });
    for (let i = 0; i < 5; i++) expect(isPdf(await pool.convert(file('deck'), JOB))).toBe(true);
    expect(started.count).toBeGreaterThanOrEqual(3);
  });

  it('gives its files back when no LibreOffice starts, to be drawn the old way', async () => {
    const { pool } = await fakePool({ start: 'fail' });
    await expect(pool.convert(file('deck'), JOB)).rejects.toBeInstanceOf(PoolUnavailable);
    await expect(pool.convert(file('deck'), JOB)).rejects.toBeInstanceOf(PoolUnavailable);
  });

  it('turns away drawings asked for ahead when too many wait', async () => {
    const { pool } = await fakePool();
    const busy = pool.convert(file('slow'), JOB);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const waiting = Array.from({ length: MAX_WAITING_BACKGROUND }, () =>
      pool.convert(file('deck'), { ...JOB, priority: 'background' }),
    );
    await expect(
      pool.convert(file('deck'), { ...JOB, priority: 'background' }),
    ).rejects.toBeInstanceOf(PoolBusy);
    // What someone waits for still goes in.
    expect(isPdf(await pool.convert(file('deck'), JOB))).toBe(true);
    await Promise.all([busy, ...waiting]);
  });

  it('ends waiting and later files when closed', async () => {
    const { pool } = await fakePool();
    const busy = pool.convert(file('hang'), JOB);
    const waiting = pool.convert(file('deck'), JOB);
    pool.close();
    await expect(busy).rejects.toBeInstanceOf(ConversionAborted);
    await expect(waiting).rejects.toBeInstanceOf(ConversionAborted);
    await expect(pool.convert(file('deck'), JOB)).rejects.toBeInstanceOf(ConversionAborted);
  });
});
