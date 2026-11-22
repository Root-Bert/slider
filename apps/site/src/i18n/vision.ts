/**
 * The vision page's words (`/office/vision/`): the founder's letter in eight chapters, from the
 * mission down to what the office does about it. English is the shape the other languages follow.
 * A chapter's title ends in `mark`, the phrase the page selects like a shape in the editor.
 */
const en = {
  metaTitle: 'Vision | The Office',
  metaDescription:
    'Accelerate social progress, build a slower future: why The Office exists and why people and the AI work on the same thing.',
  eyebrow: 'Our mission',
  title: ['Accelerate social progress.', 'Build a slower future.'],
  sub: 'It sounds like a contradiction. It is the plan: the faster good ideas travel, the sooner we arrive at a world with more time for each other. This is the thread the office follows.',
  future: {
    label: 'A slower future',
    title: 'What machines can’t take from us:',
    mark: 'each other.',
    body: 'AI already does much of what happens at a screen, and robots will take on most of the rest. Then a job no longer has to be how we earn money to spend. We do what we do out of passion and conviction, and the only real task left is living together well.',
    from: 'Progress society',
    to: 'Slower future',
    rows: [
      ['Working to earn a living', 'Working out of passion'],
      ['Useful means paying taxes', 'Useful means caring for others'],
      ['Using resources up', 'Keeping materials in a loop'],
      ['Always more, always faster', 'Time for leisure, together'],
    ],
    note: 'highly automated, and still slow',
  },
  ours: {
    label: 'What stays ours',
    title: 'We are natural intelligences, and we all',
    mark: 'want a say.',
    body: 'AI can write, calculate and design. What it cannot have for us is our opinion and our own taste. Every one of us sees the world a little differently, and wants to be heard. Change happens when enough of those voices come together. Bringing every voice in is what the office is built for.',
    voices: [
      ['Marlon', 'Slide 4 can go.'],
      ['Gesa', 'Start with the why.'],
      ['Lara', 'Love the ending!'],
      ['Paul', 'Where is this from?'],
      ['Anna', 'I see it differently.'],
      ['You', 'Here is my take.'],
    ],
  },
  matters: {
    label: 'Why it matters',
    title: 'Shared work is a',
    mark: 'society accelerator.',
    body: 'Plans, concepts and visions travel on slides, in documents and in numbers: in consulting, in companies, in classrooms, in every pitch. The faster a vision is understood, the faster people come on board. And the faster people come on board, the faster the world can change.',
    chain: ['An idea', 'Understood', 'On board', 'Change'],
    note: 'faster',
  },
  evil: {
    label: 'The necessary evil',
    title: 'Nobody loves',
    mark: 'office work.',
    body: 'You spend weeks working something out. Then comes the part everyone dreads: squeezing it all into a presentation, a report, a table. It feels like extra work on top of the real work. And honestly, a bit of that is true.',
    you: 'You',
    chat: [
      ['11:48 pm', 'Research is done. Now I still have to put all of this into slides…'],
      ['11:52 pm', 'Does anyone even read these?'],
    ],
  },
  need: {
    label: 'Why we still need it',
    title: 'But good work',
    mark: 'moves people.',
    body: 'We need it all the same. To pass on what we know, to give a speaker something to stand on, to show that the numbers hold. Every time, the job is the same: get an idea across to other people.',
    /** One card per app, in the order of `PRODUCTS`. */
    cards: [
      ['Pitch', 'Win people over for an idea in a few minutes.'],
      ['Explain', 'Write it down so others can build on it.'],
      ['Prove', 'Numbers that show where they come from.'],
      ['Keep', 'Everything in one place, for everyone who needs it.'],
    ],
    say: 'Done well, an idea',
    sayMark: 'lands far better.',
    note: 'That is the essence',
  },
  together: {
    label: 'So we build it together',
    title: 'Made the way it is shared:',
    mark: 'together.',
    body: 'A presentation, a report or a plan exists to inform people and bring them on board. Creating it should work exactly the same way. That is why the whole office is multiplayer: everyone on the same file, live, at the same time.',
  },
  ai: {
    label: 'And with AI',
    title: 'Every comment is',
    mark: 'its own agent.',
    body: 'Other tools bolt a chat to the side and call it AI. Here, AI lives where the feedback is: every thread can become an agent that joins the team like another colleague. AI does the work, people bring their opinion. The slower future, in miniature.',
    elsewhere: ['Elsewhere', 'A chat bolted to the side'],
    here: ['The Office', 'Every thread is its own agent'],
  },
  short: {
    label: 'Long story short',
    lines: ['Communicate visions.', 'Accelerate society.', 'Build a slower future.'],
    last: 'Make the world',
    mark: 'a better place.',
    sign: 'Founder',
  },
  road: {
    label: 'The office',
    title: 'Where we are.',
    sub: 'One app at a time, each one finished before the next.',
  },
};

