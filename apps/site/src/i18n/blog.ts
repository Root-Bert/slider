import type { Lang } from './index';

/** The blog's own words: its index, an article's frame, the category names. */
const en = {
  title: 'Blog',
  kind: 'Comparisons, stories and updates',
  /** The headline: plain words, then the selected ones. */
  head: ['Notes on', 'getting ideas across.'],
  sub: 'How the office compares to the tools you know, how teams work on the same thing and what we shipped this month.',
  filter: 'Filter articles',
  all: 'All',
  search: 'Search articles',
  empty: 'No articles match yet.',
  readComparison: 'Read the comparison',
  readArticle: 'Read the article',
  tags: {
    Comparison: 'Comparison',
    'Customer story': 'Customer story',
    Update: 'Update',
    Guide: 'Guide',
  },
  tagsPlural: {
    Comparison: 'Comparisons',
    'Customer story': 'Customer stories',
    Update: 'Updates',
    Guide: 'Guides',
  },
  open: {
    note: 'Open call',
    title: "Your team's story could be next",
    text: 'Working in the office? Tell us how, and we will write it up together.',
    subject: 'Our story',
  },
  toc: 'On this page',
  shortAnswer: 'Short answer',
  faq: 'FAQ',
  faqTitle: 'Frequently asked questions',
  updated: 'Updated {date}',
  writtenBy: 'Written by {name}',
  founder: 'Founder of Slider. Builds tools that help teams get their ideas across.',
  cta: {
    title: 'Review your next deck in Slider',
    text: 'Free for small teams. No credit card.',
    button: 'Open Slider',
  },
  more: 'Keep reading',
};

const de: typeof en = {
  title: 'Blog',
  kind: 'Vergleiche, Geschichten und Neues',
  head: ['Notizen dazu,', 'wie Ideen ankommen.'],
  sub: 'Wie sich das Office von den Werkzeugen unterscheidet, die du kennst, wie Teams an derselben Sache arbeiten und was diesen Monat neu ist.',
  filter: 'Artikel filtern',
  all: 'Alle',
  search: 'Artikel suchen',
  empty: 'Dazu gibt es noch keinen Artikel.',
  readComparison: 'Zum Vergleich',
  readArticle: 'Zum Artikel',
  tags: {
    Comparison: 'Vergleich',
    'Customer story': 'Kundengeschichte',
    Update: 'Neues',
    Guide: 'Leitfaden',
  },
  tagsPlural: {
    Comparison: 'Vergleiche',
    'Customer story': 'Kundengeschichten',
    Update: 'Neues',
    Guide: 'Leitfäden',
  },
  open: {
    note: 'Offener Aufruf',
    title: 'Die Geschichte deines Teams könnte die nächste sein',
    text: 'Ihr arbeitet im Office? Erzähl uns wie, und wir schreiben es zusammen auf.',
    subject: 'Unsere Geschichte',
  },
  toc: 'Auf dieser Seite',
  shortAnswer: 'Kurze Antwort',
  faq: 'Fragen',
  faqTitle: 'Häufige Fragen',
  updated: 'Aktualisiert am {date}',
  writtenBy: 'Geschrieben von {name}',
  founder: 'Gründer von Slider. Baut Werkzeuge, mit denen Teams ihre Ideen rüberbringen.',
  cta: {
    title: 'Besprich deine nächste Präsentation in Slider',
    text: 'Kostenlos für kleine Teams. Keine Kreditkarte.',
    button: 'Slider öffnen',
  },
  more: 'Weiterlesen',
};

const fr: typeof en = {
  title: 'Blog',
  kind: 'Comparatifs, récits et nouveautés',
  head: ['Notes pour', 'faire passer ses idées.'],
  sub: 'Ce qui distingue l’office des outils que vous connaissez, comment les équipes travaillent sur la même chose et ce qui est nouveau ce mois-ci.',
  filter: 'Filtrer les articles',
  all: 'Tous',
  search: 'Chercher un article',
  empty: 'Aucun article ne correspond pour l’instant.',
  readComparison: 'Lire le comparatif',
  readArticle: 'Lire l’article',
  tags: {
    Comparison: 'Comparatif',
    'Customer story': 'Récit client',
    Update: 'Nouveauté',
    Guide: 'Guide',
  },
  tagsPlural: {
    Comparison: 'Comparatifs',
    'Customer story': 'Récits clients',
    Update: 'Nouveautés',
    Guide: 'Guides',
  },
  open: {
    note: 'Appel ouvert',
    title: 'L’histoire de votre équipe pourrait être la prochaine',
    text: 'Vous travaillez dans l’office ? Racontez-nous comment, et nous l’écrirons ensemble.',
    subject: 'Notre histoire',
  },
  toc: 'Sur cette page',
  shortAnswer: 'Réponse courte',
  faq: 'Questions',
  faqTitle: 'Questions fréquentes',
  updated: 'Mis à jour le {date}',
  writtenBy: 'Écrit par {name}',
  founder:
    'Fondateur de Slider. Construit des outils qui aident les équipes à faire passer leurs idées.',
  cta: {
    title: 'Relisez votre prochaine présentation dans Slider',
    text: 'Gratuit pour les petites équipes. Sans carte bancaire.',
    button: 'Ouvrir Slider',
  },
  more: 'À lire aussi',
};

export type BlogWords = typeof en;
export const BLOG: Record<Lang, BlogWords> = { en, de, fr };
