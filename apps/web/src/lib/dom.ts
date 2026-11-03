import { isApplePlatform } from './platform';

/** True when keyboard shortcuts must not fire because the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
    return true;
  }
  // A list of choices of our own (the font's): its keys are its own, like a select's.
  return target.getAttribute('role') === 'listbox';
}

/** Input types without text of their own to copy, cut or put in. */
const TEXTLESS_INPUTS = new Set([
  'checkbox',
  'radio',
  'range',
  'color',
  'button',
  'submit',
  'reset',
  'file',
  'image',
]);

/**
 * True when the focused field holds text of its own – ⌘C / ⌘V / ⌘Z / Entf are its then. A
 * choice (a select, a checkbox, a slider) has none: picked, the editor's keys stay the editor's.
 */
export function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && !TEXTLESS_INPUTS.has(target.type);
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

/** Fields keep the system's menu on ctrl+click (copy, paste, spelling). */
const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/**
 * Ctrl+click on a Mac is a click with Ctrl held, as on Windows (Ctrl is the ⌘ of `isModKey`) –
 * within `scope` only: the system makes it a right click, a `contextmenu` and no `click`. That
 * menu is swallowed before any handler sees it and the click sent once the button is up (on what
 * was pressed). Not on a field, nor inside `keepMenu` (what opens a menu of its own there, as a
 * comment's mark): ctrl+click opens the menu there, as anywhere else in the app. Returns the
 * uninstall.
 */
export function ctrlClickIsClick(
  scope: (target: Element) => boolean,
  keepMenu?: string,
): () => void {
  if (!isApplePlatform()) return () => {};
  let pressed: Element | null = null;
  // The click waiting for the button to come up: dropped at the next press (released elsewhere).
  let release: AbortController | null = null;
  const onMouseDown = (event: MouseEvent) => {
    release?.abort();
    release = null;
    const target = event.target instanceof Element ? event.target : null;
    pressed =
      event.button === 0 &&
      event.ctrlKey &&
      target &&
      scope(target) &&
      !target.closest(EDITABLE) &&
      !(keepMenu && target.closest(keepMenu))
        ? target
        : null;
  };
  const onContextMenu = (event: MouseEvent) => {
    const target = pressed;
    if (!target) return;
    pressed = null;
    event.preventDefault();
    event.stopImmediatePropagation();
    const waiting = new AbortController();
    release = waiting;
    document.addEventListener(
      'mouseup',
      (up) => {
        waiting.abort();
        if (release === waiting) release = null;
        if (up.button !== 0 || up.target !== target) return;
        target.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            detail: 1,
            clientX: up.clientX,
            clientY: up.clientY,
            screenX: up.screenX,
            screenY: up.screenY,
            ctrlKey: true,
            metaKey: up.metaKey,
            shiftKey: up.shiftKey,
            altKey: up.altKey,
          }),
        );
      },
      { capture: true, signal: waiting.signal },
    );
  };
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('contextmenu', onContextMenu, true);
  return () => {
    release?.abort();
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('contextmenu', onContextMenu, true);
  };
}

/**
 * Tab / ⇧Tab stepping round through a row of choices – the drawing tools, the editing tools, a
 * panel's parts: 1 or -1, else `null`. Only while nothing has the focus and once the pointer was
 * used – a focused control moves the focus on as usual, keyboard-only visitors start on the skip
 * link. Panels that hold the focus go round with `useFocusLoop` instead. A new frame's kinds
 * (`KindChooser`, `data-frame-chooser`) go first: while it is open, no other row steps.
 */
export function tabStep(event: KeyboardEvent): 1 | -1 | null {
  if (event.key !== 'Tab' || event.defaultPrevented) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (document.querySelector('[data-frame-chooser]')) return null;
  const unfocused = event.target === document.body || event.target === document.documentElement;
  if (!unfocused || !pointerWasUsed) return null;
  return event.shiftKey ? -1 : 1;
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
