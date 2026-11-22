import type { ProductId } from '~/lib/apps';

/**
 * The office's words: what the five apps are, how they belong together and what a plan covers.
 * English is the shape the other languages follow. Slider's own pages keep their words in
 * `en.ts`, `de.ts`, `fr.ts`.
 */
const en = {
  status: { live: 'Available now', soon: 'Coming soon' },
  nav: {
    apps: 'Apps',
    plans: 'Plans',
    products: 'Products',
    vision: 'Vision',
    blog: 'Blog',
    overview: 'The whole office',
  },
  /** What each app is for, in one word. */
  kinds: {
    slider: 'Presentations',
    writer: 'Documents',
    solver: 'Numbers',
    reader: 'Forms',
    cloud: 'Files',
  } as Record<ProductId, string>,
  office: {
    metaTitle: 'The Office | Presentations, documents, numbers, forms and files in one place',
    metaDescription:
      'The Office is five apps that work as one: Slider for presentations, Writer for documents, Solver for numbers, Reader for forms and Cloud for files. One account, one AI, one plan. Slider, Reader and Cloud are available now.',
    title: ['Present. Write.', 'Calculate. Share.'],
    sub: 'The AI native office for Open Document. Presentations, documents, numbers and files your team and the AI work on together.',
    cta: 'Open Slider',
    more: 'Meet the apps',
    note: 'Slider, Reader and Cloud are available now. Writer and Solver are coming soon.',
    together: {
      title: 'Use one. Get all five.',
      kind: 'One account',
      sub: 'There is nothing to add on later. Every account has every app, and they share what matters.',
      items: [
        {
          t: 'One account',
          b: 'Sign in once. Your team, its roles and its colours are the same in every app.',
        },
        {
          t: 'One AI',
          b: 'It knows your slides, documents, numbers and files, and it only sees what you may see.',
        },
        { t: 'One plan', b: 'A plan covers the whole office. No app is sold on its own.' },
      ],
    },
    end: {
      title: 'Start with Slider today.',
      sub: 'The rest of the office moves in as it gets ready.',
      cta: 'Open Slider',
    },
  },
  apps: {
    slider: {
      metaTitle: 'Slider | Presentations everyone gets a say in',
      tagline: 'Presentations everyone gets a say in.',
      line: 'Everyone comments right on the slide. You, or the AI, turn it into the better version.',
      principles: [
        {
          t: 'Feedback lives on the slide',
          b: 'Everyone comments on the exact spot they mean. No mail threads, no files with version numbers.',
        },
        {
          t: 'The AI carries it out',
          b: 'It reads the comments, builds the better version and shows every change. One click takes it back.',
        },
        {
          t: 'The file is yours',
          b: 'Slider works on a real, open presentation file. Download it and present wherever you like.',
        },
      ],
    },
    writer: {
      metaTitle: 'Writer | Documents you write together',
      metaDescription:
        'Writer is the calm page where your team and the AI write together. What you see is what gets printed. Part of The Office, coming soon.',
      tagline: 'Documents you write together.',
      line: 'A calm page where your team and the AI write together. What you see is what gets printed.',
      principles: [
        {
          t: 'Paper stays paper',
          b: 'The page you see is the page you print and send. Nothing shifts on the way out.',
        },
        {
          t: 'The AI is a colleague',
          b: 'Ask it in a comment. It works in the open, marks every change and takes it back in one click.',
        },
        {
          t: 'Slides live inside',
          b: 'Put a slide from Slider into your text. It keeps itself up to date when the presentation changes.',
        },
      ],
    },
    solver: {
      metaTitle: 'Solver | Numbers that explain themselves',
      metaDescription:
        'Solver keeps every number once, in real tables. Ask in plain words, build dashboards and trace each figure back to its row. Part of The Office, coming soon.',
      tagline: 'Numbers that explain themselves.',
      line: 'Your numbers live once, in real tables. Ask in plain words and trace every figure back to its row.',
      principles: [
        {
          t: 'Every number exists once',
          b: 'A figure is defined once and checked once. Slides, documents and dashboards all read the same one.',
        },
        {
          t: 'Ask instead of formulas',
          b: 'Say what you want to know. The AI works on the real tables and shows every step it took.',
        },
        {
          t: 'Every number has an origin',
          b: 'One click leads from a figure to its filter, its formula and the single row behind it.',
        },
      ],
    },
    reader: {
      metaTitle: 'Reader | Forms you fill in and sign together',
      metaDescription:
        'Reader opens the files you get, lets you fill them in, sign them and discuss them on the page with your team and the AI. Part of The Office.',
      tagline: 'Forms you fill in and sign together.',
      line: 'Open the file you got, fill it in, sign it and discuss it right on the page. The AI answers from what it says and fills in the form.',
      principles: [
        {
          t: 'Fill in and sign',
          b: 'Type into its fields and gaps, tick its boxes and place your signature: drawn, typed or as a picture.',
        },
        {
          t: 'Discuss it on the page',
          b: 'Comment at a word or an area, live with your team. Ask the AI in a comment: it answers from the file and fills in the form.',
        },
        {
          t: 'Out it goes, complete',
          b: 'Search, print and export with everything filled in and signed. What was sent stays as it was, on purpose.',
        },
      ],
    },
    cloud: {
      metaTitle: 'Cloud | Files everyone finds again',
      metaDescription:
        'Cloud is the shared memory of your office. Every file knows its people and its history, and answers when you ask. Part of The Office.',
      tagline: 'Files everyone finds again.',
      line: 'The shared memory of your office. Every file knows its people and its history, and answers when you ask.',
      principles: [
        {
          t: 'Ask instead of search',
          b: 'Ask a question and get the answer from your files, with the places it came from.',
        },
        {
          t: 'Areas instead of folder trees',
          b: 'Teams work in areas with a colour and their people. New files find the right place.',
        },
        {
          t: 'Nothing gets lost',
          b: 'Every file keeps its history, and what you delete can be brought back.',
        },
      ],
    },
  },
  product: {
    start: 'Open Slider',
    /** `{app}` is the app's name. */
    open: 'Open {app}',
    soonNote: '{app} is coming soon. Your account includes it on the day it arrives.',
    liveNote: 'No payment method needed.',
    learn: 'Learn more',
    familyTitle: 'One of five.',
    familySub:
      'It works on its own and gets better with the others. All of them come with your account.',
  },
  plans: {
    title: 'One plan. Every app.',
    sub: 'It does not matter if you use one app or all five. Every plan covers the whole office, and no app is sold on its own.',
    includes: 'Includes',
    soon: 'Coming soon',
    forever: 'forever',
    free: {
      pitch: 'Everything you need to start, for as long as you like.',
      cta: 'Open Slider',
      features: ['Up to 5 people', '20 GB storage', 'Live collaboration'],
    },
    team: {
      pitch: 'For whole teams, at one flat price per workspace.',
      features: ['Up to 100 people', 'More storage', 'Invoices for your accounting'],
    },
    pro: {
      pitch: 'With the AI built in. No own key, nothing to manage.',
      features: ['AI included', 'Models kept up to date', 'One bill for everything'],
    },
    self: 'Prefer your own server? Slider is open source and free to host.',
    selfButton: 'View on GitHub',
  },
  footer: {
    tagline: 'Get your ideas across.',
    apps: 'Apps',
    more: 'Slider',
    company: 'Company',
    blog: 'Blog',
    source: 'Source code',
    changelog: 'Changelog',
    contact: 'Contact',
    about: 'About',
  },
  /** The words inside the drawn objects. */
  objects: {
    slider: {
      kicker: 'Proposal',
      title: 'An office dog for the team',
      a: { by: 'Lara', text: 'That is a lot of text.' },
      b: { by: 'Ben', text: 'Where is the dog?!' },
      you: 'Comment',
    },
    writer: {
      heading: 'Revenue and growth',
      before: 'Revenue rose in the third quarter to',
      mark: '4.2 million euros',
      after: 'mainly driven by consulting and two key accounts.',
      chart: 'Revenue per quarter',
      ai: 'AI',
      aiText: 'I took the figure from the quarterly report and adjusted the sentence.',
      done: '1 change',
      by: 'Ben',
    },
    solver: {
      table: 'Orders',
      rows: '12,418 rows',
      kpi: 'Revenue Q3',
      value: '€1.84M',
      trend: '+12.4 %',
      ask: 'Which key accounts have not ordered in 60 days?',
      answer: '7 customers',
      by: 'Ben',
    },
    cloud: {
      area: 'Sales',
      count: '4 files',
      ask: 'What discount did we offer?',
      answer: '8 % in the current offer',
      source: 'Offer, page 4',
    },
  },
};

