import type { LegacyCommentSpec, ModernCommentSpec } from '../fixtures/build-pptx';
import { createPng } from '../fixtures/png';
import { mapSlides, stableId, type CorpusDeck, type CorpusSlide } from './spec';

/**
 * Basis decks of the corpus (BER-106) and the producer transforms that imitate what Google
 * Slides and PowerPoint for Windows, Mac and the web write. All slides have explicit sldIds, so
 * inserts and moves never shift the ids of other slides by accident.
 */

// ── Images ──────────────────────────────────────────────────────────────────

/** Blue gradient "roadmap" picture. */
export const ROADMAP_PNG = createPng(64, 36, (x, y) =>
  Math.abs(y - 24) < 2 ? [255, 255, 255] : [37 + x, 99, 235],
);
/** Same size, green gradient: the picture swapped in by `image-swapped`. */
export const ROADMAP_V2_PNG = createPng(64, 36, (x, y) =>
  Math.abs(y - 12) < 2 ? [255, 255, 255] : [16, 120 + x, 90],
);

const PICTURE_BOX = { x: 6_400_000, y: 1_825_625, w: 4_953_800, h: 2_786_513 };
const TABLE_BOX = { x: 838_200, y: 1_825_625, w: 10_515_600, h: 2_286_000 };

// ── Basis decks ─────────────────────────────────────────────────────────────

/** Five plain slides: title, agenda, goals, timeline (with a picture), budget (table). */
export function simpleDeck(): CorpusDeck {
  return {
    title: 'Projekt Atlas',
    slides: [
      {
        label: 'kickoff',
        sldId: 256,
        layout: 'title',
        title: 'Projekt Atlas',
        body: 'Kickoff · Produktteam · Oktober 2026',
      },
      {
        label: 'agenda',
        sldId: 257,
        title: 'Agenda',
        body: ['Ausgangslage und Ziele', 'Zeitplan und Meilensteine', 'Budget und Ressourcen'],
      },
      {
        label: 'ziele',
        sldId: 258,
        title: 'Ziele 2027',
        body: [
          'Neukunden im Mittelstand gewinnen',
          'Onboarding unter zehn Minuten',
          'Churn halbieren',
        ],
      },
      {
        label: 'zeitplan',
        sldId: 259,
        title: 'Zeitplan',
        body: ['Q1 Discovery', 'Q2 Beta', 'Q3 Launch'],
        shapes: [{ type: 'picture', name: 'Roadmap', box: PICTURE_BOX, png: ROADMAP_PNG }],
      },
      {
        label: 'budget',
        sldId: 260,
        title: 'Budget',
        shapes: [
          {
            type: 'table',
            name: 'Tabelle Budget',
            box: TABLE_BOX,
            rows: [
              ['Posten', 'Plan (T€)', 'Ist (T€)'],
              ['Personal', '480', '455'],
              ['Infrastruktur', '120', '131'],
              ['Marketing', '90', '64'],
            ],
          },
        ],
      },
    ],
  };
}

/** The same footer line on every slide, as corporate templates have it. */
export const SHARED_FOOTER =
  'Vertraulich · Projekt Atlas · Muster AG · Strategieworkshop Oktober 2026';

/**
 * Header & Footer on every slide: optional footer text and date, and the slide number – each
 * slide's cached field value is its position, as PowerPoint rewrites it on save.
 */
export function withFooter(
  deck: CorpusDeck,
  footer: { text?: string; date?: string; slideNumbers?: boolean },
): CorpusDeck {
  return mapSlides(deck, (_, index) => ({
    footer: {
      ...(footer.text !== undefined && { text: footer.text }),
      ...(footer.date !== undefined && { date: footer.date }),
      ...(footer.slideNumbers && { slideNumber: String(index + 1) }),
    },
  }));
}

/** Five slides, two hidden (one in the middle, one at the end). */
export function hiddenSlidesDeck(): CorpusDeck {
  return {
    title: 'Quartalsbericht Q3',
    slides: [
      {
        label: 'titel',
        sldId: 256,
        layout: 'title',
        title: 'Quartalsbericht Q3',
        body: 'Finanzen · Vorstand',
      },
      {
        label: 'umsatz',
        sldId: 257,
        title: 'Umsatz',
        body: ['Umsatz 23,2 Mio. €', 'Plus elf Prozent zum Vorjahr'],
      },
      {
        label: 'reserve',
        sldId: 258,
        hidden: true,
        title: 'Reserve: Detailzahlen',
        body: ['Umsatz nach Monat', 'Umsatz nach Produktlinie'],
      },
      {
        label: 'ausblick',
        sldId: 259,
        title: 'Ausblick Q4',
        body: ['Preiserhöhung zum 1. Januar', 'Zwei neue Vertriebsregionen'],
      },
      {
        label: 'anhang',
        sldId: 260,
        hidden: true,
        title: 'Anhang: Methodik',
        body: ['Datenquellen', 'Abgrenzung der Segmente'],
      },
    ],
  };
}

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

