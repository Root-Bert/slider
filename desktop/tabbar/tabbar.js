// Draws the tabs the main process reports; a click picks a tab, ✕ or a middle click closes it,
// a double click renames its presentation. Right: the presentation in front's
// „Präsentieren“, „Referentenansicht“, „Exportieren“ and ✕.
/* global tabs, window, document, location, URLSearchParams */
const nav = document.querySelector('nav');
const actions = document.querySelector('.actions');
// The theme Slider opens in, before the first state arrives.
document.documentElement.dataset.theme =
  new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';
// macOS leaves room for the traffic lights; Linux has its own window frame.
document.documentElement.dataset.platform = new URLSearchParams(location.search).get('platform');

// Slider's own icons (apps/web/src/ui/icon-paths.ts).
const ICONS = {
  slideshow:
    'M10 8v8l5-4-5-4zm9-5H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z',
  notes: 'M3 18h12v-2H3v2zM3 6v2h18V6H3zm0 7h18v-2H3v2z',
  iosShare:
    'M6 22C5.45 22 4.97917 21.8042 4.5875 21.4125C4.19583 21.0208 4 20.55 4 20V10C4 9.45 4.19583 8.97917 4.5875 8.5875C4.97917 8.19583 5.45 8 6 8H8C8.28333 8 8.52083 8.09583 8.7125 8.2875C8.90417 8.47917 9 8.71667 9 9C9 9.28333 8.90417 9.52083 8.7125 9.7125C8.52083 9.90417 8.28333 10 8 10H6V20H18V10H16C15.7167 10 15.4792 9.90417 15.2875 9.7125C15.0958 9.52083 15 9.28333 15 9C15 8.71667 15.0958 8.47917 15.2875 8.2875C15.4792 8.09583 15.7167 8 16 8H18C18.55 8 19.0208 8.19583 19.4125 8.5875C19.8042 8.97917 20 9.45 20 10V20C20 20.55 19.8042 21.0208 19.4125 21.4125C19.0208 21.8042 18.55 22 18 22H6ZM12 16C11.7167 16 11.4792 15.9042 11.2875 15.7125C11.0958 15.5208 11 15.2833 11 15V4.825L10.1 5.725C9.9 5.925 9.66667 6.02083 9.4 6.0125C9.13333 6.00417 8.9 5.9 8.7 5.7C8.51667 5.5 8.42083 5.26667 8.4125 5C8.40417 4.73333 8.5 4.5 8.7 4.3L11.3 1.7C11.4 1.6 11.5083 1.52917 11.625 1.4875C11.7417 1.44583 11.8667 1.425 12 1.425C12.1333 1.425 12.2583 1.44583 12.375 1.4875C12.4917 1.52917 12.6 1.6 12.7 1.7L15.3 4.3C15.4833 4.48333 15.575 4.7125 15.575 4.9875C15.575 5.2625 15.4833 5.5 15.3 5.7C15.1 5.9 14.8625 6 14.5875 6C14.3125 6 14.075 5.9 13.875 5.7L13 4.825V15C13 15.2833 12.9042 15.5208 12.7125 15.7125C12.5208 15.9042 12.2833 16 12 16Z',
  close:
    'M12 13.4l-4.9 4.9a.95.95 0 0 1-1.4 0 .95.95 0 0 1 0-1.4l4.9-4.9-4.9-4.9a.95.95 0 0 1 0-1.4.95.95 0 0 1 1.4 0l4.9 4.9 4.9-4.9a.95.95 0 0 1 1.4 0 .95.95 0 0 1 0 1.4L13.4 12l4.9 4.9a.95.95 0 0 1 0 1.4.95.95 0 0 1-1.4 0z',
};

/**
 * Slider's mark (LogoMark in apps/web/src/ui/Logo.tsx) in the app header's mono tone, for home.
 * Static markup, no input in it.
 */
function mark() {
  const template = document.createElement('template');
  template.innerHTML = `<svg width="18" height="16.65" viewBox="0 0 24.05 22.25" fill="none" aria-hidden="true" class="mark">
    <rect x=".2315" y=".2315" width="20" height="11.25" rx="3" class="back" />
    <path d="M3.1435 2.1065h7.6389" class="lines" stroke-width=".75" />
    <rect x="2.537" y="9.9769" width="20" height="12.0139" rx="3" class="front" />
    <path d="M5.412 17.1852h.5787M7.787 17.1852h9.4907M5.412 19.4545h.5787M7.787 19.4545h6.25" class="lines" stroke-width=".75" />
    <path d="M10.037 3.4861h10a4 4 0 0 1 4 4v3.25a4 4 0 0 1-4 4H7.037a1 1 0 0 1-1-1V7.4861a4 4 0 0 1 4-4Z" class="bubble" />
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

/**
 * The presentation in front's buttons, as in the web app's deck pill (PresentButton,
 * ShareButton, SessionControls): what its page offers (`null`: none, e.g. while it loads or
 * presents). ✕ closes it as there – the tab goes, home shows where it went.
 */
function renderActions(deck) {
  actions.replaceChildren();
  actions.hidden = !deck;
  if (!deck) return;
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
  const { tabs: list, active, deck, theme, fullscreen } = state;
  document.documentElement.dataset.theme = theme;
  document.documentElement.toggleAttribute('data-fullscreen', fullscreen);
  renderActions(deck);
  nav.replaceChildren();
  for (const tab of list) {
    const button = document.createElement('div');
    button.className = tab.kind === 'home' ? 'tab home' : 'tab';
    button.setAttribute('role', 'tab');
    button.tabIndex = tab.id === active ? 0 : -1;
    button.setAttribute('aria-selected', String(tab.id === active));
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

tabs.onState(render);
