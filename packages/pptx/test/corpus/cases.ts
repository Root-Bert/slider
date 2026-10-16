import { fileURLToPath } from 'node:url';
import {
  AGENDA_THREAD,
  asGoogleSlides,
  asPowerPointMac,
  asPowerPointOnline,
  asPowerPointWin,
  groupShapesDeck,
  hiddenSlidesDeck,
  JONAS,
  LENA,
  MIRA,
  ROADMAP_V2_PNG,
  sectionsDeck,
  SHARED_FOOTER,
  simpleDeck,
  withFooter,
} from './bases';
import {
  duplicate,
  edit,
  insertAt,
  mapSlides,
  move,
  moveSectionToEnd,
  remove,
  type CorpusCase,
  type CorpusDeck,
  type CorpusSlide,
} from './spec';

/**
 * The BER-106 test corpus: one entry per change a reviewer can make to a deck between two
 * uploads. `bun run corpus` writes `decks/<id>/v1.pptx`, `v2.pptx` and `expected.json`;
 * `corpus.test.ts` checks them. See README.md.
 */

export const CORPUS_DIR = fileURLToPath(new URL('./decks/', import.meta.url));
export const REAL_DIR = fileURLToPath(new URL('./real/', import.meta.url));

const NEW_SLIDE: CorpusSlide = {
  label: 'neu',
  title: 'Executive Summary',
  body: ['Atlas startet im Mittelstand', 'Erste Pilotkunden ab Februar'],
};

const ZIELE_V2 = [
  'Neukunden im Mittelstand und in Agenturen gewinnen',
  'Onboarding unter fünf Minuten',
  'Churn halbieren',
];

const withComments = (deck: CorpusDeck, label: string, comments: CorpusSlide['comments']) =>
  edit(deck, label, { comments });

/** History of slide parts for the producer cases: not the same as the slide order. */
const PART_ORDER = ['agenda', 'kickoff', 'ziele', 'budget', 'zeitplan'];

/** v1 of every producer case: the simple deck with one open thread. */
const producerV1 = (): CorpusDeck => withComments(simpleDeck(), 'agenda', [AGENDA_THREAD]);

/** v2 of every producer case: goals edited, thread answered and resolved, a new comment. */
const producerV2 = (): CorpusDeck =>
  withComments(edit(simpleDeck(), 'ziele', { body: ZIELE_V2 }), 'agenda', [
    {
      ...AGENDA_THREAD,
      status: 'resolved',
      replies: [
        ...(AGENDA_THREAD.replies ?? []),
        { author: LENA, text: 'Danke, passt so.', created: '2026-10-02T07:30:00.000Z' },
      ],
    },
    { author: MIRA, text: 'Sind die Zahlen final?', created: '2026-10-02T10:00:00.000Z' },
  ]);

const SYNTHETIC_GOOGLE =
  'Imitiert einen Download aus Google Slides (Datei → Herunterladen → .pptx). Google Slides lässt ' +
  'sich in CI nicht fernsteuern; die Eigenheiten (sldIds ab 256 neu nummeriert, Teile/rIds nach ' +
  'Position, kein p14:creationId, keine Abschnitte und Kommentare, Layoutnamen TITLE / ' +
  'TITLE_AND_BODY, eigene Shape-Ids, explizite Platzhalter-Boxen, app.xml ohne Application) sind ' +
  'nachgebaut, nicht an echten Dateien verifiziert.';

const synthetic = (producer: string) =>
  `Imitiert eine mit ${producer} gespeicherte Datei (app.xml, core.xml, p14:creationId, ` +
  'Kommentarformat und Autorenkonten). Die App lässt sich in CI nicht fernsteuern; die Werte ' +
  'sind plausibel nachgebaut, nicht an echten Dateien verifiziert.';