export type Suite = typeof en;

const de: Suite = {
  status: { live: 'Jetzt verfügbar', soon: 'Kommt bald' },
  nav: {
    apps: 'Apps',
    plans: 'Pläne',
    products: 'Produkte',
    vision: 'Vision',
    blog: 'Blog',
    overview: 'Das ganze Office',
  },
  kinds: { slider: 'Präsentationen', writer: 'Dokumente', solver: 'Zahlen', reader: 'Formulare', cloud: 'Dateien' },
  office: {
    metaTitle: 'The Office | Präsentationen, Dokumente, Zahlen, Formulare und Dateien an einem Ort',
    metaDescription:
      'The Office sind fünf Apps, die wie eine arbeiten: Slider für Präsentationen, Writer für Dokumente, Solver für Zahlen, Reader für Formulare und Cloud für Dateien. Ein Konto, eine KI, ein Plan. Slider, Reader und Cloud gibt es schon.',
    title: ['Präsentieren. Schreiben.', 'Rechnen. Teilen.'],
    sub: 'Das KI-native Office für Open Document. Präsentationen, Dokumente, Zahlen und Dateien, an denen dein Team und die KI gemeinsam arbeiten.',
    cta: 'Slider öffnen',
    more: 'Die Apps ansehen',
    note: 'Slider, Reader und Cloud gibt es schon. Writer und Solver kommen bald.',
    together: {
      title: 'Nutze eine. Bekomm alle fünf.',
      kind: 'Ein Konto',
      sub: 'Nichts muss später dazugebucht werden. Jedes Konto hat jede App, und sie teilen, worauf es ankommt.',
      items: [
        {
          t: 'Ein Konto',
          b: 'Einmal anmelden. Dein Team, seine Rollen und seine Farben sind in jeder App dieselben.',
        },
        {
          t: 'Eine KI',
          b: 'Sie kennt deine Folien, Dokumente, Zahlen und Dateien und sieht nur, was du sehen darfst.',
        },
        {
          t: 'Ein Plan',
          b: 'Ein Plan gilt für das ganze Office. Keine App wird einzeln verkauft.',
        },
      ],
    },
    end: {
      title: 'Fang heute mit Slider an.',
      sub: 'Der Rest des Office zieht ein, sobald er fertig ist.',
      cta: 'Slider öffnen',
    },
  },
  apps: {
    slider: {
      metaTitle: 'Slider | Präsentationen, bei denen alle mitreden',
      tagline: 'Präsentationen, bei denen alle mitreden.',
      line: 'Alle kommentieren direkt auf der Folie. Du oder die KI machen daraus die bessere Version.',
      principles: [
        {
          t: 'Feedback steht auf der Folie',
          b: 'Alle kommentieren genau die Stelle, die sie meinen. Keine Mails, keine Dateien mit Versionsnummern.',
        },
        {
          t: 'Die KI setzt es um',
          b: 'Sie liest die Kommentare, baut die bessere Version und zeigt jede Änderung. Ein Klick nimmt sie zurück.',
        },
        {
          t: 'Die Datei gehört dir',
          b: 'Slider arbeitet auf einer echten, offenen Präsentationsdatei. Lade sie herunter und präsentiere, wo du willst.',
        },
      ],
    },
    writer: {
      metaTitle: 'Writer | Dokumente, die ihr zusammen schreibt',
      metaDescription:
        'Writer ist die ruhige Seite, auf der dein Team und die KI zusammen schreiben. Was du siehst, wird gedruckt. Teil von The Office, kommt bald.',
      tagline: 'Dokumente, die ihr zusammen schreibt.',
      line: 'Eine ruhige Seite, auf der dein Team und die KI zusammen schreiben. Was du siehst, wird gedruckt.',
      principles: [
        {
          t: 'Papier bleibt Papier',
          b: 'Die Seite, die du siehst, ist die Seite, die du druckst und verschickst. Nichts verrutscht auf dem Weg.',
        },
        {
          t: 'Die KI ist eine Kollegin',
          b: 'Beauftrage sie per Kommentar. Sie arbeitet sichtbar, markiert jede Änderung und nimmt sie mit einem Klick zurück.',
        },
        {
          t: 'Folien leben im Text',
          b: 'Setz eine Folie aus Slider in dein Dokument. Sie bleibt aktuell, wenn sich die Präsentation ändert.',
        },
      ],
    },
    solver: {
      metaTitle: 'Solver | Zahlen, die sich selbst erklären',
      metaDescription:
        'Solver hält jede Zahl einmal, in echten Tabellen. Frag in normalen Worten, bau Dashboards und verfolge jede Zahl bis zu ihrer Zeile zurück. Teil von The Office, kommt bald.',
      tagline: 'Zahlen, die sich selbst erklären.',
      line: 'Deine Zahlen liegen einmal vor, in echten Tabellen. Frag in normalen Worten und verfolge jede Zahl bis zu ihrer Zeile zurück.',
      principles: [
        {
          t: 'Jede Zahl gibt es einmal',
          b: 'Eine Kennzahl wird einmal festgelegt und einmal geprüft. Folien, Dokumente und Dashboards lesen dieselbe.',
        },
        {
          t: 'Fragen statt Formeln',
          b: 'Sag, was du wissen willst. Die KI rechnet über die echten Tabellen und zeigt jeden Schritt.',
        },
        {
          t: 'Jede Zahl hat eine Herkunft',
          b: 'Ein Klick führt von der Zahl zu ihrem Filter, ihrer Formel und der einzelnen Zeile dahinter.',
        },
      ],
    },
    reader: {
      metaTitle: 'Reader | Formulare, die ihr zusammen ausfüllt',
      metaDescription:
        'Reader öffnet die Dateien, die du bekommst. Füll sie aus, unterschreib sie und besprich sie direkt auf der Seite mit deinem Team und der KI. Teil von The Office.',
      tagline: 'Formulare, die ihr zusammen ausfüllt.',
      line: 'Öffne die Datei, die du bekommen hast, füll sie aus, unterschreib sie und besprich sie direkt auf der Seite. Die KI antwortet aus ihrem Inhalt und füllt das Formular aus.',
      principles: [
        {
          t: 'Ausfüllen und unterschreiben',
          b: 'Schreib in Felder und Lücken, setz Häkchen und deine Unterschrift: gezeichnet, getippt oder als Bild.',
        },
        {
          t: 'Besprechen auf der Seite',
          b: 'Kommentiere an einem Wort oder einem Bereich, live mit deinem Team. Frag die KI im Kommentar: Sie antwortet aus der Datei und füllt das Formular aus.',
        },
        {
          t: 'Fertig, wie es rausgeht',
          b: 'Suchen, drucken und exportieren, mit allem, was ausgefüllt und unterschrieben ist. Was geschickt wurde, bleibt, wie es war, mit Absicht.',
        },
      ],
    },
    cloud: {
      metaTitle: 'Cloud | Dateien, die jeder wiederfindet',
      metaDescription:
        'Cloud ist das gemeinsame Gedächtnis deines Office. Jede Datei kennt ihre Leute und ihren Verlauf und antwortet, wenn du fragst. Teil von The Office.',
      tagline: 'Dateien, die jeder wiederfindet.',
      line: 'Das gemeinsame Gedächtnis deines Office. Jede Datei kennt ihre Leute und ihren Verlauf und antwortet, wenn du fragst.',
      principles: [
        {
          t: 'Fragen statt suchen',
          b: 'Stell eine Frage und bekomm die Antwort aus deinen Dateien, mit den Stellen, aus denen sie stammt.',
        },
        {
          t: 'Bereiche statt Ordnerbäume',
          b: 'Teams arbeiten in Bereichen mit einer Farbe und ihren Leuten. Neue Dateien finden den richtigen Platz.',
        },
        {
          t: 'Nichts geht verloren',
          b: 'Jede Datei behält ihren Verlauf, und was du löschst, lässt sich zurückholen.',
        },
      ],
    },
  },
  product: {
    start: 'Slider öffnen',
    open: '{app} öffnen',
    soonNote: '{app} kommt bald. Dein Konto hat es an dem Tag, an dem es da ist.',
    liveNote: 'Keine Zahlungsart nötig.',
    learn: 'Mehr erfahren',
    familyTitle: 'Eine von fünf.',
    familySub:
      'Sie funktioniert für sich und wird mit den anderen besser. Alle gehören zu deinem Konto.',
  },
  plans: {
    title: 'Ein Plan. Jede App.',
    sub: 'Es ist egal, ob du eine App nutzt oder alle fünf. Jeder Plan gilt für das ganze Office, und keine App wird einzeln verkauft.',
    includes: 'Enthält',
    soon: 'Kommt bald',
    forever: 'für immer',
    free: {
      pitch: 'Alles, was du zum Anfangen brauchst, so lange du willst.',
      cta: 'Slider öffnen',
      features: ['Bis zu 5 Personen', '20 GB Speicher', 'Gemeinsam in Echtzeit'],
    },
    team: {
      pitch: 'Für ganze Teams, zu einem festen Preis pro Workspace.',
      features: ['Bis zu 100 Personen', 'Mehr Speicher', 'Rechnungen für die Buchhaltung'],
    },
    pro: {
      pitch: 'Mit eingebauter KI. Kein eigener Schlüssel, nichts zu verwalten.',
      features: ['KI inklusive', 'Modelle immer aktuell', 'Eine Rechnung für alles'],
    },
    self: 'Lieber auf dem eigenen Server? Slider ist Open Source und kostenlos zu betreiben.',
    selfButton: 'Auf GitHub ansehen',
  },
  footer: {
    tagline: 'Bring deine Ideen rüber.',
    apps: 'Apps',
    more: 'Slider',
    company: 'Unternehmen',
    blog: 'Blog',
    source: 'Quellcode',
    changelog: 'Änderungen',
    contact: 'Kontakt',
    about: 'Über mich',
  },
  objects: {
    slider: {
      kicker: 'Vorschlag',
      title: 'Ein Bürohund für das Team',
      a: { by: 'Lara', text: 'Ganz schön viel Text.' },
      b: { by: 'Ben', text: 'Und wo ist der Hund?!' },
      you: 'Kommentieren',
    },
    writer: {
      heading: 'Umsatz und Wachstum',
      before: 'Der Umsatz stieg im dritten Quartal auf',
      mark: '4,2 Millionen Euro',
      after: 'getragen vor allem vom Beratungsgeschäft und zwei Großkunden.',
      chart: 'Umsatz je Quartal',
      ai: 'KI',
      aiText: 'Ich habe die Zahl aus dem Quartalsbericht übernommen und den Satz angepasst.',
      done: '1 Änderung',
      by: 'Ben',
    },
    solver: {
      table: 'Aufträge',
      rows: '12.418 Zeilen',
      kpi: 'Umsatz Q3',
      value: '1,84 Mio. €',
      trend: '+12,4 %',
      ask: 'Welche Großkunden haben seit 60 Tagen nichts bestellt?',
      answer: '7 Kunden',
      by: 'Ben',
    },
    cloud: {
      area: 'Vertrieb',
      count: '4 Dateien',
      ask: 'Welchen Rabatt haben wir angeboten?',
      answer: '8 % im aktuellen Angebot',
      source: 'Angebot, Seite 4',
    },
  },
};

