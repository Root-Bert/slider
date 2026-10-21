/** True when keyboard shortcuts must not fire because the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

let pointerWasUsed = false;
let watchingPointer = false;

/**
 * Notes from now on whether the mouse, a pen or touch was used at all in this session – one
 * document-wide listener, installed once (repeat calls do nothing). Capture: also presses whose
 * handlers stop them (the viewer's tool bar, the slide).
 */
export function watchPointer(): void {
  if (watchingPointer) return;
  watchingPointer = true;
  document.addEventListener(
    'pointerdown',
    () => {
      pointerWasUsed = true;
    },
    true,
  );
}

/** Whether the pointer was used since `watchPointer` – until then, the visitor is on the keyboard. */
export const pointerUsed = (): boolean => pointerWasUsed;

/** Tests only: back to "not used yet". */
export function resetPointerUsed(): void {
  pointerWasUsed = false;
}

/** Calls `callback` at most once per animation frame; returns a cancel function. */
export function rafThrottle(callback: () => void): { schedule: () => void; cancel: () => void } {
  let frame = 0;
  return {
    schedule: () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        callback();
      });
    },
    cancel: () => {
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}

let pendingJobs: (() => (() => void) | void)[] = [];

function flushJobs() {
  const jobs = pendingJobs;
  pendingJobs = [];
  const writes = jobs.map((job) => job());
  for (const write of writes) write?.();
}

/**
 * Layout reads and writes right after a React commit, batched across components: every job
 * reads (and returns its writes), then all writes run. One layout for all of them, instead of one
 * for each component reading after another one wrote. Runs before the frame paints (a microtask),
 * after every layout effect of the commit – so after scroll positions set there, too.
 */
export function afterCommit(job: () => (() => void) | void): void {
  if (pendingJobs.length === 0) queueMicrotask(flushJobs);
  pendingJobs.push(job);
}

/** Jobs are waiting for the end of the commit (see `afterCommit`). */
export const commitPending = (): boolean => pendingJobs.length > 0;
