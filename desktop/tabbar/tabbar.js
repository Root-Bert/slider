// Draws the tabs the main process reports; a click picks a tab, ✕ or a middle click closes it,
// a double click renames its presentation. Right: the presentation in front's
// „Präsentieren“, „Referentenansicht“, „Exportieren“ and ✕.
/* global tabs, window, document, location, URLSearchParams, setTimeout, clearTimeout */
const nav = document.querySelector('nav');
const actions = document.querySelector('.actions');
// The theme Slider opens in, before the first state arrives.
document.documentElement.dataset.theme =
  new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';
// macOS leaves room for the traffic lights; Linux has its own window frame.
document.documentElement.dataset.platform = new URLSearchParams(location.search).get('platform');
/** Whose window this is (`app.name` in ../tabs.mjs): Slider's, Cloud's, Writer's, Reader's or Sender's. */
const APP = new URLSearchParams(location.search).get('app');
if (APP === 'writer') {
  nav.setAttribute('aria-label', 'Geöffnete Dokumente');
  actions.setAttribute('aria-label', 'Dokument');
}
if (APP === 'reader') {
  nav.setAttribute('aria-label', 'Geöffnete PDFs');
  actions.setAttribute('aria-label', 'PDF');
}

// Slider's own icons (apps/web/src/ui/icon-paths.ts).
const ICONS = {
  slideshow:
    'M10 8v8l5-4-5-4zm9-5H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z',
  notes: 'M3 18h12v-2H3v2zM3 6v2h18V6H3zm0 7h18v-2H3v2z',
  print:
    'M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z',
  iosShare:
    'M6 22C5.45 22 4.97917 21.8042 4.5875 21.4125C4.19583 21.0208 4 20.55 4 20V10C4 9.45 4.19583 8.97917 4.5875 8.5875C4.97917 8.19583 5.45 8 6 8H8C8.28333 8 8.52083 8.09583 8.7125 8.2875C8.90417 8.47917 9 8.71667 9 9C9 9.28333 8.90417 9.52083 8.7125 9.7125C8.52083 9.90417 8.28333 10 8 10H6V20H18V10H16C15.7167 10 15.4792 9.90417 15.2875 9.7125C15.0958 9.52083 15 9.28333 15 9C15 8.71667 15.0958 8.47917 15.2875 8.2875C15.4792 8.09583 15.7167 8 16 8H18C18.55 8 19.0208 8.19583 19.4125 8.5875C19.8042 8.97917 20 9.45 20 10V20C20 20.55 19.8042 21.0208 19.4125 21.4125C19.0208 21.8042 18.55 22 18 22H6ZM12 16C11.7167 16 11.4792 15.9042 11.2875 15.7125C11.0958 15.5208 11 15.2833 11 15V4.825L10.1 5.725C9.9 5.925 9.66667 6.02083 9.4 6.0125C9.13333 6.00417 8.9 5.9 8.7 5.7C8.51667 5.5 8.42083 5.26667 8.4125 5C8.40417 4.73333 8.5 4.5 8.7 4.3L11.3 1.7C11.4 1.6 11.5083 1.52917 11.625 1.4875C11.7417 1.44583 11.8667 1.425 12 1.425C12.1333 1.425 12.2583 1.44583 12.375 1.4875C12.4917 1.52917 12.6 1.6 12.7 1.7L15.3 4.3C15.4833 4.48333 15.575 4.7125 15.575 4.9875C15.575 5.2625 15.4833 5.5 15.3 5.7C15.1 5.9 14.8625 6 14.5875 6C14.3125 6 14.075 5.9 13.875 5.7L13 4.825V15C13 15.2833 12.9042 15.5208 12.7125 15.7125C12.5208 15.9042 12.2833 16 12 16Z',
  // Material Icons „view_week“-like: two columns.
  // Two panes beside each other.
  split:
    'M3.5 5h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm0 2v10h6V7h-6zM14.5 5h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm0 2v10h6V7h-6z',
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  expandMore: 'M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z',
  close:
    'M12 13.4l-4.9 4.9a.95.95 0 0 1-1.4 0 .95.95 0 0 1 0-1.4l4.9-4.9-4.9-4.9a.95.95 0 0 1 0-1.4.95.95 0 0 1 1.4 0l4.9 4.9 4.9-4.9a.95.95 0 0 1 1.4 0 .95.95 0 0 1 0 1.4L13.4 12l4.9 4.9a.95.95 0 0 1 0 1.4.95.95 0 0 1-1.4 0z',
};

