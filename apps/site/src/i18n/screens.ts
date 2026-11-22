import type { ProductId } from '~/lib/apps';

/**
 * What stands under each screen (`lib/screens.ts`), and the words of the row they are shown in.
 * The screens themselves come from the prototype and are in German.
 */
interface ScreenWords {
  title: string;
  /** Under the title for an app that is on its way; `{app}` is its name. */
  soon: string;
  /** Under the title for Slider. */
  live: string;
  /** Under the title for another app that is here already. */
  liveOf: Partial<Record<ProductId, string>>;
  previous: string;
  next: string;
  captions: Record<ProductId, Record<string, string>>;
}

const en: ScreenWords = {
  title: 'A look inside.',
  soon: 'This is what {app} will look like. Screens from the prototype.',
  live: 'How a presentation gets better, step by step.',
  liveOf: { reader: 'How a form gets filled in, signed and sent, step by step.' },
  previous: 'Previous screen',
  next: 'Next screen',
  captions: {
    slider: {
      discuss: 'Everyone comments right on the slide',
      thread: 'One thread per point',
      'ai-changed': 'The AI carries out the feedback',
      'edit-text': 'Edit text right on the slide',
      symbol: 'Symbols from the library',
      export: 'Export in the format you need',
      present: 'Present',
      presentations: 'All presentations at a glance',
    },
    writer: {
      editor: 'Write on the real page',
      discuss: 'Discuss right in the text',
      'ai-done': 'The AI shows what it changed',
      'create-with-ai': 'Start a document with the AI',
      'slide-from-slider': 'A slide from Slider in your text',
      'as-presentation': 'A document becomes a presentation',
      focus: 'Focus: only the page',
      documents: 'All documents at a glance',
      'app-switcher': 'The other apps are one step away',
    },
    solver: {
      canvas: 'Tables and charts on one canvas',
      table: 'Real tables, not loose cells',
      ask: 'Ask in plain words',
      answer: 'The answer, with every step',
      dashboard: 'A dashboard from your numbers',
      origin: 'Where a number comes from',
      'in-slider': 'The same number in Slider',
      scenarios: 'Compare scenarios',
    },
    reader: {
      fill: 'Type right into the form',
      sign: 'Your signature where it belongs',
      discuss: 'Comment at the words you mean',
      search: 'Search it, print it, send it on',
      files: 'All files at a glance',
    },
    cloud: {
      recent: 'What you worked on last',
      area: 'An area for every team',
      preview: 'Look inside without opening',
      ask: 'Ask your files',
      search: 'Search across everything',
      'app-switcher': 'All four apps, one step away',
      'desktop-sync': 'In sync with your computer',
      mobile: 'On your phone',
      'org-chart': 'Areas follow your organisation',
      deleted: 'What you delete can be brought back',
    },
  },
};