export const CASES: CorpusCase[] = [
  // ── Basis decks: nothing changed ──────────────────────────────────────────
  {
    id: 'basis-simple',
    title: 'Basis: einfaches Deck',
    description: 'Fünf Folien (Titel, Text, Bild, Tabelle), v2 identisch.',
    tags: ['basis'],
    v1: simpleDeck(),
    v2: simpleDeck(),
  },
  {
    id: 'basis-hidden',
    title: 'Basis: ausgeblendete Folien',
    description: 'Zwei von fünf Folien ausgeblendet (Mitte und Ende), v2 identisch.',
    tags: ['basis', 'visibility'],
    v1: hiddenSlidesDeck(),
    v2: hiddenSlidesDeck(),
  },
  {
    id: 'basis-groups',
    title: 'Basis: Gruppen',
    description: 'Gruppierte und verschachtelt gruppierte Formen, v2 identisch.',
    tags: ['basis'],
    v1: groupShapesDeck(),
    v2: groupShapesDeck(),
  },
  {
    id: 'basis-sections',
    title: 'Basis: Abschnitte',
    description: 'Sieben Folien in drei Abschnitten, v2 identisch.',
    tags: ['basis'],
    v1: sectionsDeck(),
    v2: sectionsDeck(),
  },

  // ── Structure ─────────────────────────────────────────────────────────────
  {
    id: 'insert-start',
    title: 'Folie am Anfang eingefügt',
    description: 'Neue Folie vor der Titelfolie; alle anderen rutschen eine Position nach hinten.',
    tags: ['structure'],
    v1: simpleDeck(),
    v2: insertAt(simpleDeck(), 0, NEW_SLIDE),
  },
  {
    id: 'insert-start-slide-numbers',
    title: 'Folie am Anfang eingefügt, mit Foliennummern und Datum',
    description:
      'Wie insert-start, aber mit Kopf- und Fußzeile (Foliennummer, automatisches Datum). ' +
      'PowerPoint schreibt beim Speichern jede Foliennummer und das Datum neu; die Folien ' +
      'selbst sind unverändert.',
    tags: ['structure', 'content'],
    v1: withFooter(simpleDeck(), { date: '16.10.2026', slideNumbers: true }),
    v2: withFooter(insertAt(simpleDeck(), 0, NEW_SLIDE), {
      date: '17.10.2026',
      slideNumbers: true,
    }),
  },
  {
    id: 'insert-middle',
    title: 'Folie in der Mitte eingefügt',
    description: 'Neue Folie an Position 3.',
    tags: ['structure'],
    v1: simpleDeck(),
    v2: insertAt(simpleDeck(), 2, NEW_SLIDE),
  },
  {
    id: 'insert-end',
    title: 'Folie am Ende eingefügt',
    description: 'Neue Folie nach der letzten.',
    tags: ['structure'],
    v1: simpleDeck(),
    v2: insertAt(simpleDeck(), 5, NEW_SLIDE),
  },
  {
    id: 'delete-middle',
    title: 'Folie gelöscht',
    description: 'Die Zielefolie (Position 3) ist in v2 nicht mehr da.',
    tags: ['structure'],
    v1: simpleDeck(),
    v2: remove(simpleDeck(), 'ziele'),
  },
  {
    id: 'move-slide',
    title: 'Folie verschoben',
    description: 'Die Budgetfolie wandert vom Ende an Position 3.',
    tags: ['structure'],
    v1: simpleDeck(),
    v2: move(simpleDeck(), 'budget', 2),
  },
  {
    id: 'move-section',
    title: 'Abschnitt verschoben',
    description: 'Der Abschnitt „Analyse“ (drei Folien) wandert ans Ende, hinter „Abschluss“.',
    tags: ['structure'],
    v1: sectionsDeck(),
    v2: moveSectionToEnd(sectionsDeck(), 'Analyse'),
  },
  {
    id: 'duplicate',
    title: 'Folie dupliziert',
    description: 'PowerPoint „Folie duplizieren“: identische Kopie direkt dahinter, neue sldId.',
    tags: ['structure'],
    v1: simpleDeck(),
    v2: duplicate(simpleDeck(), 'ziele', 'ziele-kopie'),
  },
  {
    id: 'reuse-slides',
    title: 'Folie aus anderem Deck wiederverwendet',
    description:
      '„Folien wiederverwenden → Ursprungsformat beibehalten“: eine Budgetfolie aus einem ' +
      'anderen Deck (gleicher Titel, anderer Inhalt) mit eigenem Master und Layout ' +
      '„1_Title and Content“ vor der vorhandenen Budgetfolie.',
    tags: ['structure'],
    v1: simpleDeck(),
    v2: insertAt(simpleDeck(), 4, {
      label: 'fremd-budget',
      title: 'Budget',
      body: ['Budget Vertrieb 2027', 'Plan 1,2 Mio. €', 'Freigabe durch die Geschäftsführung'],
      foreignLayout: '1_Title and Content',
    }),
  },

  // ── Content ───────────────────────────────────────────────────────────────
  {
    id: 'text-changed',
    title: 'Text geändert',
    description: 'Zwei der drei Ziele umformuliert.',
    tags: ['content'],
    v1: simpleDeck(),
    v2: edit(simpleDeck(), 'ziele', { body: ZIELE_V2 }),
  },
  {
    id: 'image-swapped',
    title: 'Bild getauscht',
    description: 'Das Roadmap-Bild ist ersetzt (gleiche Größe und Position, andere Pixel).',
    tags: ['content'],
    v1: simpleDeck(),
    v2: edit(simpleDeck(), 'zeitplan', {
      shapes: [
        {
          type: 'picture',
          name: 'Roadmap',
          box: { x: 6_400_000, y: 1_825_625, w: 4_953_800, h: 2_786_513 },
          png: ROADMAP_V2_PNG,
        },
      ],
    }),
  },
  {
    id: 'layout-changed',
    title: 'Layout geändert',
    description: 'Die Agenda wechselt von „Title and Content“ auf „Title Slide“, Text gleich.',
    tags: ['content'],
    v1: simpleDeck(),
    v2: edit(simpleDeck(), 'agenda', { layout: 'title' }),
  },
  {
    id: 'groups-text-changed',
    title: 'Text in verschachtelter Gruppe geändert',
    description: 'Im Organigramm heißt „Vertrieb“ jetzt „Sales“ (Gruppe in Gruppe).',
    tags: ['content'],
    v1: groupShapesDeck(),
    v2: (() => {
      const deck = groupShapesDeck();
      const json = JSON.stringify(deck.slides[2]).replace('"Vertrieb"', '"Sales"');
      return edit(deck, 'organigramm', { shapes: (JSON.parse(json) as CorpusSlide).shapes });
    })(),
  },

  // ── Visibility ────────────────────────────────────────────────────────────
  {
    id: 'hide',
    title: 'Folie ausgeblendet',
    description: 'Die Zeitplanfolie wird ausgeblendet (show="0"), sonst nichts.',
    tags: ['visibility'],
    v1: simpleDeck(),
    v2: edit(simpleDeck(), 'zeitplan', { hidden: true }),
  },
  {
    id: 'unhide',
    title: 'Folie eingeblendet',
    description: 'Die ausgeblendete Reservefolie wird wieder eingeblendet.',
    tags: ['visibility'],
    v1: hiddenSlidesDeck(),
    v2: edit(hiddenSlidesDeck(), 'reserve', { hidden: false }),
  },

  // ── Comments ──────────────────────────────────────────────────────────────
  {
    id: 'comments-modern',
    title: 'Moderne Kommentare hinzugefügt',
    description:
      'Drei moderne Kommentare (an einer Form, an einem Punkt, an der Folie) auf drei Folien.',
    tags: ['comments'],
    v1: simpleDeck(),
    v2: withComments(
      withComments(
        withComments(simpleDeck(), 'agenda', [
          { author: LENA, text: 'Reihenfolge passt nicht.', shapeId: 3 },
        ]),
        'ziele',
        [{ author: JONAS, text: 'Zahl belegen?', position: { x: 2_000_000, y: 2_500_000 } }],
      ),
      'budget',
      [{ author: MIRA, text: 'Bitte mit Controlling abstimmen.' }],
    ),
  },
  {
    id: 'comments-legacy',
    title: 'Klassische Kommentare hinzugefügt',
    description: 'Klassische Kommentare (p:cmLst, commentAuthors.xml) von zwei Personen.',
    tags: ['comments'],
    v1: simpleDeck(),
    v2: edit(
      edit(simpleDeck(), 'agenda', {
        legacyComments: [
          { author: LENA, text: 'Reihenfolge passt nicht.', position: { x: 120, y: 200 } },
        ],
      }),
      'budget',
      {
        legacyComments: [
          { author: JONAS, text: 'Ist-Zahlen vom September?', position: { x: 400, y: 260 } },
          { author: LENA, text: 'Marketing unterplant.', position: { x: 400, y: 320 } },
        ],
      },
    ),
  },
  {
    id: 'comments-threads',
    title: 'Antworten auf einen Kommentar',
    description: 'Ein moderner Kommentar mit einer Antwort bekommt zwei weitere Antworten.',
    tags: ['comments'],
    v1: producerV1(),
    v2: withComments(simpleDeck(), 'agenda', [
      {
        ...AGENDA_THREAD,
        replies: [
          ...(AGENDA_THREAD.replies ?? []),
          { author: MIRA, text: 'Und Ressourcen ans Ende?', created: '2026-10-01T10:00:00.000Z' },
          { author: JONAS, text: 'Ja, beides umgestellt.', created: '2026-10-01T11:00:00.000Z' },
        ],
      },
    ]),
  },
  {
    id: 'comments-legacy-threads',
    title: 'Antworten auf klassische Kommentare',
    description:
      'Klassische Kommentare mit Antworten (p15:threadingInfo/p15:parentCm), wie PowerPoint ' +
      '2013–2019 sie schrieb.',
    tags: ['comments'],
    v1: simpleDeck(),
    v2: edit(simpleDeck(), 'agenda', {
      legacyComments: [
        { author: LENA, text: 'Budget nach vorn?', position: { x: 120, y: 200 } },
        { author: JONAS, text: 'Ja, mache ich.', position: { x: 120, y: 200 }, replyTo: 0 },
        { author: LENA, text: 'Danke!', position: { x: 120, y: 200 }, replyTo: 0 },
      ],
    }),
  },
  {
    id: 'comments-resolved',
    title: 'Kommentare erledigt',
    description:
      'Von drei offenen Kommentaren wird einer erledigt (resolved), einer geschlossen (closed), ' +
      'einer bleibt offen.',
    tags: ['comments'],
    v1: withComments(simpleDeck(), 'budget', [
      { author: LENA, text: 'Personal zu hoch?', created: '2026-10-01T08:00:00.000Z' },
      { author: JONAS, text: 'Quelle fehlt.', created: '2026-10-01T08:10:00.000Z' },
      { author: MIRA, text: 'Marketing prüfen.', created: '2026-10-01T08:20:00.000Z' },
    ]),
    v2: withComments(simpleDeck(), 'budget', [
      {
        author: LENA,
        text: 'Personal zu hoch?',
        created: '2026-10-01T08:00:00.000Z',
        status: 'resolved',
      },
      {
        author: JONAS,
        text: 'Quelle fehlt.',
        created: '2026-10-01T08:10:00.000Z',
        status: 'closed',
      },
      { author: MIRA, text: 'Marketing prüfen.', created: '2026-10-01T08:20:00.000Z' },
    ]),
  },
  {
    id: 'comments-moved-slide',
    title: 'Kommentierte Folie verschoben',
    description:
      'Die Agenda mit offenem Thread wandert ans Ende; der Kommentar hängt weiter an ihrer sldId.',
    tags: ['comments', 'structure'],
    v1: producerV1(),
    v2: move(producerV1(), 'agenda', 4),
  },

  // ── Google Slides (synthetic) ─────────────────────────────────────────────
  {
    id: 'google-roundtrip',
    title: 'Google Slides: Hin und zurück',
    description:
      'Ein PowerPoint-Deck mit Abschnitten, Kommentaren und gewachsenen sldIds wird in Google ' +
      'Slides geöffnet und unverändert als .pptx heruntergeladen.',
    tags: ['producer', 'synthetic'],
    synthetic: SYNTHETIC_GOOGLE,
    v1: (() => {
      const ids = [256, 259, 262, 263, 270, 271, 274];
      const deck = mapSlides(sectionsDeck(), (_, index) => ({ sldId: ids[index] }));
      return asPowerPointWin(withComments(deck, 'markt', [AGENDA_THREAD]), [
        'titel',
        'markt',
        'agenda',
        'kunden',
        'wettbewerb',
        'fragen',
        'fazit',
      ]);
    })(),
    // Google renumbers the ids anyway, so the source ids do not matter here.
    v2: asGoogleSlides(sectionsDeck()),
  },
  {
    id: 'google-insert',
    title: 'Google Slides: Folie eingefügt',
    description:
      'Beide Versionen aus Google Slides; in v2 steht eine neue Folie am Anfang. Google ' +
      'nummeriert die sldIds neu, also zeigt jede alte sldId jetzt auf eine andere Folie.',
    tags: ['producer', 'synthetic', 'structure'],
    synthetic: SYNTHETIC_GOOGLE,
    v1: asGoogleSlides(simpleDeck()),
    v2: asGoogleSlides(insertAt(simpleDeck(), 0, NEW_SLIDE)),
  },
  {
    id: 'google-move',
    title: 'Google Slides: Folie verschoben',
    description:
      'Beide Versionen aus Google Slides; die Budgetfolie wandert an Position 2. Die sldIds ' +
      'folgen der Position, nicht der Folie.',
    tags: ['producer', 'synthetic', 'structure'],
    synthetic: SYNTHETIC_GOOGLE,
    v1: asGoogleSlides(simpleDeck()),
    v2: asGoogleSlides(move(simpleDeck(), 'budget', 1)),
  },
  {
    id: 'google-hidden',
    title: 'Google Slides: übersprungene Folien',
    description:
      'Deck mit ausgeblendeten Folien aus Google Slides („Folie überspringen“); in v2 ist die ' +
      'Reservefolie wieder eingeblendet.',
    tags: ['producer', 'synthetic', 'visibility'],
    synthetic: SYNTHETIC_GOOGLE,
    v1: asGoogleSlides(hiddenSlidesDeck()),
    v2: asGoogleSlides(edit(hiddenSlidesDeck(), 'reserve', { hidden: false })),
  },

  // ── PowerPoint producers (synthetic) ──────────────────────────────────────
  {
    id: 'producer-win',
    title: 'PowerPoint für Windows',
    description:
      'Beide Versionen aus PowerPoint 365 für Windows: Ziele umformuliert, Thread beantwortet ' +
      'und erledigt, neuer Kommentar eines persönlichen Kontos.',
    tags: ['producer', 'synthetic', 'comments'],
    synthetic: synthetic('PowerPoint 365 für Windows'),
    v1: asPowerPointWin(producerV1(), PART_ORDER),
    v2: asPowerPointWin(producerV2(), PART_ORDER),
  },
  {
    id: 'producer-mac',
    title: 'PowerPoint für Mac',
    description:
      'Dieselbe Änderung aus PowerPoint 2019 für Mac: klassische Kommentare mit Antworten als ' +
      'Threading-Info, kein Erledigt-Status.',
    tags: ['producer', 'synthetic', 'comments'],
    synthetic: synthetic('PowerPoint 2019 für Mac'),
    v1: asPowerPointMac(producerV1(), PART_ORDER),
    v2: asPowerPointMac(producerV2(), PART_ORDER),
  },
  {
    id: 'producer-online',
    title: 'PowerPoint im Web',
    description: 'Dieselbe Änderung aus PowerPoint im Web: schlanke app.xml, Arbeitskonten.',
    tags: ['producer', 'synthetic', 'comments'],
    synthetic: synthetic('PowerPoint im Web'),
    v1: asPowerPointOnline(producerV1(), PART_ORDER),
    v2: asPowerPointOnline(producerV2(), PART_ORDER),
  },
  {
    id: 'producer-win-to-online',
    title: 'Windows → Web, ohne Änderung',
    description:
      'v1 aus PowerPoint für Windows, v2 unverändert in PowerPoint im Web gespeichert: nur ' +
      'app.xml und core.xml unterscheiden sich.',
    tags: ['producer', 'synthetic'],
    synthetic: synthetic('PowerPoint für Windows und im Web'),
    v1: asPowerPointWin(producerV1(), PART_ORDER),
    v2: asPowerPointOnline(producerV1(), PART_ORDER),
  },
  {
    id: 'producer-win-move',
    title: 'PowerPoint für Windows: Folie verschoben',
    description:
      'Budgetfolie an Position 2; Teilenamen (slideN.xml), rIds und creationIds bleiben an der ' +
      'Folie, nur die Reihenfolge in p:sldIdLst ändert sich.',
    tags: ['producer', 'synthetic', 'structure'],
    synthetic: synthetic('PowerPoint 365 für Windows'),
    v1: asPowerPointWin(simpleDeck(), PART_ORDER),
    v2: asPowerPointWin(move(simpleDeck(), 'budget', 1), PART_ORDER),
  },
  // ── sldId edge cases (review round 1) ─────────────────────────────────────
  {
    id: 'rewrite-most-slides',
    title: 'Fast alle Folien neu formuliert',
    description:
      'v2 ist eine Übersetzung: vier von fünf Folien haben neue Texte (kaum gemeinsame Wörter), ' +
      'die sldIds bleiben. Jede Folie muss über ihre sldId gefunden werden.',
    tags: ['content'],
    v1: simpleDeck(),
    v2: [
      (d: CorpusDeck) =>
        edit(d, 'kickoff', { title: 'Project Atlas', body: 'Kick-off · product team · October' }),
      (d: CorpusDeck) =>
        edit(d, 'agenda', {
          title: 'Overview',
          body: ['Starting point and goals', 'Timeline and milestones', 'Money and people'],
        }),
      (d: CorpusDeck) =>
        edit(d, 'ziele', {
          title: 'Goals for next year',
          body: ['Win new mid-sized customers', 'Onboarding in under ten minutes', 'Halve churn'],
        }),
      (d: CorpusDeck) =>
        edit(d, 'zeitplan', { title: 'Timeline', body: ['Discovery', 'Beta', 'Launch'] }),
    ].reduce((deck, step) => step(deck), simpleDeck()),
  },
  {
    id: 'ppt-delete-last-insert',
    title: 'PowerPoint: letzte Folie gelöscht, neue eingefügt',
    description:
      'Die Budgetfolie (höchste sldId 260) wird gelöscht und eine neue Folie eingefügt. ' +
      'PowerPoint vergibt max + 1, also wieder 260 – die neue p14:creationId verrät, dass es ' +
      'eine andere Folie ist.',
    tags: ['producer', 'synthetic', 'structure'],
    synthetic: synthetic('PowerPoint 365 für Windows'),
    v1: asPowerPointWin(simpleDeck(), PART_ORDER),
    v2: asPowerPointWin(insertAt(remove(simpleDeck(), 'budget'), 4, NEW_SLIDE), PART_ORDER),
  },
  {
    id: 'google-insert-late',
    title: 'Google Slides: Folie spät eingefügt',
    description:
      'Beide Versionen aus Google Slides; die neue Folie steht an Position 4 von 6. Die ' +
      'sldIds der letzten beiden Folien zeigen jetzt auf ihre Vorgänger.',
    tags: ['producer', 'synthetic', 'structure'],
    synthetic: SYNTHETIC_GOOGLE,
    v1: asGoogleSlides(simpleDeck()),
    v2: asGoogleSlides(insertAt(simpleDeck(), 3, NEW_SLIDE)),
  },
  {
    id: 'google-delete-late',
    title: 'Google Slides: Folie spät gelöscht',
    description:
      'Beide Versionen aus Google Slides; die vierte von fünf Folien ist gelöscht, die ' +
      'Budgetfolie rückt auf deren sldId.',
    tags: ['producer', 'synthetic', 'structure'],
    synthetic: SYNTHETIC_GOOGLE,
    v1: asGoogleSlides(simpleDeck()),
    v2: asGoogleSlides(remove(simpleDeck(), 'zeitplan')),
  },
  {
    id: 'google-insert-footer',
    title: 'Google Slides: Folie eingefügt, gemeinsame Fußzeile',
    description:
      'Wie google-insert, aber alle Folien tragen dieselbe Fußzeile. Der gemeinsame Text macht ' +
      'benachbarte Folien ähnlich genug, dass die verschobenen sldIds plausibel wirken.',
    tags: ['producer', 'synthetic', 'structure'],
    synthetic: SYNTHETIC_GOOGLE,
    v1: asGoogleSlides(withFooter(simpleDeck(), { text: SHARED_FOOTER })),
    v2: asGoogleSlides(withFooter(insertAt(simpleDeck(), 1, NEW_SLIDE), { text: SHARED_FOOTER })),
  },
  {
    id: 'google-delete-footer',
    title: 'Google Slides: Folie gelöscht, gemeinsame Fußzeile',
    description:
      'Beide Versionen aus Google Slides mit derselben Fußzeile auf jeder Folie; die Agenda ist ' +
      'gelöscht, jede spätere Folie rückt auf die sldId ihres Vorgängers.',
    tags: ['producer', 'synthetic', 'structure'],
    synthetic: SYNTHETIC_GOOGLE,
    v1: asGoogleSlides(withFooter(simpleDeck(), { text: SHARED_FOOTER })),
    v2: asGoogleSlides(withFooter(remove(simpleDeck(), 'agenda'), { text: SHARED_FOOTER })),
  },
  {
    id: 'google-move-footer',
    title: 'Google Slides: Folie verschoben, gemeinsame Fußzeile',
    description:
      'Wie google-move, aber alle Folien tragen dieselbe Fußzeile; die Budgetfolie wandert an ' +
      'Position 2.',
    tags: ['producer', 'synthetic', 'structure'],
    synthetic: SYNTHETIC_GOOGLE,
    v1: asGoogleSlides(withFooter(simpleDeck(), { text: SHARED_FOOTER })),
    v2: asGoogleSlides(withFooter(move(simpleDeck(), 'budget', 1), { text: SHARED_FOOTER })),
  },
];