/**
 * Slider's mark (LogoMark in apps/web/src/ui/Logo.tsx) in its own colours, for home.
 * Static markup, no input in it.
 */
function mark() {
  // Cloud's window (`../cloud/main.mjs`): its mark, in its own colours.
  // Writer's (`../writer/main.mjs`), Reader's and Sender's likewise.
  if (APP === 'cloud' || APP === 'writer' || APP === 'reader' || APP === 'sender') {
    const image = document.createElement('img');
    image.src = `../${APP}/mark.svg`;
    image.width = APP === 'reader' ? 16 : 18;
    image.height = APP === 'cloud' ? 16 : APP === 'reader' ? 17.5 : APP === 'sender' ? 16.5 : 17;
    image.alt = '';
    return image;
  }
  const template = document.createElement('template');
  template.innerHTML = `<svg width="18" height="16.65" viewBox="0 0 24.05 22.25" fill="none" aria-hidden="true" class="mark">
    <path d="M10.3774 12.6131L6.0917 21.6607M10.3774 12.6131L14.6631 21.6607M10.3774 12.6131L10.3774 20.7083" class="legs" stroke-width=".8333" stroke-linecap="round" />
    <rect x="1.3298" y="1.4226" width="18.0952" height="18.3333" rx="1.1905" class="screen" />
    <path d="M2.5202 4.0417h1.4286" class="title" stroke-width=".7143" stroke-linecap="round" />
    <path d="M2.5202 13.0893h1.9048v5.4762H2.5202ZM5.1393 16.4226h1.9048v2.1429H5.1393ZM7.7583 10.9464h1.9048v7.619H7.7583ZM10.3774 15.2321h1.9048v3.3333h-1.9048ZM12.9964 17.1369h1.9048v1.4286h-1.9048ZM15.6155 9.5179h1.9048v9.0476h-1.9048Z" class="bars" />
    <rect x=".3774" y=".2321" width="20" height="1.6667" rx=".8333" class="roll" />
    <path d="M9.2726 2.6274h10.2857a4.1143 4.1143 0 0 1 4.1143 4.1143v3.3429a4.1143 4.1143 0 0 1-4.1143 4.1143H6.1869a1.0286 1.0286 0 0 1-1.0286-1.0286V6.7417a4.1143 4.1143 0 0 1 4.1143-4.1143Z" class="bubble" />
  </svg>`;
  return template.content.firstElementChild;
}

function icon(name, size) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

/** The state last reported; while a name is typed it waits, so the field stays. */
let shown = null;
/** The tab whose name is being typed. */
let editing = null;

/**
 * „Umbenennen“ in place, as on the presentation's card: the title turns into a field. ↵ or
 * leaving it saves, Esc cancels; empty or unchanged just ends it. ↵ and Esc hand the keys back to
 * the page.
 */
function rename(tab, title) {
  editing = tab.id;
  const input = document.createElement('input');
  input.className = 'title edit';
  input.value = tab.title;
  input.maxLength = 200;
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Name der Präsentation');
  let done = false;
  const finish = (save, back) => {
    if (done) return;
    done = true;
    editing = null;
    window.removeEventListener('focus', reselect);
    const name = input.value.trim();
    if (save && name && name !== tab.title) {
      tabs.rename(tab.id, name);
      // Shown at once; the main process says it back.
      shown = {
        ...shown,
        tabs: shown.tabs.map((each) => (each.id === tab.id ? { ...each, title: name } : each)),
      };
    }
    // The field goes even when nothing changed.
    drawn = '';
    render(shown);
    if (back) tabs.select(tab.id);
  };
  input.addEventListener('mousedown', (event) => event.stopPropagation());
  input.addEventListener('keydown', (event) => {
    // Not the tab's keys (space picks it).
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false, true);
    }
  });
  input.addEventListener('blur', () => finish(true, false));
  title.replaceWith(input);
  // The keys come to the bar a moment later; the caret it puts back is the whole name again.
  const reselect = () => input.select();
  window.addEventListener('focus', reselect, { once: true });
  tabs.typing();
  input.focus();
  input.select();
}