const fr: Suite = {
  status: { live: 'Disponible', soon: 'Bientôt' },
  nav: {
    apps: 'Apps',
    plans: 'Offres',
    products: 'Produits',
    vision: 'Vision',
    blog: 'Blog',
    overview: 'Tout l’office',
  },
  kinds: { slider: 'Présentations', writer: 'Documents', solver: 'Chiffres', reader: 'Formulaires', cloud: 'Fichiers' },
  office: {
    metaTitle: 'The Office | Présentations, documents, chiffres, formulaires et fichiers au même endroit',
    metaDescription:
      'The Office, ce sont cinq apps qui travaillent comme une seule : Slider pour les présentations, Writer pour les documents, Solver pour les chiffres, Reader pour les formulaires et Cloud pour les fichiers. Un compte, une IA, une offre. Slider, Reader et Cloud sont déjà disponibles.',
    title: ['Présenter. Écrire.', 'Calculer. Partager.'],
    sub: 'L’office natif IA pour Open Document. Présentations, documents, chiffres et fichiers sur lesquels votre équipe et l’IA travaillent ensemble.',
    cta: 'Ouvrir Slider',
    more: 'Découvrir les apps',
    note: 'Slider, Reader et Cloud sont déjà disponibles. Writer et Solver arrivent bientôt.',
    together: {
      title: 'Utilisez-en une. Recevez les cinq.',
      kind: 'Un compte',
      sub: 'Rien à ajouter plus tard. Chaque compte a chaque app, et elles partagent l’essentiel.',
      items: [
        {
          t: 'Un compte',
          b: 'Une seule connexion. Votre équipe, ses rôles et ses couleurs sont les mêmes dans chaque app.',
        },
        {
          t: 'Une IA',
          b: 'Elle connaît vos diapositives, documents, chiffres et fichiers, et ne voit que ce que vous pouvez voir.',
        },
        { t: 'Une offre', b: 'Une offre couvre tout l’office. Aucune app n’est vendue seule.' },
      ],
    },
    end: {
      title: 'Commencez avec Slider aujourd’hui.',
      sub: 'Le reste de l’office emménage dès qu’il est prêt.',
      cta: 'Ouvrir Slider',
    },
  },
  apps: {
    slider: {
      metaTitle: 'Slider | Des présentations où chacun a son mot à dire',
      tagline: 'Des présentations où chacun a son mot à dire.',
      line: 'Chacun commente directement sur la diapositive. Vous, ou l’IA, en faites la meilleure version.',
      principles: [
        {
          t: 'Les retours sont sur la diapositive',
          b: 'Chacun commente l’endroit précis dont il parle. Pas de fils de mails, pas de fichiers numérotés.',
        },
        {
          t: 'L’IA s’en charge',
          b: 'Elle lit les commentaires, construit la meilleure version et montre chaque changement. Un clic l’annule.',
        },
        {
          t: 'Le fichier est à vous',
          b: 'Slider travaille sur un vrai fichier de présentation ouvert. Téléchargez-le et présentez où vous voulez.',
        },
      ],
    },
    writer: {
      metaTitle: 'Writer | Des documents écrits ensemble',
      metaDescription:
        'Writer est la page calme où votre équipe et l’IA écrivent ensemble. Ce que vous voyez est ce qui s’imprime. Fait partie de The Office, bientôt disponible.',
      tagline: 'Des documents écrits ensemble.',
      line: 'Une page calme où votre équipe et l’IA écrivent ensemble. Ce que vous voyez est ce qui s’imprime.',
      principles: [
        {
          t: 'Le papier reste du papier',
          b: 'La page que vous voyez est celle que vous imprimez et envoyez. Rien ne bouge en chemin.',
        },
        {
          t: 'L’IA est une collègue',
          b: 'Demandez-lui dans un commentaire. Elle travaille à découvert, marque chaque changement et l’annule en un clic.',
        },
        {
          t: 'Les diapositives vivent dans le texte',
          b: 'Placez une diapositive de Slider dans votre document. Elle reste à jour quand la présentation change.',
        },
      ],
    },
    solver: {
      metaTitle: 'Solver | Des chiffres qui s’expliquent',
      metaDescription:
        'Solver garde chaque chiffre une seule fois, dans de vraies tables. Posez vos questions avec vos mots, créez des tableaux de bord et remontez chaque chiffre jusqu’à sa ligne. Fait partie de The Office, bientôt disponible.',
      tagline: 'Des chiffres qui s’expliquent.',
      line: 'Vos chiffres existent une seule fois, dans de vraies tables. Posez vos questions avec vos mots et remontez chaque chiffre jusqu’à sa ligne.',
      principles: [
        {
          t: 'Chaque chiffre existe une fois',
          b: 'Un indicateur est défini une fois et vérifié une fois. Diapositives, documents et tableaux de bord lisent le même.',
        },
        {
          t: 'Demander au lieu de formuler',
          b: 'Dites ce que vous voulez savoir. L’IA calcule sur les vraies tables et montre chaque étape.',
        },
        {
          t: 'Chaque chiffre a une origine',
          b: 'Un clic mène du chiffre à son filtre, à sa formule et à la ligne qui se cache derrière.',
        },
      ],
    },
    reader: {
      metaTitle: 'Reader | Des formulaires remplis et signés ensemble',
      metaDescription:
        'Reader ouvre les fichiers que vous recevez. Remplissez-les, signez-les et discutez-en directement sur la page avec votre équipe et l’IA. Fait partie de The Office.',
      tagline: 'Des formulaires remplis et signés ensemble.',
      line: 'Ouvrez le fichier reçu, remplissez-le, signez-le et discutez-en directement sur la page. L’IA répond à partir de son contenu et remplit le formulaire.',
      principles: [
        {
          t: 'Remplir et signer',
          b: 'Écrivez dans ses champs et ses blancs, cochez ses cases et placez votre signature : dessinée, tapée ou en image.',
        },
        {
          t: 'En discuter sur la page',
          b: 'Commentez un mot ou une zone, en direct avec votre équipe. Demandez à l’IA dans un commentaire : elle répond à partir du fichier et remplit le formulaire.',
        },
        {
          t: 'Complet au départ',
          b: 'Cherchez, imprimez et exportez avec tout ce qui est rempli et signé. Ce qui a été envoyé reste tel quel, volontairement.',
        },
      ],
    },
    cloud: {
      metaTitle: 'Cloud | Des fichiers que chacun retrouve',
      metaDescription:
        'Cloud est la mémoire commune de votre office. Chaque fichier connaît ses personnes et son historique, et répond quand vous demandez. Fait partie de The Office.',
      tagline: 'Des fichiers que chacun retrouve.',
      line: 'La mémoire commune de votre office. Chaque fichier connaît ses personnes et son historique, et répond quand vous demandez.',
      principles: [
        {
          t: 'Demander au lieu de chercher',
          b: 'Posez une question et recevez la réponse tirée de vos fichiers, avec les endroits d’où elle vient.',
        },
        {
          t: 'Des espaces, pas des arborescences',
          b: 'Les équipes travaillent dans des espaces avec une couleur et leurs personnes. Les nouveaux fichiers trouvent leur place.',
        },
        {
          t: 'Rien ne se perd',
          b: 'Chaque fichier garde son historique, et ce que vous supprimez peut être récupéré.',
        },
      ],
    },
  },
  product: {
    start: 'Ouvrir Slider',
    open: 'Ouvrir {app}',
    soonNote: '{app} arrive bientôt. Votre compte l’inclut le jour de sa sortie.',
    liveNote: 'Aucun moyen de paiement requis.',
    learn: 'En savoir plus',
    familyTitle: 'Une sur cinq.',
    familySub:
      'Elle fonctionne seule et devient meilleure avec les autres. Toutes font partie de votre compte.',
  },
  plans: {
    title: 'Une offre. Toutes les apps.',
    sub: 'Peu importe que vous utilisiez une app ou les cinq. Chaque offre couvre tout l’office, et aucune app n’est vendue seule.',
    includes: 'Comprend',
    soon: 'Bientôt',
    forever: 'pour toujours',
    free: {
      pitch: 'Tout ce qu’il faut pour commencer, aussi longtemps que vous voulez.',
      cta: 'Ouvrir Slider',
      features: ['Jusqu’à 5 personnes', '20 Go de stockage', 'Collaboration en direct'],
    },
    team: {
      pitch: 'Pour des équipes entières, à un prix fixe par espace de travail.',
      features: ['Jusqu’à 100 personnes', 'Plus de stockage', 'Factures pour votre comptabilité'],
    },
    pro: {
      pitch: 'Avec l’IA intégrée. Pas de clé à fournir, rien à gérer.',
      features: ['IA incluse', 'Modèles toujours à jour', 'Une seule facture'],
    },
    self: 'Vous préférez votre propre serveur ? Slider est open source et gratuit à héberger.',
    selfButton: 'Voir sur GitHub',
  },
  footer: {
    tagline: 'Faites passer vos idées.',
    apps: 'Apps',
    more: 'Slider',
    company: 'Entreprise',
    blog: 'Blog',
    source: 'Code source',
    changelog: 'Nouveautés',
    contact: 'Contact',
    about: 'À propos',
  },
  objects: {
    slider: {
      kicker: 'Proposition',
      title: 'Un chien de bureau pour l’équipe',
      a: { by: 'Lara', text: 'Ça fait beaucoup de texte.' },
      b: { by: 'Ben', text: 'Et il est où, le chien ?!' },
      you: 'Commenter',
    },
    writer: {
      heading: 'Chiffre d’affaires et croissance',
      before: 'Le chiffre d’affaires a atteint au troisième trimestre',
      mark: '4,2 millions d’euros',
      after: 'porté surtout par le conseil et deux grands comptes.',
      chart: 'Chiffre d’affaires par trimestre',
      ai: 'IA',
      aiText: 'J’ai repris le chiffre du rapport trimestriel et adapté la phrase.',
      done: '1 modification',
      by: 'Ben',
    },
    solver: {
      table: 'Commandes',
      rows: '12 418 lignes',
      kpi: 'Chiffre d’affaires T3',
      value: '1,84 M €',
      trend: '+12,4 %',
      ask: 'Quels grands comptes n’ont rien commandé depuis 60 jours ?',
      answer: '7 clients',
      by: 'Ben',
    },
    cloud: {
      area: 'Ventes',
      count: '4 fichiers',
      ask: 'Quelle remise avons-nous proposée ?',
      answer: '8 % dans l’offre actuelle',
      source: 'Offre, page 4',
    },
  },
};

export const SUITE = { en, de, fr } satisfies Record<'en' | 'de' | 'fr', Suite>;
