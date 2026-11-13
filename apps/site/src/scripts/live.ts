import type {
  SiteColor,
  SiteComment,
  SiteLiveEvent,
  SiteLiveInput,
  SitePointer,
  SiteReply,
  SiteVisitor,
} from '@slider/shared';
import type { Dict } from '~/i18n/en';

/*
 * Live comments on the website (see LiveComments.astro). Positions are shares of the nearest
 * `[data-live]` section's box, so every window size and language puts them on the same spot.
 * Kept light: one EventSource while the tab is visible, pointer posts at most ~15/s and only while
 * someone else is here, no work at all while nobody comments or moves.
 */

type Strings = Dict['live'];

const TTL_MS = 30_000;
const MOVE_EVERY_MS = 66;
const TOUCH_EVERY_MS = 3_000;
/** A hidden tab lets go of its stream after this long (comments keep living on the server). */
const HIDDEN_CLOSE_MS = 20_000;
/** Same as the server's SITE_HEARTBEAT_MS (not imported: that would pull zod into the page). */
const HEARTBEAT_MS = 20_000;
const COLORS: SiteColor[] = ['blue', 'violet', 'green', 'yellow', 'cyan'];
const DARK_TEXT = new Set<SiteColor>(['green', 'yellow', 'cyan']);
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

const accent = (color: SiteColor) => `var(--color-accent-${color})`;
const ink = (color: SiteColor) => (DARK_TEXT.has(color) ? '#000' : '#fff');

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the name holds for this page only */
  }
}

/** The room: the path without base and language, so `/de/` and `/` meet. */
function roomOf(path: string): string {
  let rest = path.startsWith(BASE) ? path.slice(BASE.length) : path;
  rest = rest.replace(/^\/(de|fr)(?=\/|$)/, '').replace(/\/+$/, '');
  return (
    (rest || '/')
      .toLowerCase()
      .replace(/[^a-z0-9/-]/g, '')
      .slice(0, 80) || '/'
  );
}