// The keys as the web app names them (presenterShortcut in apps/web).
const PRESENTER_KEY = document.documentElement.dataset.platform === 'darwin' ? '⌥P' : 'Alt P';
const EXPORT_KEY = document.documentElement.dataset.platform === 'darwin' ? '⇧⌘E' : 'Strg ⇧ E';
const PRINT_KEY = document.documentElement.dataset.platform === 'darwin' ? '⌘P' : 'Strg P';

/**
 * Writer's document in front (`writerDesktop.docBar` in its page): „Drucken“ where a deck has
 * „Präsentieren“, „Exportieren“ where the page offers it, then ✕ – the deck's look and order.
 * Reader's PDF (`readerDesktop.docBar`) the same.
 */
function documentItems(offer) {
  const items = [
    { action: 'print', icon: 'print', label: 'Drucken', title: `Drucken (${PRINT_KEY})` },
  ];
  if (offer.export) {
    items.push({
      action: 'export',
      icon: 'iosShare',
      label: 'Exportieren',
      title: `Exportieren (${EXPORT_KEY})`,
      expanded: offer.exportOpen,
    });
  }
  const closeLabel = APP === 'reader' ? 'PDF schließen' : 'Dokument schließen';
  items.push('divider', { action: 'close', icon: 'close', label: closeLabel, title: closeLabel });
  return items;
}

/** The presentation's: „Präsentieren“, „Referentenansicht“, „Exportieren“, then ✕. */
function deckItems(deck) {
  const items = [
    { action: 'present', icon: 'slideshow', label: 'Präsentieren', title: 'Präsentieren (P)' },
    {
      action: 'presenter',
      icon: 'notes',
      label: 'Referentenansicht',
      title: `Referentenansicht (${PRESENTER_KEY})`,
    },
  ];
  if (deck.share) {
    items.push({
      action: 'share',
      icon: 'iosShare',
      label: 'Exportieren',
      title: 'Exportieren (S)',
      expanded: deck.shareOpen,
    });
  }
  const closeLabel = deck.template ? 'Vorlage schließen' : 'Präsentation schließen';
  items.push('divider', { action: 'close', icon: 'close', label: closeLabel, title: closeLabel });
  return items;
}

/**
 * The presentation in front's buttons, as in the web app's deck pill (PresentButton,
 * ShareButton, SessionControls): what its page offers (`null`: none, e.g. while it loads or
 * presents). ✕ closes it as there – the tab goes, home shows where it went.
 */
function renderActions(deck, split, beside) {
  actions.replaceChildren();
  actions.hidden = !deck && !split;
  if (split) {
    // Cloud's folders: two tabs side by side.
    const button = document.createElement('button');
    button.className = 'action';
    button.type = 'button';
    button.title = beside ? 'Nebeneinander beenden' : 'Nebeneinander';
    button.setAttribute('aria-label', 'Nebeneinander');
    button.setAttribute('aria-pressed', String(beside));
    button.append(icon('split', 18));
    button.addEventListener('click', () => tabs.split());
    actions.append(button);
  }
  if (!deck) return;
  const items = APP === 'writer' || APP === 'reader' ? documentItems(deck) : deckItems(deck);
  for (const item of items) {
    if (item === 'divider') {
      const divider = document.createElement('div');
      divider.className = 'divider';
      actions.append(divider);
      continue;
    }
    const button = document.createElement('button');
    button.className = 'action';
    button.type = 'button';
    button.title = item.title;
    button.setAttribute('aria-label', item.label);
    if (item.expanded !== undefined) button.setAttribute('aria-expanded', String(item.expanded));
    button.append(icon(item.icon, 18));
    button.addEventListener('click', () => tabs.deckAction(item.action));
    actions.append(button);
  }
}

/** What was drawn last: the same state again (each pick reports one) leaves the bar as it is. */
let drawn = '';