const de: ScreenWords = {
  title: 'Ein Blick hinein.',
  soon: 'So wird {app} aussehen. Screens aus dem Prototyp.',
  live: 'So wird eine Präsentation besser, Schritt für Schritt.',
  liveOf: { reader: 'So wird ein Formular ausgefüllt, unterschrieben und verschickt, Schritt für Schritt.' },
  previous: 'Voriger Screen',
  next: 'Nächster Screen',
  captions: {
    slider: {
      discuss: 'Alle kommentieren direkt auf der Folie',
      thread: 'Ein Thread pro Punkt',
      'ai-changed': 'Die KI setzt das Feedback um',
      'edit-text': 'Text direkt auf der Folie bearbeiten',
      symbol: 'Symbole aus der Bibliothek',
      export: 'Exportieren im passenden Format',
      present: 'Präsentieren',
      presentations: 'Alle Präsentationen auf einen Blick',
    },
    writer: {
      editor: 'Schreiben auf der echten Seite',
      discuss: 'Direkt im Text besprechen',
      'ai-done': 'Die KI zeigt, was sie geändert hat',
      'create-with-ai': 'Ein Dokument mit der KI beginnen',
      'slide-from-slider': 'Eine Folie aus Slider im Text',
      'as-presentation': 'Aus dem Dokument wird eine Präsentation',
      focus: 'Fokus: nur die Seite',
      documents: 'Alle Dokumente auf einen Blick',
      'app-switcher': 'Die anderen Apps sind einen Schritt entfernt',
    },
    solver: {
      canvas: 'Tabellen und Diagramme auf einer Leinwand',
      table: 'Echte Tabellen statt loser Zellen',
      ask: 'In normalen Worten fragen',
      answer: 'Die Antwort mit jedem Schritt',
      dashboard: 'Ein Dashboard aus deinen Zahlen',
      origin: 'Woher eine Zahl kommt',
      'in-slider': 'Dieselbe Zahl in Slider',
      scenarios: 'Szenarien vergleichen',
    },
    reader: {
      fill: 'Direkt ins Formular schreiben',
      sign: 'Deine Unterschrift an ihrem Platz',
      discuss: 'Kommentieren an den Worten, die du meinst',
      search: 'Suchen, drucken, weitergeben',
      files: 'Alle Dateien auf einen Blick',
    },
    cloud: {
      recent: 'Woran du zuletzt gearbeitet hast',
      area: 'Ein Bereich für jedes Team',
      preview: 'Hineinsehen ohne Öffnen',
      ask: 'Frag deine Dateien',
      search: 'Suche über alles',
      'app-switcher': 'Alle vier Apps, einen Schritt entfernt',
      'desktop-sync': 'Synchron mit deinem Rechner',
      mobile: 'Auf dem Handy',
      'org-chart': 'Bereiche folgen eurer Organisation',
      deleted: 'Gelöschtes lässt sich zurückholen',
    },
  },
};

const fr: ScreenWords = {
  title: 'Un regard à l’intérieur.',
  soon: 'Voici à quoi ressemblera {app}. Écrans du prototype.',
  live: 'Comment une présentation s’améliore, pas à pas.',
  liveOf: { reader: 'Comment un formulaire est rempli, signé et envoyé, pas à pas.' },
  previous: 'Écran précédent',
  next: 'Écran suivant',
  captions: {
    slider: {
      discuss: 'Chacun commente sur la diapositive',
      thread: 'Un fil par remarque',
      'ai-changed': 'L’IA applique les retours',
      'edit-text': 'Modifier le texte sur la diapositive',
      symbol: 'Des symboles de la bibliothèque',
      export: 'Exporter au bon format',
      present: 'Présenter',
      presentations: 'Toutes les présentations d’un coup d’œil',
    },
    writer: {
      editor: 'Écrire sur la vraie page',
      discuss: 'Discuter dans le texte',
      'ai-done': 'L’IA montre ce qu’elle a changé',
      'create-with-ai': 'Commencer un document avec l’IA',
      'slide-from-slider': 'Une diapositive de Slider dans le texte',
      'as-presentation': 'Le document devient une présentation',
      focus: 'Focus : rien que la page',
      documents: 'Tous les documents d’un coup d’œil',
      'app-switcher': 'Les autres apps sont à un pas',
    },
    solver: {
      canvas: 'Tableaux et graphiques sur une même toile',
      table: 'De vrais tableaux, pas des cellules éparses',
      ask: 'Demander avec ses mots',
      answer: 'La réponse, étape par étape',
      dashboard: 'Un tableau de bord à partir de vos chiffres',
      origin: 'D’où vient un chiffre',
      'in-slider': 'Le même chiffre dans Slider',
      scenarios: 'Comparer des scénarios',
    },
    reader: {
      fill: 'Écrire directement dans le formulaire',
      sign: 'Votre signature à sa place',
      discuss: 'Commenter les mots dont vous parlez',
      search: 'Chercher, imprimer, transmettre',
      files: 'Tous les fichiers en un coup d’œil',
    },
    cloud: {
      recent: 'Vos derniers fichiers',
      area: 'Un espace pour chaque équipe',
      preview: 'Regarder sans ouvrir',
      ask: 'Interrogez vos fichiers',
      search: 'Chercher partout',
      'app-switcher': 'Les quatre apps à un pas',
      'desktop-sync': 'Synchronisé avec votre ordinateur',
      mobile: 'Sur votre téléphone',
      'org-chart': 'Les espaces suivent votre organisation',
      deleted: 'Ce que vous supprimez se récupère',
    },
  },
};

export const SCREEN_WORDS = { en, de, fr } satisfies Record<'en' | 'de' | 'fr', ScreenWords>;