function randomName(s: Strings): string {
  const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)]!;
  const adjective = pick(s.adjectives);
  const animal = pick(s.animals);
  return s.order === 'animal-first' ? `${animal} ${adjective}` : `${adjective} ${animal}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function face(visitor: Pick<SiteVisitor, 'name' | 'color'>): HTMLElement {
  const node = el('span', 'live-face', visitor.name.trim().charAt(0).toUpperCase());
  node.style.background = accent(visitor.color);
  node.style.color = ink(visitor.color);
  node.title = visitor.name;
  return node;
}

function anchorOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-live]') : null;
}

/** Page coordinates of a share of a section (falls back to <main> if the section isn't here). */
function place(
  a: string,
  x: number,
  y: number,
  w = 0,
  h = 0,
): { left: number; top: number; width: number; height: number } | null {
  const node =
    document.querySelector<HTMLElement>(`[data-live="${CSS.escape(a)}"]`) ??
    document.querySelector<HTMLElement>('[data-live="main"]');
  if (!node) return null;
  const box = node.getBoundingClientRect();
  return {
    left: box.left + scrollX + x * box.width,
    top: box.top + scrollY + y * box.height,
    width: w * box.width,
    height: h * box.height,
  };
}

/** Puts a comment (pin or box, card beside it) on its spot; the card flips left near the edge. */
function lay(node: HTMLElement, spot: NonNullable<ReturnType<typeof place>>): void {
  node.style.translate = `${spot.left}px ${spot.top}px`;
  const box = node.querySelector<HTMLElement>('.live-box');
  if (box) {
    box.style.width = `${spot.width}px`;
    box.style.height = `${spot.height}px`;
  }
  const card = node.querySelector<HTMLElement>('.live-card');
  if (card) card.style.setProperty('--box-w', `${spot.width}px`);
  node.classList.toggle(
    'flip',
    spot.left + spot.width + 280 > document.documentElement.clientWidth,
  );
}

/** What a click or drag must leave alone: links, buttons, fields, the live UI itself. */
const LEAVE_ALONE =
  'a, button, input, textarea, select, label, summary, [role="button"], [contenteditable], [data-site-header], [data-live-root] .live-dock, .live-comment, .live-hint, [data-op-slide], [data-op-box], [data-qs]';

interface ShownComment {
  data: SiteComment;
  node: HTMLElement;
  replies: HTMLElement;
  time: HTMLElement;
  touchedAt: number;
}

export function startLive(root: HTMLElement): void {
  const s = JSON.parse(root.dataset.strings ?? '{}') as Strings;
  const layer = root.querySelector<HTMLElement>('[data-live-layer]')!;
  const faces = root.querySelector<HTMLElement>('[data-live-faces]')!;
  const count = root.querySelector<HTMLElement>('[data-live-count]')!;
  const addButton = root.querySelector<HTMLButtonElement>('[data-live-add]')!;
  const hint = root.querySelector<HTMLElement>('[data-live-hint]')!;
  const room = roomOf(location.pathname);

  let name = stored('slider-live-name') ?? randomName(s);
  store('slider-live-name', name);
  let color =
    (stored('slider-live-color') as SiteColor | null) ??
    COLORS[Math.floor(Math.random() * COLORS.length)]!;
  if (!COLORS.includes(color)) color = 'blue';
  store('slider-live-color', color);
  const myCursor = ownCursor();
  announce();

  /** Tells the page who you are: your colour as `--me`, your name for the hero's mark. */
  function announce(): void {
    const html = document.documentElement;
    html.style.setProperty('--me', accent(color));
    html.style.setProperty('--me-ink', ink(color));
    (window as { __sliderMe?: { name: string; color: string } }).__sliderMe = { name, color };
    dispatchEvent(new CustomEvent('site-live:me', { detail: { name, color } }));
    myCursor?.style.setProperty('--c', accent(color));
    myCursor?.style.setProperty('--ink', ink(color));
  }

  /**
   * Your own pointer is your speech bubble in your colour, the same bubble everyone else here sees
   * with your name. Resting where a click starts a comment, it says so; links and buttons make it
   * grow, fields keep their text caret. Mouse only.
   */
  function ownCursor(): HTMLElement | null {
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return null;
    const node = el('div', 'bub-cursor live-me is-away');
    const bubble = el('span');
    bubble.append(el('em', 'live-say', s.comment));
    node.append(bubble);
    document.body.append(node);
    let shown = false;
    let resting: ReturnType<typeof setTimeout> | undefined;
    addEventListener(
      'pointermove',
      (event) => {
        if (event.pointerType !== 'mouse') return;
        node.style.translate = `${event.clientX}px ${event.clientY}px`;
        const target = event.target as Element | null;
        node.classList.toggle(
          'is-over',
          !!target?.closest('a, button, summary, [role="button"], label'),
        );
        node.classList.toggle('is-text', !!target?.closest('input, textarea, [contenteditable]'));
        node.classList.remove('is-say');
        clearTimeout(resting);
        if (key && target && !target.closest(LEAVE_ALONE) && anchorOf(target)) {
          resting = setTimeout(() => node.classList.add('is-say'), 450);
        }
        if (!shown) {
          shown = true;
          node.classList.remove('is-away');
          document.documentElement.classList.add('me-cursor');
        }
      },
      { passive: true },
    );
    addEventListener('pointerdown', () => {
      clearTimeout(resting);
      node.classList.remove('is-say');
    });
    document.documentElement.addEventListener('pointerleave', () => node.classList.add('is-away'));
    document.documentElement.addEventListener('pointerenter', () =>
      node.classList.remove('is-away'),
    );
    return node;
  }

  let source: EventSource | null = null;
  let key: string | null = null;
  let me: SiteVisitor | null = null;
  let failures = 0;
  let stopped = false;
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  const visitors = new Map<string, SiteVisitor>();
  const cursors = new Map<string, { node: HTMLElement; tag: HTMLElement; pointer: SitePointer }>();
  const comments = new Map<string, ShownComment>();
  let composer: HTMLElement | null = null;

  // ── Connection ────────────────────────────────────────────────────────────────────────────
  function connect(): void {
    if (source || stopped) return;
    const query = new URLSearchParams({ page: room, name, color });
    source = new EventSource(`${BASE}/api/site-live?${query}`);
    source.onmessage = (message) => handle(JSON.parse(message.data) as SiteLiveEvent);
    source.addEventListener('refused', (event) => {
      disconnect();
      if ((event as MessageEvent).data === 'full') {
        hint.textContent = s.full;
        hint.hidden = false;
        setTimeout(() => (hint.hidden = true), 4000);
      }
      stopped = true;
    });
    source.onerror = () => {
      // Not there at all (an API without live comments, offline): give up quietly.
      if (!key && (failures += 1) >= 3) {
        disconnect();
        stopped = true;
      }
    };
  }

  function disconnect(): void {
    if (key) send({ type: 'bye' }, true);
    source?.close();
    source = null;
    key = null;
    reset();
    root.hidden = true;
    document.documentElement.classList.remove('live-on');
  }

  function send(input: SiteLiveInput, beacon = false): void {
    if (!key) return;
    const url = `${BASE}/api/site-live/${key}`;
    const body = JSON.stringify(input);
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      return;
    }
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).then(
      (res) => {
        if (res.status === 404) key = null;
      },
      () => {},
    );
  }

  function reset(): void {
    visitors.clear();
    for (const c of cursors.values()) c.node.remove();
    cursors.clear();
    for (const c of comments.values()) c.node.remove();
    comments.clear();
  }

  // ── Events from the room ─────────────────────────────────────────────────────────────────
  function handle(event: SiteLiveEvent): void {
    switch (event.type) {
      case 'hello':
        failures = 0;
        reset();
        key = event.key;
        me = event.you;
        for (const v of event.visitors) visitors.set(v.id, v);
        for (const p of event.pointers) movePointer(p);
        for (const c of event.comments) showComment(c);
        root.hidden = false;
        document.documentElement.classList.add('live-on');
        break;
      case 'join':
        visitors.set(event.visitor.id, event.visitor);
        cursors.get(event.visitor.id)?.tag.replaceChildren(event.visitor.name);
        break;
      case 'leave':
        visitors.delete(event.id);
        cursors.get(event.id)?.node.remove();
        cursors.delete(event.id);
        break;
      case 'move':
        movePointer(event.pointer);
        return;
      case 'comment':
        // Your own comment from the hero's box: the hero shows it already.
        if (event.comment.by.id === me?.id && event.comment.a === 'opinion') break;
        showComment(event.comment);
        break;
      case 'reply': {
        const shown = comments.get(event.id);
        if (shown) {
          shown.data.replies.push(event.reply);
          shown.replies.append(replyNode(event.reply));
          restartTime(shown, event.left);
        }
        break;
      }
      case 'touch': {
        const shown = comments.get(event.id);
        if (shown) restartTime(shown, event.left);
        break;
      }
      case 'gone': {
        const shown = comments.get(event.id);
        if (!shown || shown.node.contains(document.activeElement)) {
          // Typing a reply into it: it stays on screen until you leave it; the server forgot it.
          if (shown) shown.node.addEventListener('focusout', () => drop(event.id), { once: true });
          break;
        }
        drop(event.id);
        break;
      }
    }
    renderDock();
  }

  function renderDock(): void {
    const others = [...visitors.values()];
    faces.replaceChildren(
      ...[me, ...others]
        .filter((v): v is SiteVisitor => !!v)
        .slice(0, 5)
        .map(face),
    );
    count.textContent = `${others.length + 1} ${s.here}`;
  }

  // ── Pointers ─────────────────────────────────────────────────────────────────────────────
  function movePointer(pointer: SitePointer): void {
    let shown = cursors.get(pointer.id);
    const visitor = visitors.get(pointer.id);
    if (!shown) {
      if (!visitor) return;
      const node = el('div', 'bub-cursor live-cursor');
      node.style.setProperty('--c', accent(visitor.color));
      node.style.setProperty('--ink', ink(visitor.color));
      const tag = el('span', '', visitor.name);
      node.append(tag);
      layer.append(node);
      shown = { node, tag, pointer };
      cursors.set(pointer.id, shown);
    }
    shown.pointer = pointer;
    const spot = pointer.a ? place(pointer.a, pointer.x, pointer.y) : null;
    shown.node.style.opacity = spot ? '1' : '0';
    if (spot) shown.node.style.translate = `${spot.left}px ${spot.top}px`;
  }

  let lastMove = 0;
  let pendingMove: ReturnType<typeof setTimeout> | undefined;
  let lastPointer: PointerEvent | null = null;
  function sendMove(): void {
    pendingMove = undefined;
    const event = lastPointer;
    if (!event || !key || visitors.size === 0) return;
    lastMove = performance.now();
    const anchor = anchorOf(event.target);
    if (!anchor) return send({ type: 'move', a: null, x: 0, y: 0 });
    const box = anchor.getBoundingClientRect();
    send({
      type: 'move',
      a: anchor.dataset.live!,
      x: round((event.clientX - box.left) / box.width),
      y: round((event.clientY - box.top) / box.height),
    });
  }
  addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType !== 'mouse' || !key || visitors.size === 0) return;
      lastPointer = event;
      if (pendingMove) return;
      pendingMove = setTimeout(
        sendMove,
        Math.max(0, MOVE_EVERY_MS - (performance.now() - lastMove)),
      );
    },
    { passive: true },
  );
  document.documentElement.addEventListener('pointerleave', () => {
    if (key && visitors.size > 0) send({ type: 'move', a: null, x: 0, y: 0 });
  });

  // ── Comments ─────────────────────────────────────────────────────────────────────────────
  function replyNode(reply: SiteReply): HTMLElement {
    const node = el('div', 'live-reply');
    const body = el('div');
    body.append(el('b', '', reply.by.name), el('span', 'live-text', reply.text));
    node.append(face(reply.by), body);
    return node;
  }

  function showComment(data: SiteComment): void {
    if (comments.has(data.id)) return;
    const node = el('div', 'live-comment');
    const pin = el('span', 'live-pin');
    pin.style.background = accent(data.by.color);
    const card = el('div', 'live-card');
    const head = el('div', 'live-head');
    head.append(
      face(data.by),
      el('span', '', data.by.id === me?.id ? `${data.by.name} (${s.you})` : data.by.name),
    );
    const replies = el('div');
    replies.style.display = 'contents';
    for (const reply of data.replies) replies.append(replyNode(reply));
    const input = el('textarea', 'live-input is-reply');
    input.rows = 1;
    input.placeholder = s.reply;
    input.maxLength = 280;
    const time = el('span', 'live-time');
    time.style.background = accent(data.by.color);
    card.append(head, el('div', 'live-text', data.text), replies, input, time);
    node.append(data.w && data.h ? boxNode(data.by, true) : pin, card);
    layer.append(node);

    const shown: ShownComment = { data, node, replies, time, touchedAt: 0 };
    comments.set(data.id, shown);
    position(shown);
    restartTime(shown, data.left);

    const touch = () => {
      if (performance.now() - shown.touchedAt < TOUCH_EVERY_MS) return;
      shown.touchedAt = performance.now();
      send({ type: 'touch', id: data.id });
    };
    card.addEventListener('pointerenter', touch);
    input.addEventListener('focus', touch);
    input.addEventListener('input', touch);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const text = input.value.trim();
        if (text) send({ type: 'reply', id: data.id, text });
        input.value = '';
      } else if (event.key === 'Escape') {
        input.blur();
      }
    });
  }

  function restartTime(shown: ShownComment, left: number): void {
    shown.data.left = left;
    shown.time.style.animation = 'none';
    void shown.time.offsetWidth;
    shown.time.style.setProperty('--from', String(Math.min(1, left / TTL_MS)));
    shown.time.style.animation = `live-time ${left}ms linear forwards`;
  }

  function position(shown: ShownComment): void {
    const { a, x, y, w, h } = shown.data;
    const spot = place(a, x, y, w, h);
    if (spot) lay(shown.node, spot);
  }

  /** A marked area (`.mark-box` in site.css): edge and the author's tag. */
  function boxNode(who: Pick<SiteVisitor, 'name' | 'color'>, fresh = false): HTMLElement {
    const box = el('span', `mark-box live-box${fresh ? ' is-new' : ''}`);
    box.style.setProperty('--c', accent(who.color));
    box.style.setProperty('--ink', ink(who.color));
    box.append(el('span', 'mark-tag', who.name));
    return box;
  }

  function drop(id: string): void {
    const shown = comments.get(id);
    if (!shown) return;
    comments.delete(id);
    shown.node.classList.add('is-gone');
    setTimeout(() => shown.node.remove(), 260);
  }

  // ── Placing a new comment ────────────────────────────────────────────────────────────────
  // With a mouse, a click on anything that isn't a link, button or field starts a comment there,
  // a drag draws a box around what is meant. On touch (scrolling) the dock's button arms one tap.
  function setPlacing(on: boolean): void {
    document.documentElement.classList.toggle('live-placing', on);
    hint.textContent = `${s.place} · ${s.cancel}`;
    hint.hidden = !on;
  }

  interface Spot {
    a: string;
    x: number;
    y: number;
    w?: number;
    h?: number;
  }

  function openComposer(at: Spot): void {
    closeComposer();
    const spot = place(at.a, at.x, at.y, at.w, at.h);
    if (!spot) return;
    const node = el('div', 'live-comment is-draft');
    const pin = el('span', 'live-pin');
    pin.style.background = accent(color);
    const card = el('form', 'live-card');
    const head = el('div', 'live-head');
    const nameField = el('input', 'live-name');
    nameField.value = name;
    nameField.maxLength = 24;
    nameField.setAttribute('aria-label', s.name);
    head.append(face({ name, color }), nameField);
    const input = el('textarea', 'live-input');
    input.rows = 1;
    input.placeholder = s.write;
    input.maxLength = 280;
    // Grows with the text, up to a few lines.
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    });
    const sendButton = el('button', 'live-send');
    sendButton.type = 'submit';
    sendButton.setAttribute('aria-label', s.send);
    sendButton.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11 20V7.8l-5.6 5.6L4 12l8-8 8 8-1.4 1.4L13 7.8V20Z"/></svg>';
    const compose = el('div', 'live-compose');
    compose.append(input, sendButton);
    card.append(head, compose, el('p', 'live-foot', s.fades));
    node.append(at.w ? boxNode({ name, color }) : pin, card);
    layer.append(node);
    lay(node, spot);
    composer = node;
    input.focus({ preventScroll: true });

    const submit = () => {
      const text = input.value.trim();
      const wanted = nameField.value.trim().slice(0, 24);
      if (wanted && wanted !== name) {
        name = wanted;
        store('slider-live-name', name);
        if (me) me.name = name;
        announce();
        send({ type: 'name', name });
      }
      if (text) {
        const size = at.w && at.h ? { w: round(at.w), h: round(at.h) } : {};
        send({ type: 'comment', a: at.a, x: round(at.x), y: round(at.y), ...size, text });
      }
      closeComposer();
    };
    card.addEventListener('submit', (event) => {
      event.preventDefault();
      submit();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    });
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeComposer();
    });
  }

  function closeComposer(): void {
    composer?.remove();
    composer = null;
  }

  const composing = () => !!composer?.querySelector('textarea')?.value.trim();
  const placing = () => document.documentElement.classList.contains('live-placing');
  addButton.addEventListener('click', () => setPlacing(!placing()));

  /** The press that may become a comment: where it started, the box once it is a drag. */
  let press: { anchor: HTMLElement; x: number; y: number; box: HTMLElement | null } | null = null;
  /** The click after a press that placed a comment does nothing else (a link under a tap). */
  let swallowClick = false;
  const DRAG_PX = 6;

  addEventListener('pointerdown', (event) => {
    if (composer && !composer.contains(event.target as Node) && !composing()) closeComposer();
    if (!key || event.button !== 0 || composing()) return;
    const armed = placing();
    if (!armed && event.pointerType === 'touch') return;
    const target = event.target as Element;
    if (root.contains(target) && !layer.contains(target)) return;
    if (!armed && target.closest(LEAVE_ALONE)) return;
    const anchor = anchorOf(target) ?? document.querySelector<HTMLElement>('[data-live="main"]');
    if (anchor) press = { anchor, x: event.clientX, y: event.clientY, box: null };
  });

  addEventListener('pointermove', (event) => {
    if (!press || event.pointerType === 'touch') return;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if (!press.box && Math.hypot(dx, dy) < DRAG_PX) return;
    if (!press.box) {
      press.box = boxNode({ name, color });
      press.box.classList.add('is-drawing');
      layer.append(press.box);
      document.documentElement.classList.add('live-drawing');
    }
    getSelection()?.removeAllRanges();
    const left = Math.min(press.x, event.clientX) + scrollX;
    const top = Math.min(press.y, event.clientY) + scrollY;
    press.box.style.translate = `${left}px ${top}px`;
    press.box.style.width = `${Math.abs(dx)}px`;
    press.box.style.height = `${Math.abs(dy)}px`;
  });

  const endPress = (event: PointerEvent) => {
    const done = press;
    press = null;
    document.documentElement.classList.remove('live-drawing');
    done?.box?.remove();
    if (!done || event.type === 'pointercancel') return;
    // A click that selected text (double click on a word) is a selection, not a comment.
    if (!done.box && getSelection()?.toString()) return;
    const area = done.anchor.getBoundingClientRect();
    const share = (px: number, from: number, size: number) => (px - from) / size;
    const x0 = Math.min(done.x, event.clientX);
    const y0 = Math.min(done.y, event.clientY);
    const at: Spot = done.box
      ? {
          a: done.anchor.dataset.live!,
          x: share(x0, area.left, area.width),
          y: share(y0, area.top, area.height),
          w: Math.abs(event.clientX - done.x) / area.width,
          h: Math.abs(event.clientY - done.y) / area.height,
        }
      : {
          a: done.anchor.dataset.live!,
          x: share(done.x, area.left, area.width),
          y: share(done.y, area.top, area.height),
        };
    swallowClick = placing();
    setPlacing(false);
    openComposer(at);
  };
  addEventListener('pointerup', endPress);
  addEventListener('pointercancel', endPress);
  addEventListener(
    'click',
    (event) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && placing()) setPlacing(false);
  });

  // The hero's comment box (Opinion.astro) speaks to the room too, so everyone here sees it.
  addEventListener('site-live:comment', (event) => {
    const { a, x, y, text } = (
      event as CustomEvent<{ a: string; x: number; y: number; text: string }>
    ).detail;
    send({ type: 'comment', a, x: round(x), y: round(y), text });
  });

  setInterval(() => {
    if (key) send({ type: 'here' });
  }, HEARTBEAT_MS);

  // ── Layout and lifecycle ─────────────────────────────────────────────────────────────────
  let relayout = 0;
  const layout = () => {
    cancelAnimationFrame(relayout);
    relayout = requestAnimationFrame(() => {
      for (const c of comments.values()) position(c);
      for (const c of cursors.values()) movePointer(c.pointer);
    });
  };
  addEventListener('resize', layout);
  new ResizeObserver(layout).observe(document.body);

  document.addEventListener('visibilitychange', () => {
    clearTimeout(hiddenTimer);
    if (document.hidden) hiddenTimer = setTimeout(disconnect, HIDDEN_CLOSE_MS);
    else connect();
  });
  addEventListener('pagehide', () => {
    if (key) send({ type: 'bye' }, true);
  });

  // After the page has settled: live comments never compete with the first paint.
  const begin = () => {
    if (!document.hidden) connect();
  };
  if ('requestIdleCallback' in window) requestIdleCallback(begin, { timeout: 2000 });
  else setTimeout(begin, 1000);
}

const round = (n: number) => Math.round(Math.min(1.5, Math.max(-0.5, n)) * 10_000) / 10_000;