function render(state) {
  shown = state;
  if (editing !== null) return;
  const key = JSON.stringify(state);
  if (key === drawn) return;
  drawn = key;
  const { tabs: list, active, beside, split, fresh, freshMenu, deck, theme, fullscreen } = state;
  document.documentElement.dataset.theme = theme;
  document.documentElement.toggleAttribute('data-fullscreen', fullscreen);
  renderActions(deck, split, beside != null);
  nav.replaceChildren();
  for (const tab of list) {
    const button = document.createElement('div');
    button.className = tab.kind === 'home' ? 'tab home' : 'tab';
    button.setAttribute('role', 'tab');
    button.tabIndex = tab.id === active ? 0 : -1;
    button.setAttribute('aria-selected', String(tab.id === active));
    button.toggleAttribute('data-beside', tab.id === beside);
    button.title = tab.title;
    button.dataset.id = String(tab.id);
    button.addEventListener('mousedown', (event) => {
      if (event.button === 1 && tab.kind !== 'home') {
        event.preventDefault();
        tabs.close(tab.id);
      } else if (event.button === 0) tabs.select(tab.id);
    });
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') tabs.select(tab.id);
    });
    if (tab.kind === 'home') {
      button.setAttribute('aria-label', tab.title);
      button.append(mark());
    } else {
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = tab.title;
      const close = document.createElement('button');
      close.className = 'close';
      close.type = 'button';
      close.setAttribute('aria-label', `${tab.title} schließen`);
      close.append(icon('close', 14));
      close.addEventListener('mousedown', (event) => event.stopPropagation());
      close.addEventListener('click', () => tabs.close(tab.id));
      button.append(title, close);
    }
    nav.append(button);
    if (tab.kind === 'home') {
      const divider = document.createElement('div');
      divider.className = 'divider';
      divider.hidden = list.length < 2;
      nav.append(divider);
    }
  }
  if (fresh) {
    const button = document.createElement('button');
    button.className = 'action';
    button.type = 'button';
    button.title = 'Neuer Tab';
    button.setAttribute('aria-label', 'Neuer Tab');
    button.append(icon('add', 16));
    button.addEventListener('click', () => tabs.fresh());
    nav.append(button);
  }
  if (fresh && freshMenu) {
    // Beside „+“: a new tab on another app of the window's (Slider, Writer).
    const button = document.createElement('button');
    button.className = 'action more';
    button.type = 'button';
    button.title = 'Neuer Tab mit …';
    button.setAttribute('aria-label', 'Neuer Tab mit …');
    button.setAttribute('aria-haspopup', 'menu');
    button.append(icon('expandMore', 16));
    button.addEventListener('click', () => {
      const box = button.getBoundingClientRect();
      tabs.freshMenu(box.left, box.bottom + 4);
    });
    nav.append(button);
  }
}

// On the bar, not on a tab: the first click's pick draws the bar anew, and with a real mouse
// that can fall between the second press and its release – the double click then belongs to no
// tab. The tab under the pointer is the one meant.
nav.addEventListener('dblclick', (event) => {
  const element = document.elementFromPoint(event.clientX, event.clientY)?.closest('.tab');
  if (!element || document.elementFromPoint(event.clientX, event.clientY).closest('.close')) return;
  const tab = shown?.tabs.find((each) => String(each.id) === element.dataset.id);
  if (tab?.renamable && editing === null) rename(tab, element.querySelector('.title'));
});

// Files dragged out of a page (apps/web/src/features/cloud/lib/drag.ts): a tab takes them into
// its folder; held over a tab a moment, the tab comes to the front – so files from the desktop
// find their way too.
const NODES_DRAG = 'application/x-cloud-nodes';
let springTab = null;
let springTimer = null;
const spring = (element) => {
  if (element === springTab) return;
  clearTimeout(springTimer);
  springTab?.removeAttribute('data-over');
  springTab = element;
  if (!element) return;
  element.setAttribute('data-over', '');
  const id = Number(element.dataset.id);
  springTimer = setTimeout(() => tabs.select(id), 700);
};
nav.addEventListener('dragover', (event) => {
  const element = event.target.closest?.('.tab') ?? null;
  const types = event.dataTransfer.types;
  if (!shown?.split || !element || !(types.includes(NODES_DRAG) || types.includes('Files'))) {
    return spring(null);
  }
  spring(element);
  if (!types.includes(NODES_DRAG)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
});
nav.addEventListener('dragleave', (event) => {
  if (!nav.contains(event.relatedTarget)) spring(null);
});
nav.addEventListener('drop', (event) => {
  const element = event.target.closest?.('.tab') ?? null;
  spring(null);
  const carried = event.dataTransfer.getData(NODES_DRAG);
  if (!element || !carried) return;
  event.preventDefault();
  tabs.drop(Number(element.dataset.id), carried);
});

// Nothing let go on the bar may open in it (a file from the Finder, a link).
for (const name of ['dragover', 'drop']) {
  document.addEventListener(name, (event) => {
    if (!event.defaultPrevented) event.preventDefault();
  });
}

tabs.onState(render);
