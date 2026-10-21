/**
 * The German demo deck ("Q4 Strategie 2026") behind `samples/slider-demo.pptx`: six slides
 * (one hidden), sections, a table, a picture, threaded modern comments (one with a reply, one
 * resolved) and one legacy comment. Shared by the writer script and the up-to-date test.
 */
import { fileURLToPath } from 'node:url';
import type { DeckSpec } from '../test/fixtures/build-pptx';
import { createPng } from '../test/fixtures/png';

export const SAMPLE_PATH = fileURLToPath(new URL('../samples/slider-demo.pptx', import.meta.url));
/** A soft blue-to-violet gradient with a horizon line, standing in for a product screenshot. */
const roadmapImage = createPng(320, 180, (x, y) => {
  const t = x / 319;
  if (Math.abs(y - 120) < 2) return [255, 255, 255];
  return [Math.round(37 + t * 102), Math.round(99 - t * 7), Math.round(235 + t * 11)];
});

export const sampleDeck: DeckSpec = {
  title: 'Q4 Strategie 2026',
  sections: [
    { name: 'Einleitung', slides: [0, 1] },
    { name: 'Analyse', slides: [2, 3, 4] },
    { name: 'Abschluss', slides: [5] },
  ],
  slides: [
    {
      layout: 'title',
      title: 'Q4 Strategie 2026',
      body: 'Vertriebs- und Produktplanung · Führungskreis',
    },
    {
      title: 'Agenda',
      body: [
        'Rückblick Q3: Ziele und Ergebnisse',
        'Umsatz nach Region',
        'Produkt-Roadmap bis Jahresende',
        'Nächste Schritte und Verantwortlichkeiten',
      ],
      comments: [
        {
          author: 'Lena Hoffmann',
          text: 'Können wir „Nächste Schritte“ an den Anfang ziehen? Das ist für den Vorstand am wichtigsten.',
          created: '2026-09-28T08:12:00.000Z',
          shapeId: 3,
          replies: [
            {
              author: 'Jonas Weber',
              text: 'Guter Punkt – ich stelle die Reihenfolge um.',
              created: '2026-09-28T09:40:00.000Z',
            },
          ],
        },
      ],
    },
    {
      title: 'Umsatz nach Region',
      shapes: [
        {
          type: 'table',
          name: 'Tabelle Umsatz',
          box: { x: 838200, y: 1825625, w: 10515600, h: 2743200 },
          rows: [
            ['Region', 'Q3 (Mio. €)', 'Q4 Plan (Mio. €)', 'Veränderung'],
            ['DACH', '12,4', '13,8', '+11 %'],
            ['Nordeuropa', '6,1', '6,9', '+13 %'],
            ['Südeuropa', '4,7', '4,9', '+4 %'],
            ['Gesamt', '23,2', '25,6', '+10 %'],
          ],
        },
        {
          type: 'rect',
          name: 'Hinweis',
          box: { x: 838200, y: 4800600, w: 10515600, h: 685800 },
          fill: 'F1F5F9',
          text: 'Planwerte vorbehaltlich der Budgetfreigabe im Oktober.',
          font: { sizePt: 16, italic: true, color: '334155' },
        },
      ],
      comments: [
        {
          author: 'Jonas Weber',
          text: 'Die Summe in Q3 stimmt nicht mit dem Controlling-Report überein.',
          created: '2026-09-29T14:05:00.000Z',
          status: 'resolved',
          position: { x: 7_000_000, y: 3_900_000 },
        },
      ],
    },
    {
      title: 'Produkt-Roadmap',
      shapes: [
        {
          type: 'picture',
          name: 'Roadmap Visual',
          box: { x: 838200, y: 1690688, w: 6858000, h: 3857625 },
          png: roadmapImage,
        },
        {
          type: 'group',
          name: 'Meilensteine',
          box: { x: 7924800, y: 1690688, w: 3429000, h: 3857625 },
          childBox: { x: 0, y: 0, w: 3429000, h: 3857625 },
          shapes: [
            {
              type: 'rect',
              name: 'Meilenstein Oktober',
              box: { x: 0, y: 0, w: 3429000, h: 1143000 },
              fill: '2563EB',
              text: 'Oktober: Beta für Pilotkunden',
              font: { sizePt: 16, bold: true, color: 'FFFFFF' },
            },
            {
              type: 'rect',
              name: 'Meilenstein November',
              box: { x: 0, y: 1357313, w: 3429000, h: 1143000 },
              fill: '0EA5E9',
              text: 'November: Rollout DACH',
              font: { sizePt: 16, bold: true, color: 'FFFFFF' },
            },
            {
              type: 'rect',
              name: 'Meilenstein Dezember',
              box: { x: 0, y: 2714625, w: 3429000, h: 1143000 },
              fill: '10B981',
              text: 'Dezember: Allgemeine Verfügbarkeit',
              font: { sizePt: 16, bold: true, color: 'FFFFFF' },
            },
          ],
        },
      ],
      legacyComments: [
        {
          author: 'Markus Klein',
          text: 'Bitte ein aktuelles Produktbild verwenden.',
          created: '2026-09-30T10:20:00.000Z',
          // Legacy positions are in 1/576 inch: roughly the centre of the picture.
          position: { x: 2900, y: 2200 },
        },
      ],
    },
    {
      title: 'Backup: Detailzahlen pro Land',
      body: ['Deutschland 8,9 Mio. €', 'Österreich 2,1 Mio. €', 'Schweiz 1,4 Mio. €'],
      hidden: true,
    },
    {
      layout: 'title',
      title: 'Vielen Dank',
      body: 'Fragen & Diskussion',
      shapes: [
        {
          type: 'rect',
          name: 'Akzentlinie',
          box: { x: 5486400, y: 3429000, w: 1219200, h: 76200 },
          fill: '2563EB',
        },
      ],
    },
  ],
};
