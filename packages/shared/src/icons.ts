/*
 * The symbols Slider brings along – Phosphor's icons (MIT) and IBM Carbon's pictograms (Apache
 * 2.0), built by `scripts/icon-sets.ts` into `apps/web/src/features/icons/sets/*.json`: read and
 * searched alike in the editor („Symbol einfügen“) and by the AI (`search_icons`), in German or
 * English. Each is one colour: drawn in the one picked.
 */

/** „Icons“ – small signs in lines – or „Piktogramme“ – pictures that explain, drawn larger. */
export type IconKind = 'icons' | 'pictograms';
export type IconFilter = 'all' | IconKind;

export type IconRow = [name: string, label: string, keywords: string, body: string];

export interface IconSetFile {
  id: string;
  name: string;
  kind: IconKind;
  license: string;
  url: string;
  viewBox: string;
  icons: IconRow[];
}

export interface LibraryIcon {
  /** `phosphor/house` – the same in every build of the sets. */
  id: string;
  name: string;
  /** As shown: `House`, `Accelerated computing`. */
  label: string;
  kind: IconKind;
  viewBox: string;
  /** The SVG's inside, of one colour (`currentColor` or none – the root's). */
  body: string;
  /** Name, label and keywords as searched (`fold`) – the name's first. */
  words: string[];
  /** How many of `words` are the name's. */
  named: number;
}

export interface IconLibrary {
  icons: readonly LibraryIcon[];
}

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };
const ACCENTS = new RegExp('[\\u0300-\\u036f]', 'g');

/** Lower case, without accents: `Glühbirne` → `gluehbirne`, `Straße` → `strasse`, `é` → `e`. */
export const fold = (text: string) =>
  text
    .toLowerCase()
    .replace(/[äöüß]/g, (letter) => UMLAUTS[letter] ?? letter)
    .normalize('NFD')
    .replace(ACCENTS, '');

/** The icons of one set's file, ready to search. */
export function iconsOfSet(file: IconSetFile): LibraryIcon[] {
  return file.icons.map(([name, label, keywords, body]) => {
    const named = fold(name).split(/[^a-z0-9]+/);
    return {
      id: `${file.id}/${name}`,
      name,
      label,
      kind: file.kind,
      viewBox: file.viewBox,
      body,
      words: [...named, ...fold(`${label} ${keywords}`).split(/[^a-z0-9]+/)].filter(Boolean),
      named: named.length,
    };
  });
}

/**
 * German words for the English the sets are named in – what one would type for a slide. A word
 * typed matches its translations as well as itself; the start of a word is enough, and so is an
 * inflected one (`pfe`, `pfeil` → `arrow`, `pfeile` too).
 */