export type Vision = typeof en;

const de: Vision = {
  metaTitle: 'Vision | The Office',
  metaDescription:
    'Gesellschaftlichen Fortschritt beschleunigen, eine langsamere Zukunft bauen: warum es The Office gibt und warum Menschen und KI an derselben Sache arbeiten.',
  eyebrow: 'Unsere Mission',
  title: ['Fortschritt beschleunigen.', 'Eine langsamere Zukunft bauen.'],
  sub: 'Es klingt wie ein Widerspruch. Es ist der Plan: Je schneller gute Ideen ankommen, desto eher leben wir in einer Welt mit mehr Zeit füreinander. Diesem Faden folgt das Office.',
  future: {
    label: 'Eine langsamere Zukunft',
    title: 'Was Maschinen uns nicht nehmen können:',
    mark: 'einander.',
    body: 'KI erledigt schon heute vieles von dem, was am Bildschirm passiert, und Roboter übernehmen den größten Teil vom Rest. Dann muss ein Job nicht mehr der Weg sein, Geld zum Ausgeben zu verdienen. Wir tun, was wir tun, aus Leidenschaft und Überzeugung, und die einzige echte Aufgabe, die bleibt, ist gut zusammenzuleben.',
    from: 'Fortschrittsgesellschaft',
    to: 'Langsamere Zukunft',
    rows: [
      ['Arbeiten, um Geld zu verdienen', 'Arbeiten aus Leidenschaft'],
      ['Nützlich heißt Steuern zahlen', 'Nützlich heißt füreinander da sein'],
      ['Ressourcen verbrauchen', 'Material im Kreislauf halten'],
      ['Immer mehr, immer schneller', 'Zeit für Muße, gemeinsam'],
    ],
    note: 'hochautomatisiert und trotzdem langsam',
  },
  ours: {
    label: 'Was uns bleibt',
    title: 'Wir sind natürliche Intelligenzen, und wir alle wollen',
    mark: 'mitreden.',
    body: 'KI kann schreiben, rechnen und gestalten. Was sie nicht für uns haben kann, ist unsere Meinung und unser eigener Geschmack. Jede und jeder von uns sieht die Welt ein wenig anders und will gehört werden. Veränderung entsteht, wenn genug dieser Stimmen zusammenkommen. Jede Stimme hereinzuholen, dafür ist das Office gebaut.',
    voices: [
      ['Marlon', 'Folie 4 kann raus.'],
      ['Gesa', 'Fang mit dem Warum an.'],
      ['Lara', 'Das Ende ist stark!'],
      ['Paul', 'Woher kommt das?'],
      ['Anna', 'Ich sehe das anders.'],
      ['Du', 'So sehe ich es.'],
    ],
  },
  matters: {
    label: 'Warum das zählt',
    title: 'Gemeinsame Arbeit ist ein',
    mark: 'Beschleuniger.',
    body: 'Pläne, Konzepte und Visionen reisen auf Folien, in Dokumenten und in Zahlen: in der Beratung, in Unternehmen, in Klassenzimmern, in jedem Pitch. Je schneller eine Vision verstanden wird, desto schneller sind Menschen dabei. Und je schneller Menschen dabei sind, desto schneller kann sich die Welt verändern.',
    chain: ['Eine Idee', 'Verstanden', 'Dabei', 'Veränderung'],
    note: 'schneller',
  },
  evil: {
    label: 'Das notwendige Übel',
    title: 'Niemand liebt',
    mark: 'Büroarbeit.',
    body: 'Du arbeitest wochenlang an etwas. Dann kommt der Teil, vor dem sich alle drücken: alles in eine Präsentation, einen Bericht, eine Tabelle zu pressen. Es fühlt sich an wie Extraarbeit nach der eigentlichen Arbeit. Und ehrlich gesagt stimmt das auch ein bisschen.',
    you: 'Du',
    chat: [
      ['23:48', 'Recherche ist fertig. Jetzt muss ich das alles noch in Folien packen…'],
      ['23:52', 'Liest das überhaupt jemand?'],
    ],
  },
  need: {
    label: 'Warum wir sie trotzdem brauchen',
    title: 'Aber gute Arbeit',
    mark: 'bewegt Menschen.',
    body: 'Wir brauchen sie trotzdem. Um weiterzugeben, was wir wissen, um einer Rednerin Rückhalt zu geben, um zu zeigen, dass die Zahlen stimmen. Die Aufgabe ist jedes Mal dieselbe: eine Idee zu anderen Menschen bringen.',
    cards: [
      ['Überzeugen', 'Menschen in wenigen Minuten für eine Idee gewinnen.'],
      ['Erklären', 'Aufschreiben, damit andere darauf aufbauen können.'],
      ['Belegen', 'Zahlen, die zeigen, woher sie kommen.'],
      ['Aufbewahren', 'Alles an einem Ort, für alle, die es brauchen.'],
    ],
    say: 'Gut gemacht kommt eine Idee',
    sayMark: 'viel besser an.',
    note: 'Das ist der Kern',
  },
  together: {
    label: 'Also bauen wir sie gemeinsam',
    title: 'Gemacht, wie sie geteilt wird:',
    mark: 'gemeinsam.',
    body: 'Eine Präsentation, ein Bericht oder ein Plan soll Menschen informieren und mitnehmen. Genauso sollte auch das Erstellen funktionieren. Deshalb ist das ganze Office Multiplayer: alle an derselben Datei, live, zur selben Zeit.',
  },
  ai: {
    label: 'Und mit KI',
    title: 'Jeder Kommentar ist ein',
    mark: 'eigener Agent.',
    body: 'Andere Werkzeuge schrauben einen Chat an die Seite und nennen das KI. Hier lebt die KI dort, wo das Feedback ist: Jeder Thread kann zu einem Agenten werden, der wie eine weitere Kollegin ins Team kommt. Die KI macht die Arbeit, Menschen bringen ihre Meinung ein. Die langsamere Zukunft im Kleinen.',
    elsewhere: ['Anderswo', 'Ein Chat, an die Seite geschraubt'],
    here: ['The Office', 'Jeder Thread ist ein eigener Agent'],
  },
  short: {
    label: 'Kurz gesagt',
    lines: [
      'Visionen vermitteln.',
      'Die Gesellschaft beschleunigen.',
      'Eine langsamere Zukunft bauen.',
    ],
    last: 'Die Welt zu einem',
    mark: 'besseren Ort machen.',
    sign: 'Gründer',
  },
  road: {
    label: 'Das Office',
    title: 'Wo wir stehen.',
    sub: 'Eine App nach der anderen, jede fertig, bevor die nächste kommt.',
  },
};

