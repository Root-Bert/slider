import type { DeckKind } from '@slider/shared';

/*
 * The build guide of each kind of deck the prompt on Folie 1 offers: the usual structure, the
 * tone, how much text a slide carries, how much it shows in pictures and how it moves. The AI
 * reads the one picked before it outlines; the material and the description win where they say
 * otherwise.
 */

export interface KindGuide {
  /** The kind in English, for the AI. */
  name: string;
  structure: string;
  tone: string;
  text: string;
  /** How much the deck shows in pictures, and which. */
  pictures: string;
  /** How it moves from slide to slide (transitions, morph). */
  motion: string;
}

export const KIND_GUIDES: Record<DeckKind, KindGuide> = {
  school: {
    name: 'a school presentation or student talk (Referat)',
    structure:
      'Title slide (topic, name, class or course, date) – Gliederung (agenda) – one or more slides per chapter, each with one clear point – a summary or Fazit – Quellen (sources: the material’s titles, authors, links) as the last slide.',
    tone: 'Clear and factual, explaining terms the class may not know; no marketing language.',
    text: 'A title and 3–5 short bullet points per slide, a picture or diagram where it explains; definitions and dates exact.',
    pictures:
      'Pictures carry the subject: a real photo or a generated picture of it on the title slide and on each chapter’s first slide, a picture or a drawn diagram (shapes, arrows) wherever it explains better than words – about every second slide. No decorative stock photos of people at desks.',
    motion:
      'Morph where the subject unfolds: from the whole thing to a detail of the same picture (zoomed and cropped), along a process or a timeline step by step, a diagram growing; a calm fade elsewhere. Entrances where they explain: a diagram’s parts one after another, the key fact rising in.',
  },
  pitch: {
    name: 'an investor pitch',
    structure:
      'Title (company, one-line promise) – Problem – Solution – Market (size, figures) – Product – Business model – Traction (figures, customers) – Competition – Team – Financials or plan – The ask (how much, for what) – contact.',
    tone: 'Confident, concrete, short sentences; every claim backed by a figure from the material where there is one.',
    text: 'Very little text: a headline that states the point and one big figure, a short list or a picture. Never a paragraph.',
    pictures:
      'Few, strong pictures: the product (screenshots or photos from the material, else a generated product scene), one picture that makes the problem felt; big figures instead of pictures elsewhere. Icons only for a row of features or the business model.',
    motion:
      'Morph for the moments that matter: the problem picture shrinking into the solution, the big figure growing, the product gliding from slide to slide; push or fade elsewhere – never a different transition per slide. Entrances for the punchline: the big figure zooming or rising in, the solution’s points after each other.',
  },
  consulting: {
    name: 'a consulting or strategy deck',
    structure:
      'Title – Executive summary (the answer first) – Situation and starting point – Analysis slides (one finding each, with data) – Options compared – Recommendation – Roadmap and next steps – Appendix if the material holds more detail.',
    tone: 'Analytical and precise; action titles – every title is a full sentence stating the slide’s finding (pyramid principle).',
    text: 'An action title, then evidence: a chart or table from the material’s figures, or 3–4 bullets; sources noted small at the bottom.',
    pictures:
      'No photos or decorative pictures – evidence instead: charts, tables, frameworks drawn with shapes (matrix, pyramid, process), a few small icons at most to tell options apart.',
    motion:
      'Mostly none or fade. Morph only to build an argument step by step on the same chart or framework: the next part highlighted, a row brought forward, the recommendation coming out of the matrix. Entrances at most to build a chart or framework part by part – nothing flying.',
  },
  brand: {
    name: 'a brand or company presentation',
    structure:
      'Title – Who we are (mission, vision) – What we do (offer) – How we work or what makes us different – Figures and facts – Customers or references – Team or locations – Contact.',
    tone: 'Warm and confident, in the company’s own voice; benefits for the audience over features.',
    text: 'Short headlines, little text, room for pictures (photos where they fit), figures large.',
    pictures:
      'Photography leads: large, full-bleed or cut into shapes, on most slides – the company’s own pictures from the material first, else stock photos or generated pictures in one consistent style (light, colour, mood). Figures large over or beside the pictures.',
    motion:
      'Morph between pictures and their crops (a photo full-bleed becoming a circle beside the text), the brand’s shape travelling across slides; fade elsewhere. Entrances quiet: pictures fading, a claim rising in.',
  },
  sales: {
    name: 'a sales offer or proposal',
    structure:
      'Title (offer for the customer) – The customer’s situation and goals – Our solution – How it works or scope – Benefits and results – References – Prices or packages – Timeline – Next steps and contact.',
    tone: 'Customer-centred and persuasive, addressing the customer; concrete promises, no superlatives without proof.',
    text: 'Headlines that state the benefit, 3–4 bullets or a comparison table; prices and dates exactly as in the material.',
    pictures:
      'The customer’s world in a few pictures (their industry, product or situation), icons for benefits or packages, the timeline drawn with shapes; references as logos from the material.',
    motion:
      'Fade, with morph for the timeline moving on and the chosen package coming forward. Entrances for the benefits one after another.',
  },
  status: {
    name: 'a project status report',
    structure:
      'Title (project, period) – Summary with an overall status (on track, at risk, late) – Progress since the last report – Milestones and timeline – Figures (budget, KPIs) – Risks and issues with measures – Decisions needed – Next steps.',
    tone: 'Sober and factual; problems named plainly with what is done about them.',
    text: 'Compact: status signals, tables and short bullets; figures and dates exactly as in the material.',
    pictures:
      'No photos. Status colours (green, amber, red) as small marks, a timeline or milestone bar drawn with shapes, tables and charts from the material; icons only as status signs.',
    motion:
      'None or fade – it is read, not performed. Morph only for the timeline moving to the current milestone. No entrances.',
  },
  training: {
    name: 'a training or workshop',
    structure:
      'Title – Goals of the session – Agenda – Modules, each: a concept, an example, an exercise or question – Summary of the key points – Further resources – Questions and feedback.',
    tone: 'Inviting and practical, addressing the participants; plain words, examples from their work.',
    text: 'One idea per slide, short bullets or steps, exercises clearly marked (time, task).',
    pictures:
      'A picture or illustration opening each module (generated in one style across the deck, or photos), icons for steps and exercises, diagrams drawn with shapes for concepts.',
    motion:
      'Morph to build a concept step by step (one part after another added to the same diagram) and between a module’s opener and its content; fade elsewhere. Entrances for the steps of an exercise or a process, one after another.',
  },
  keynote: {
    name: 'a talk or keynote',
    structure:
      'Title – A hook (a question, a story, a striking figure) – Three to five main ideas, each opened by a statement slide and supported by an example or figure – A closing slide with the one message to remember.',
    tone: 'Engaging and personal; strong statements, a narrative arc.',
    text: 'As little text as possible: one statement or one big figure per slide, large pictures; details belong in the speaker notes.',
    pictures:
      'Full-bleed photos or generated pictures on most slides, the statement set large over them (with a dark overlay or a calm area of the picture for contrast); one big figure alone on some slides. One picture style through the whole talk.',
    motion:
      'Morph is the signature: elements and pictures travel, grow and change from slide to slide, the closing slide picks up the opening’s picture. No slide without a transition; fade where nothing travels. Entrances for the key lines and figures rising in, pictures fading – the speaker’s rhythm.',
  },
};

/** The guide of `kind` as the AI's first message gives it. */
export function kindBrief(kind: DeckKind): string {
  const guide = KIND_GUIDES[kind];
  return `The deck is ${guide.name}.\n- Usual structure: ${guide.structure}\n- Tone: ${guide.tone}\n- Text per slide: ${guide.text}\n- Pictures: ${guide.pictures}\n- Motion: ${guide.motion}`;
}