/** Four slides with group shapes, one of them nested. */
export function groupShapesDeck(): CorpusDeck {
  return {
    title: 'Prozesse',
    slides: [
      { label: 'titel', sldId: 256, layout: 'title', title: 'Prozesse', body: 'Wie wir arbeiten' },
      {
        label: 'prozess',
        sldId: 257,
        title: 'Freigabeprozess',
        shapes: [
          {
            type: 'group',
            name: 'Prozesskette',
            box: box(838_200, 2_400_000, 10_515_600, 1_200_000),
            childBox: box(0, 0, 3_000, 1_000),
            shapes: [
              { type: 'rect', box: box(0, 0, 900, 1_000), fill: '2563EB', text: 'Entwurf' },
              { type: 'rect', box: box(1_050, 0, 900, 1_000), fill: '0EA5E9', text: 'Review' },
              { type: 'rect', box: box(2_100, 0, 900, 1_000), fill: '10B981', text: 'Freigabe' },
            ],
          },
        ],
      },
      {
        label: 'organigramm',
        sldId: 258,
        title: 'Organigramm',
        shapes: [
          {
            type: 'group',
            name: 'Organigramm',
            box: box(1_524_000, 1_825_625, 9_144_000, 4_000_000),
            childBox: box(0, 0, 9_144_000, 4_000_000),
            shapes: [
              {
                type: 'rect',
                box: box(3_572_000, 0, 2_000_000, 900_000),
                fill: '0F172A',
                text: 'Leitung',
              },
              {
                type: 'group',
                name: 'Teams',
                box: box(0, 1_800_000, 9_144_000, 900_000),
                childBox: box(0, 0, 9_144, 900),
                shapes: [
                  { type: 'rect', box: box(0, 0, 2_800, 900), fill: '8B5CF6', text: 'Produkt' },
                  { type: 'rect', box: box(3_172, 0, 2_800, 900), fill: 'F59E0B', text: 'Technik' },
                  {
                    type: 'rect',
                    box: box(6_344, 0, 2_800, 900),
                    fill: 'EF4444',
                    text: 'Vertrieb',
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        label: 'fazit',
        sldId: 259,
        title: 'Fazit',
        body: ['Weniger Schleifen', 'Klare Verantwortung'],
      },
    ],
  };
}

/** Seven slides in three sections. */
export function sectionsDeck(): CorpusDeck {
  return {
    title: 'Marktanalyse 2026',
    sections: [
      { name: 'Einleitung', labels: ['titel', 'agenda'] },
      { name: 'Analyse', labels: ['markt', 'wettbewerb', 'kunden'] },
      { name: 'Abschluss', labels: ['fazit', 'fragen'] },
    ],
    slides: [
      {
        label: 'titel',
        sldId: 256,
        layout: 'title',
        title: 'Marktanalyse 2026',
        body: 'Strategie',
      },
      {
        label: 'agenda',
        sldId: 257,
        title: 'Agenda',
        body: ['Markt', 'Wettbewerb', 'Kunden', 'Fazit'],
      },
      {
        label: 'markt',
        sldId: 258,
        title: 'Marktgröße',
        body: ['Gesamtmarkt 1,8 Mrd. €', 'Wachstum sieben Prozent pro Jahr'],
      },
      {
        label: 'wettbewerb',
        sldId: 259,
        title: 'Wettbewerb',
        body: ['Drei große Anbieter', 'Viele Nischenanbieter im Mittelstand'],
      },
      {
        label: 'kunden',
        sldId: 260,
        title: 'Kundensegmente',
        body: ['Agenturen', 'Beratungen', 'Interne Kommunikation'],
      },
      {
        label: 'fazit',
        sldId: 261,
        title: 'Fazit',
        body: ['Fokus auf Beratungen', 'Partnerprogramm starten'],
      },
      { label: 'fragen', sldId: 262, title: 'Fragen?', body: 'Danke für die Aufmerksamkeit' },
    ],
  };
}

// ── Comments ────────────────────────────────────────────────────────────────

export const LENA = 'Lena Hoffmann';
export const JONAS = 'Jonas Weber';
export const MIRA = 'Mira Schulz';

/** One open comment on the agenda body with a reply – the thread most cases start from. */
export const AGENDA_THREAD: ModernCommentSpec = {
  author: LENA,
  text: 'Budget bitte vor den Zeitplan ziehen.',
  created: '2026-10-01T08:00:00.000Z',
  shapeId: 3,
  replies: [{ author: JONAS, text: 'Mache ich.', created: '2026-10-01T09:15:00.000Z' }],
};

// ── Producers (synthetic) ───────────────────────────────────────────────────

/**
 * Work accounts as PowerPoint 365 writes them (`providerId="AD"`, `userId="S::<upn>::<oid>"`).
 * The object ids are made up.
 */
export const AD_ACCOUNTS: Record<string, { userId: string; providerId: string }> = {
  [LENA]: {
    userId: 'S::lena.hoffmann@contoso.de::6f1e2d3c-4b5a-4968-8776-655443322110',
    providerId: 'AD',
  },
  [JONAS]: {
    userId: 'S::jonas.weber@contoso.de::0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d',
    providerId: 'AD',
  },
  [MIRA]: { userId: '8f2c4e6a1b3d5f70', providerId: 'Windows Live' },
};

/**
 * Stable part numbers as if the deck had a history: the part number follows the label's place
 * in `partOrder` (new labels go after it), not the position.
 */
function partNumbers(deck: CorpusDeck, partOrder: string[]): CorpusDeck {
  const order = [...partOrder];
  return mapSlides(deck, (slide) => {
    if (!order.includes(slide.label)) order.push(slide.label);
    return { partNumber: order.indexOf(slide.label) + 1 };
  });
}

const POWERPOINT_CORE = { creator: LENA, lastModifiedBy: JONAS, revision: 7 };

/**
 * PowerPoint for Windows (Microsoft 365): `p14:creationId` on every slide, modern comments by
 * work accounts, app.xml with AppVersion 16.0000 and TotalTime.
 */
export function asPowerPointWin(deck: CorpusDeck, partOrder: string[]): CorpusDeck {
  return {
    ...partNumbers(
      mapSlides(deck, (slide) => ({ creationId: stableId(slide.label) })),
      partOrder,
    ),
    app: {
      totalTime: 42,
      application: 'Microsoft Office PowerPoint',
      presentationFormat: 'Breitbild',
      company: 'Contoso GmbH',
      appVersion: '16.0000',
    },
    core: POWERPOINT_CORE,
    authorAccounts: AD_ACCOUNTS,
  };
}

/** Modern comments → legacy `p:cm` (replies as `p15:threadingInfo` children; no status). */
function toLegacy(comments: ModernCommentSpec[] | undefined): LegacyCommentSpec[] | undefined {
  if (!comments?.length) return undefined;
  const legacy: LegacyCommentSpec[] = [];
  comments.forEach((comment, index) => {
    const position = { x: 100 + index * 40, y: 80 };
    const parent = legacy.length;
    legacy.push({ author: comment.author, text: comment.text, created: comment.created, position });
    for (const reply of comment.replies ?? []) {
      legacy.push({ ...reply, position, replyTo: parent });
    }
  });
  return legacy;
}

/**
 * PowerPoint 2019 for Mac: `Microsoft Macintosh PowerPoint`, creationIds, and legacy comments –
 * that build predates modern comments, so threads become flat `p:cm` with threading info and a
 * resolved state cannot be saved at all.
 */
export function asPowerPointMac(deck: CorpusDeck, partOrder: string[]): CorpusDeck {
  return {
    ...partNumbers(
      mapSlides(deck, (slide) => ({
        creationId: stableId(slide.label),
        comments: undefined,
        legacyComments: toLegacy(slide.comments) ?? slide.legacyComments,
      })),
      partOrder,
    ),
    app: {
      totalTime: 17,
      application: 'Microsoft Macintosh PowerPoint',
      presentationFormat: 'Breitbild',
      appVersion: '16.0000',
    },
    core: POWERPOINT_CORE,
  };
}

/**
 * PowerPoint for the web: modern comments by work accounts, a sparse app.xml (no TotalTime,
 * Company or PresentationFormat), lastModifiedBy set to the signed-in account.
 */
export function asPowerPointOnline(deck: CorpusDeck, partOrder: string[]): CorpusDeck {
  return {
    ...partNumbers(
      mapSlides(deck, (slide) => ({ creationId: stableId(slide.label) })),
      partOrder,
    ),
    app: { application: 'Microsoft Office PowerPoint', appVersion: '16.0000' },
    core: { creator: LENA, lastModifiedBy: MIRA, revision: 9 },
    authorAccounts: AD_ACCOUNTS,
  };
}

/**
 * A pptx downloaded from Google Slides, as far as we can imitate it: sldIds renumbered from 256
 * in the current order, slide parts and rIds renamed by position, no `p14:creationId`, no
 * sections, no PowerPoint comments, Google's layout names, Google-style shape ids and explicit
 * placeholder boxes, and an app.xml without an Office application. Hidden slides stay hidden.
 */
export function asGoogleSlides(deck: CorpusDeck): CorpusDeck {
  const slides = deck.slides.map((slide, index): CorpusSlide => ({
    ...slide,
    sldId: 256 + index,
    partNumber: undefined,
    creationId: undefined,
    comments: undefined,
    legacyComments: undefined,
    firstShapeId: 54 + index * 10,
    explicitPlaceholderBoxes: true,
  }));
  return {
    title: deck.title,
    size: deck.size,
    slides,
    layoutNames: { title: 'TITLE', content: 'TITLE_AND_BODY' },
    app: {},
    core: { creator: '', revision: 1 },
  };
}
