import type { DeckKind } from '@slider/shared';

/*
 * The build guide of each kind of deck the prompt on Folie 1 offers: the usual structure, the
 * tone and how much text a slide carries. The AI reads the one picked before it outlines; the
 * material and the description win where they say otherwise.
 */

export interface KindGuide {
  /** The kind in English, for the AI. */
  name: string;
  structure: string;
  tone: string;
  text: string;
}

export const KIND_GUIDES: Record<DeckKind, KindGuide> = {
  school: {
    name: 'a school presentation or student talk (Referat)',
    structure:
      'Title slide (topic, name, class or course, date) – Gliederung (agenda) – one or more slides per chapter, each with one clear point – a summary or Fazit – Quellen (sources: the material’s titles, authors, links) as the last slide.',
    tone: 'Clear and factual, explaining terms the class may not know; no marketing language.',
    text: 'A title and 3–5 short bullet points per slide, a picture or diagram where it explains; definitions and dates exact.',
  },
  pitch: {
    name: 'an investor pitch',
    structure:
      'Title (company, one-line promise) – Problem – Solution – Market (size, figures) – Product – Business model – Traction (figures, customers) – Competition – Team – Financials or plan – The ask (how much, for what) – contact.',
    tone: 'Confident, concrete, short sentences; every claim backed by a figure from the material where there is one.',
    text: 'Very little text: a headline that states the point and one big figure, a short list or a picture. Never a paragraph.',
  },
  consulting: {
    name: 'a consulting or strategy deck',
    structure:
      'Title – Executive summary (the answer first) – Situation and starting point – Analysis slides (one finding each, with data) – Options compared – Recommendation – Roadmap and next steps – Appendix if the material holds more detail.',
    tone: 'Analytical and precise; action titles – every title is a full sentence stating the slide’s finding (pyramid principle).',
    text: 'An action title, then evidence: a chart or table from the material’s figures, or 3–4 bullets; sources noted small at the bottom.',
  },
  brand: {
    name: 'a brand or company presentation',
    structure:
      'Title – Who we are (mission, vision) – What we do (offer) – How we work or what makes us different – Figures and facts – Customers or references – Team or locations – Contact.',
    tone: 'Warm and confident, in the company’s own voice; benefits for the audience over features.',
    text: 'Short headlines, little text, room for pictures (photos where they fit), figures large.',
  },
  sales: {
    name: 'a sales offer or proposal',
    structure:
      'Title (offer for the customer) – The customer’s situation and goals – Our solution – How it works or scope – Benefits and results – References – Prices or packages – Timeline – Next steps and contact.',
    tone: 'Customer-centred and persuasive, addressing the customer; concrete promises, no superlatives without proof.',
    text: 'Headlines that state the benefit, 3–4 bullets or a comparison table; prices and dates exactly as in the material.',
  },
  status: {
    name: 'a project status report',
    structure:
      'Title (project, period) – Summary with an overall status (on track, at risk, late) – Progress since the last report – Milestones and timeline – Figures (budget, KPIs) – Risks and issues with measures – Decisions needed – Next steps.',
    tone: 'Sober and factual; problems named plainly with what is done about them.',
    text: 'Compact: status signals, tables and short bullets; figures and dates exactly as in the material.',
  },
  training: {
    name: 'a training or workshop',
    structure:
      'Title – Goals of the session – Agenda – Modules, each: a concept, an example, an exercise or question – Summary of the key points – Further resources – Questions and feedback.',
    tone: 'Inviting and practical, addressing the participants; plain words, examples from their work.',
    text: 'One idea per slide, short bullets or steps, exercises clearly marked (time, task).',
  },
  keynote: {
    name: 'a talk or keynote',
    structure:
      'Title – A hook (a question, a story, a striking figure) – Three to five main ideas, each opened by a statement slide and supported by an example or figure – A closing slide with the one message to remember.',
    tone: 'Engaging and personal; strong statements, a narrative arc.',
    text: 'As little text as possible: one statement or one big figure per slide, large pictures; details belong in the speaker notes.',
  },
};

/** The guide of `kind` as the AI's first message gives it. */
export function kindBrief(kind: DeckKind): string {
  const guide = KIND_GUIDES[kind];
  return `The deck is ${guide.name}.\n- Usual structure: ${guide.structure}\n- Tone: ${guide.tone}\n- Text per slide: ${guide.text}`;
}