const fr: Vision = {
  metaTitle: 'Vision | The Office',
  metaDescription:
    'Accélérer le progrès social, construire un avenir plus lent : pourquoi The Office existe et pourquoi les personnes et l’IA travaillent sur la même chose.',
  eyebrow: 'Notre mission',
  title: ['Accélérer le progrès social.', 'Construire un avenir plus lent.'],
  sub: 'Cela ressemble à une contradiction. C’est le plan : plus les bonnes idées circulent vite, plus tôt nous arrivons dans un monde avec plus de temps les uns pour les autres. C’est le fil que suit l’office.',
  future: {
    label: 'Un avenir plus lent',
    title: 'Ce que les machines ne peuvent pas nous prendre :',
    mark: 'les autres.',
    body: 'L’IA fait déjà une grande partie de ce qui se passe devant un écran, et les robots se chargeront de presque tout le reste. Un emploi n’a alors plus à être le moyen de gagner de l’argent à dépenser. Nous faisons ce que nous faisons par passion et par conviction, et la seule vraie tâche qui reste est de bien vivre ensemble.',
    from: 'Société du progrès',
    to: 'Avenir plus lent',
    rows: [
      ['Travailler pour gagner sa vie', 'Travailler par passion'],
      ['Être utile, c’est payer des impôts', 'Être utile, c’est prendre soin des autres'],
      ['Épuiser les ressources', 'Garder les matériaux en boucle'],
      ['Toujours plus, toujours plus vite', 'Du temps libre, ensemble'],
    ],
    note: 'très automatisé, et pourtant lent',
  },
  ours: {
    label: 'Ce qui reste à nous',
    title: 'Nous sommes des intelligences naturelles, et nous voulons tous',
    mark: 'avoir notre mot.',
    body: 'L’IA peut écrire, calculer et concevoir. Ce qu’elle ne peut pas avoir à notre place, c’est notre avis et notre goût. Chacun de nous voit le monde un peu différemment et veut être entendu. Le changement arrive quand assez de ces voix se rejoignent. Faire entrer chaque voix, c’est pour cela que l’office est construit.',
    voices: [
      ['Marlon', 'La diapo 4 peut partir.'],
      ['Gesa', 'Commence par le pourquoi.'],
      ['Lara', 'J’adore la fin !'],
      ['Paul', 'D’où vient ceci ?'],
      ['Anna', 'Je le vois autrement.'],
      ['Vous', 'Voici mon avis.'],
    ],
  },
  matters: {
    label: 'Pourquoi c’est important',
    title: 'Le travail partagé est un',
    mark: 'accélérateur.',
    body: 'Les plans, les concepts et les visions voyagent sur des diapositives, dans des documents et dans des chiffres : dans le conseil, dans les entreprises, dans les salles de classe, dans chaque pitch. Plus une vision est comprise vite, plus vite les gens la rejoignent. Et plus vite les gens la rejoignent, plus vite le monde peut changer.',
    chain: ['Une idée', 'Comprise', 'À bord', 'Changement'],
    note: 'plus vite',
  },
  evil: {
    label: 'Le mal nécessaire',
    title: 'Personne n’aime',
    mark: 'la bureautique.',
    body: 'Vous passez des semaines à élaborer quelque chose. Puis vient la partie que tout le monde redoute : tout faire tenir dans une présentation, un rapport, un tableau. On dirait du travail en plus du vrai travail. Et honnêtement, c’est un peu vrai.',
    you: 'Vous',
    chat: [
      ['23:48', 'La recherche est finie. Il me reste à mettre tout cela en diapositives…'],
      ['23:52', 'Est-ce que quelqu’un lit ça ?'],
    ],
  },
  need: {
    label: 'Pourquoi il en faut quand même',
    title: 'Mais un bon travail',
    mark: 'touche les gens.',
    body: 'Il en faut quand même. Pour transmettre ce que nous savons, pour donner un appui à celui qui parle, pour montrer que les chiffres tiennent. La tâche est chaque fois la même : faire passer une idée à d’autres personnes.',
    cards: [
      ['Convaincre', 'Gagner des gens à une idée en quelques minutes.'],
      ['Expliquer', 'L’écrire pour que d’autres puissent s’appuyer dessus.'],
      ['Prouver', 'Des chiffres qui montrent d’où ils viennent.'],
      ['Garder', 'Tout au même endroit, pour tous ceux qui en ont besoin.'],
    ],
    say: 'Bien faite, une idée',
    sayMark: 'passe bien mieux.',
    note: 'C’est l’essentiel',
  },
  together: {
    label: 'Alors nous le faisons ensemble',
    title: 'Fait comme on le partage :',
    mark: 'ensemble.',
    body: 'Une présentation, un rapport ou un plan existe pour informer les gens et les embarquer. Sa création devrait fonctionner exactement de la même façon. C’est pourquoi tout l’office est multijoueur : tout le monde sur le même fichier, en direct, au même moment.',
  },
  ai: {
    label: 'Et avec l’IA',
    title: 'Chaque commentaire est',
    mark: 'son propre agent.',
    body: 'D’autres outils vissent un chat sur le côté et appellent cela de l’IA. Ici, l’IA vit là où se trouvent les retours : chaque fil peut devenir un agent qui rejoint l’équipe comme une collègue de plus. L’IA fait le travail, les personnes apportent leur avis. L’avenir plus lent, en miniature.',
    elsewhere: ['Ailleurs', 'Un chat vissé sur le côté'],
    here: ['The Office', 'Chaque fil est son propre agent'],
  },
  short: {
    label: 'En bref',
    lines: ['Transmettre des visions.', 'Accélérer la société.', 'Construire un avenir plus lent.'],
    last: 'Rendre le monde',
    mark: 'meilleur.',
    sign: 'Fondateur',
  },
  road: {
    label: 'L’office',
    title: 'Où nous en sommes.',
    sub: 'Une app après l’autre, chacune terminée avant la suivante.',
  },
};

export const VISION = { en, de, fr } satisfies Record<'en' | 'de' | 'fr', Vision>;