const GERMAN: Record<string, string> = {
  abc: 'alphabet',
  achtung: 'warning alert',
  adresse: 'address location',
  aktie: 'stock chart',
  analyse: 'analysis analytics chart',
  anruf: 'call phone',
  apfel: 'apple',
  arbeit: 'work briefcase',
  auge: 'eye',
  ausweis: 'id identification card',
  auszeichnung: 'medal award',
  auto: 'car',
  bank: 'bank',
  baum: 'tree',
  bearbeiten: 'pencil edit',
  benutzer: 'user person',
  berg: 'mountain',
  bild: 'image picture',
  blatt: 'leaf',
  blitz: 'lightning',
  blume: 'flower',
  brief: 'envelope mail letter',
  buch: 'book',
  buero: 'office building',
  burger: 'hamburger',
  chat: 'chat',
  daten: 'data database',
  datenbank: 'database',
  daumen: 'thumbs',
  diagramm: 'chart graph',
  dokument: 'document file',
  drucken: 'printer',
  drucker: 'printer',
  einkauf: 'shopping cart',
  einstellung: 'gear settings',
  energie: 'energy lightning',
  erde: 'globe earth planet',
  erfolg: 'trophy success',
  essen: 'food',
  fabrik: 'factory',
  fahrrad: 'bicycle bike',
  farbe: 'palette paint color',
  fenster: 'window',
  feuer: 'fire flame',
  film: 'film video',
  flagge: 'flag',
  flugzeug: 'airplane plane',
  foto: 'camera photo image',
  frage: 'question',
  gebaeude: 'building',
  gehirn: 'brain',
  geld: 'money currency coins',
  geschenk: 'gift',
  gesundheit: 'health medical heart',
  glocke: 'bell',
  gluehbirne: 'lightbulb',
  grafik: 'chart graph',
  haken: 'check',
  hand: 'hand',
  handy: 'cellphone mobile',
  haus: 'house home',
  herunterladen: 'download',
  herz: 'heart',
  hilfe: 'help question lifebuoy',
  hoch: 'up',
  hochladen: 'upload',
  idee: 'lightbulb idea',
  innovation: 'lightbulb innovation rocket',
  kalender: 'calendar',
  kamera: 'camera',
  karte: 'map card',
  kasse: 'cash register',
  ki: 'ai brain robot',
  kinder: 'child baby',
  kommunikation: 'chat communication',
  kopf: 'head brain',
  kopfhoerer: 'headphones headset',
  korb: 'basket',
  krankenhaus: 'hospital',
  kreis: 'circle',
  kreuz: 'x cross',
  kunde: 'customer user',
  lager: 'warehouse',
  lampe: 'lamp lightbulb',
  lautsprecher: 'speaker',
  lesezeichen: 'bookmark',
  links: 'left',
  liste: 'list',
  loeschen: 'trash',
  lupe: 'magnifying search',
  mann: 'man person',
  mensch: 'person user',
  menschen: 'people users',
  mikrofon: 'microphone',
  mond: 'moon',
  musik: 'music',
  nachhaltigkeit: 'leaf recycle sustainability',
  nachricht: 'message chat',
  netzwerk: 'network',
  notiz: 'note',
  oben: 'up',
  ordner: 'folder',
  paket: 'package box',
  papierkorb: 'trash',
  person: 'person user',
  pfeil: 'arrow',
  pflanze: 'plant',
  plan: 'plan calendar',
  pokal: 'trophy',
  preis: 'price tag',
  prozess: 'process flow',
  qualitaet: 'quality',
  rakete: 'rocket',
  rechner: 'calculator computer',
  rechts: 'right',
  regen: 'rain',
  roboter: 'robot',
  runter: 'down',
  schiff: 'boat ship',
  schild: 'shield',
  schloss: 'lock',
  schluessel: 'key',
  schnee: 'snow',
  schritt: 'step',
  schule: 'school student',
  schutz: 'shield security',
  sicherheit: 'shield lock security',
  sonne: 'sun',
  spiel: 'game',
  sprache: 'translate language',
  stadt: 'city',
  stern: 'star',
  stift: 'pen pencil',
  stopp: 'stop',
  strategie: 'strategy target',
  strom: 'plug lightning power',
  suche: 'search magnifying',
  tasse: 'coffee cup',
  team: 'team users people',
  teilen: 'share',
  telefon: 'phone',
  tier: 'animal',
  uhr: 'clock watch',
  umwelt: 'leaf environment recycle',
  unten: 'down',
  verkauf: 'sales shopping',
  vertrag: 'contract signature',
  vertrieb: 'sales',
  video: 'video',
  wachstum: 'growth trend chart',
  warnung: 'warning',
  welt: 'globe world',
  werkzeug: 'wrench tool',
  wetter: 'cloud sun weather',
  wissen: 'book brain knowledge',
  wolke: 'cloud',
  zahl: 'number',
  zahlung: 'payment',
  zahnrad: 'gear',
  zeit: 'clock time',
  ziel: 'target goal',
  zug: 'train',
};

/** What a German word may end in beyond its key: `pfeile`, `druckers`, `menschen`. */
const INFLECTION = /^(e|n|en|er|es|s)$/;

/**
 * What a word typed stands for: itself and its English, for the German it starts or inflects –
 * not for a longer word that merely starts with a key (`kinder` is not `ki`, `handy` not `hand`).
 */
function meanings(term: string): string[] {
  const out = [term];
  for (const [german, english] of Object.entries(GERMAN)) {
    if (
      german === term ||
      (term.length >= 3 && german.startsWith(term)) ||
      (german.length >= 3 && term.startsWith(german) && INFLECTION.test(term.slice(german.length)))
    )
      out.push(...english.split(' '));
  }
  return out;
}

const byLabel = new Intl.Collator('de');

/**
 * The icons for a search, best first: every word typed is in one of an icon's words (its start
 * will do), in German or English. Its own name first, then its label, then its keywords; the
 * sets' order else. Empty search: all, A–Z by label.
 */
export function searchIcons(
  icons: readonly LibraryIcon[],
  query: string,
  filter: IconFilter = 'all',
): LibraryIcon[] {
  const pool = filter === 'all' ? icons : icons.filter((icon) => icon.kind === filter);
  const terms = fold(query)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(meanings);
  // Nothing typed: A–Z, in the editor as in the library.
  if (terms.length === 0) return pool.toSorted((a, b) => byLabel.compare(a.label, b.label));
  const scored: { icon: LibraryIcon; score: number; index: number }[] = [];
  pool.forEach((icon, index) => {
    let score = 0;
    for (const options of terms) {
      let best = -1;
      for (const option of options) {
        icon.words.forEach((word, at) => {
          if (!word.startsWith(option)) return;
          // The name's words first, an exact word over a word's start.
          const value = (at < icon.named ? 2 : 1) + (word === option ? 1 : 0);
          if (value > best) best = value;
        });
      }
      if (best < 0) return;
      score += best;
    }
    scored.push({ icon, score, index });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.icon.named - b.icon.named || a.index - b.index)
    .map((entry) => entry.icon);
}

/** The icon as an SVG file's text, in `color`, `size` pixels on its longer side. */
export function iconSvg(icon: LibraryIcon, color: string, size?: number): string {
  const [, , w = 1, h = 1] = icon.viewBox.split(' ').map(Number);
  const scale = size ? size / Math.max(w, h) : 0;
  const box = size ? ` width="${Math.round(w * scale)}" height="${Math.round(h * scale)}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox}"${box} fill="${color}" color="${color}">${icon.body}</svg>`;
}
