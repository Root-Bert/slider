import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { liveApps, processStarted, watchApps } from '../src/desktop-apps';

const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('the desktop service counts the apps using it by process id and start, and ends once none is left for three looks', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'desktop-apps-'));
  dirs.push(dir);
  /** Process id → when it started. */
  const running = new Map([
    [101, 'Mon'],
    [202, 'Tue'],
    // Another program that got the id of an app gone before the computer started again.
    [303, 'today'],
  ]);
  /** 707: the system could not be asked. */
  const startedAt = (pid: number) => (pid === 707 ? null : (running.get(pid) ?? ''));
  const lay = (name: string, started?: string) =>
    writeFileSync(path.join(dir, name), started === undefined ? '' : JSON.stringify({ started }));
  lay('101', 'Mon');
  lay('202', 'Tue');
  lay('303', 'last week');
  lay('404', 'Wed');
  lay('505');
  lay('notes.txt', 'Mon');

  // Real processes: this one has a start, nothing has the id 0 or a broken one.
  expect(processStarted(process.pid)).toMatch(/\d+$/);
  expect(processStarted(process.pid)).toBe(processStarted(process.pid));
  expect([processStarted(0), processStarted(Number.NaN)]).toEqual(['', '']);
  // No folder yet (no app ever started): no apps, no error.
  expect(liveApps(path.join(dir, 'missing'), startedAt)).toEqual([]);
  // An id whose process started at another time, one that runs no more, a file without a start
  // and anything that is no process id: not apps, and cleared away.
  expect(liveApps(dir, startedAt).sort()).toEqual([101, 202]);
  expect(readdirSync(dir).sort()).toEqual(['101', '202']);
  // A look that failed says nothing: the app counts and its marker stays.
  lay('707', 'Fri');
  expect(liveApps(dir, startedAt).sort()).toEqual([101, 202, 707]);
  rmSync(path.join(dir, '707'));

  vi.useFakeTimers();
  const onNone = vi.fn();
  watchApps(dir, onNone, { everyMs: 1_000, misses: 3, startedAt });
  vi.advanceTimersByTime(5_000);
  expect(onNone).not.toHaveBeenCalled();
  // The apps go; one starting in between sets the count back.
  running.clear();
  vi.advanceTimersByTime(2_000);
  lay('606', 'Thu');
  running.set(606, 'Thu');
  vi.advanceTimersByTime(1_000);
  running.clear();
  vi.advanceTimersByTime(2_000);
  expect(onNone).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1_000);
  expect(onNone).toHaveBeenCalledTimes(1);
  // Said once: the service is on its way out.
  vi.advanceTimersByTime(10_000);
  expect(onNone).toHaveBeenCalledTimes(1);
});
