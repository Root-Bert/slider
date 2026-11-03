/**
 * The website's words in English – the shape every other language follows (`Dict`). Blog posts
 * and legal pages are not here: posts stay English, Impressum and Datenschutz German.
 */
export const en = {
  meta: {
    title: 'Slider | Presentations everyone gets a say in',
    description:
      'Slider is the presentation tool where everyone gets a say. Show your slides, collect opinions right on them and turn them into the better version, together in the browser. Open source, hosted in the EU.',
    pricingTitle: 'Pricing',
    pricingDescription:
      'Priced per workspace, never per seat: free for small teams, €79 a month for up to 100 people, €249 with AI included, free when you host it yourself.',
  },
  nav: {
    home: 'Home',
    pricing: 'Pricing',
    blog: 'Blog',
    login: 'Log in',
    start: 'Start for free',
    menu: 'Menu',
    skip: 'Skip to content',
    language: 'Language',
  },
  /** The hero: one slide, and the visitor asked for their opinion on it. */
  opinion: {
    kind: 'Slider is the presentation tool where everyone gets a say.',
    askLead: 'What do you think of',
    askMark: 'this slide?',
    doneLead: 'That is how',
    doneMark: 'Slider works.',
    doneSub: 'Everyone says what they think right on the slide. You turn it into the better version. In the browser, open source and hosted in the EU.',
    you: 'You',
    where: 'Click the slide to pick a spot.',
    send: 'Send',
    working: 'The AI is working your comment in',
    revised: 'The AI revised the slide',
    version: 'Version 2',
    again: 'Again',
    now: 'just now',
    slide: {
      kicker: 'Proposal',
      title: 'Proposal: an office dog',
      bullets: [
        'Studies suggest that dogs in the office can reduce stress.',
        'A dog makes sure we take regular breaks and get some fresh air.',
        'We share the cost of food and the vet as a team.',
        'Allergies and fears are checked beforehand in a short survey.',
        'Trial period: three months, then we all vote on it.',
      ],
      source: 'Team meeting, item 4',
    },
    /** The slides the hero can show, one picked at random per visit, each with what people said and the better version. */
    scenes: {
      dog: {
        people: [
          { by: 'Lara', text: 'Phew, that is a lot of text.' },
          { by: 'Paul', text: 'And where is the dog?!' },
        ],
        examples: ['Way too much text.', 'The dog needs to be bigger!', 'What are you actually asking for?'],
        chips: ['Too much text', 'Bigger dog!', 'I’m in'],
        statement: 'Let’s get an office dog.',
        reasons: ['Less stress', 'More breaks', 'Try it for 3 months'],
        next: 'Trial from 1 December',
      },
      strategy: {
        people: [
          { by: 'Ingrid', text: 'Which three?' },
          { by: 'Marcel', text: 'All I see is bubbles.' },
        ],
        examples: ['What am I supposed to see here?', 'Put the recommendation on top.', 'Too many colours.'],
        chips: ['Too busy', 'Recommendation first', 'Convinced'],
        statement: 'Three products bring 80 % of the value.',
        reasons: ['One message', 'Only three bubbles', 'Recommendation on top'],
        next: 'Sell Contract Services',
      },
      lecture: {
        people: [
          { by: 'Benni', text: 'What is the point?' },
          { by: 'Anna', text: 'The formulas are tiny.' },
        ],
        examples: ['Picture first, then the formula.', 'What should I remember?', 'Bigger text, please.'],
        chips: ['Formulas too small', 'The point?', 'Clearly explained'],
        statement: 'More public spending raises interest rates.',
        reasons: ['One sentence', 'Big graph', 'Formula after'],
        next: 'The curve shifts right',
      },
      finance: {
        people: [
          { by: 'Albert', text: 'What is the message?' },
          { by: 'Gesa', text: 'Nobody reads that table.' },
        ],
        examples: ['Too much going on on the right.', 'Just tell me the number.', 'Where does the +22 come from?'],
        chips: ['Too many numbers', 'The message?', 'Looks good'],
        statement: 'Prices beat the energy costs.',
        reasons: ['One number', 'Big bridge', 'Table in the appendix'],
        next: 'EBITDA up from 380 to 412 M€',
      },
      build: {
        people: [
          { by: 'Marlon', text: 'Where is the problem?' },
          { by: 'Rose', text: 'The plan is too small.' },
        ],
        examples: ['What changes for us?', 'Show only the kitchen.', 'When do we move?'],
        chips: ['Plan too small', 'What changes?', 'Fine by me'],
        statement: 'The kitchen moves into the core.',
        reasons: ['One room', 'Big plan', 'Clear date'],
        next: 'Move in March',
      },
      project: {
        people: [
          { by: 'Thomas', text: 'Why does go-live slip?' },
          { by: 'Lara', text: 'Too many bars.' },
        ],
        examples: ['What do you need from us?', 'Only the red matters.', 'Who decides this?'],
        chips: ['Too many bars', 'What do you need?', 'Got it'],
        statement: 'Data migration is holding up go‑live.',
        reasons: ['One bottleneck', 'Only the red bars', 'Decision by Friday'],
        next: 'By Friday: 4 more people on the migration',
      },
      field: {
        people: [
          { by: 'Neven', text: 'What does that mean for us?' },
          { by: 'Finnja', text: 'The map is too colourful.' },
        ],
        examples: ['How much do we save?', 'Fewer colours, please.', 'Where exactly is zone C?'],
        chips: ['Too colourful', 'So what?', 'Strong'],
        statement: 'Less fertiliser, more yield.',
        reasons: ['0.6 t/ha more', '12 kg/ha less', 'Big map'],
        next: 'Fertilise every field this way next year',
      },
    },
    live: 'This page is live. Click anywhere and say what you think. Everyone here right now sees it.',
    end: 'Now ask everyone else.',
  },
  /** Questions, as a stack of slides you drag aside. */
  questions: {
    title: 'Questions?',
    hint: 'Drag the slide aside.',
    next: 'Next slide',
    prev: 'Previous slide',
    cards: [
      { by: 'Carolin', q: 'Do I need to install anything?', a: 'No. Slider runs in the browser. Send a link and everyone is in.' },
      { by: 'Anna', q: 'Can I bring my PowerPoint?', a: 'Yes. Open PowerPoint and ODF files, comment, edit and download them again.' },
      { by: 'Benni', q: 'What does the AI do, anyway?', a: 'It reads every comment and suggests the next version. You decide.' },
      { by: 'Thomas', q: 'What does it cost?', a: 'Nothing for small teams. After that one fixed price per workspace, never per head.' },
      { by: 'Gesa', q: 'Where does my data live?', a: 'In the EU, with no trackers and no ads. Or on your own server: Slider is open source.' },
      { by: 'Robert', q: 'And what do you think?', a: 'Click anywhere on this page and say it. Everyone here right now sees it.' },
    ],
  },
  /** Photo credits: „Foto von X auf Unsplash“. */
  photo: { by: 'Photo by', on: 'on' },
  cta: {
    title: 'Ready for your next presentation.',
    button: 'Start for free',
    pricing: 'See pricing',
  },
  footer: {
    tagline: 'Get your ideas across.',
    product: 'Product',
    run: 'Run it',
    company: 'Company',
    source: 'Source code',
    changelog: 'Changelog',
    contact: 'Contact',
  },
  pricing: {
    title: 'Priced per workspace, never per seat.',
    sub: 'Feedback works best when everyone can join. So bring the whole team.',
    monthly: 'per month',
    forever: 'forever',
    contract: 'per contract',
    custom: 'Custom',
    soon: 'Coming soon',
    popular: 'Most teams',
    over: 'Over a limit? Nothing gets deleted. You can still read, export and clean up, you just cannot create new things until you upgrade.',
    plans: {
      free: {
        pitch: 'For small teams. Free for as long as you like, no catch.',
        cta: 'Start for free',
        note: 'No payment method needed.',
        lead: 'Everything you need:',
        features: [
          'Unlimited presentations',
          'Up to 5 people',
          '2 GB storage',
          'All review tools',
          'Live collaboration',
        ],
      },
      team: {
        pitch: 'One flat price. With 100 people that is just €0.79 per person.',
        note: 'Start with Free today, upgrading comes soon.',
        lead: 'Everything in Free, plus:',
        features: [
          'Up to 100 people',
          '100 GB storage',
          'Invoices for your accounting',
        ],
      },
      ai: {
        pitch: 'AI built in. No own key, no tokens to manage, we run it for you.',
        note: 'Start with Free today, upgrading comes soon.',
        lead: 'Everything in Team, plus:',
        features: [
          'AI included, no own key',
          'Tokens covered by us',
          'Models kept up to date',
          'One bill, no extra AI costs',
        ],
      },
      enterprise: {
        pitch: 'For more than 100 people or your own requirements.',
        cta: 'Contact us',
        note: 'We set it up together with you.',
        lead: 'Everything in Team, plus:',
        features: [
          'More than 100 people',
          'Storage sized to your team',
          'Help with self-hosting',
          'Contract and invoice billing',
        ],
      },
    },
    selfTitle: 'Prefer your own server?',
    selfBody: 'Host Slider yourself for free, without limits. One docker compose up.',
    selfButton: 'View on GitHub',
    license: 'Open source under the EUPL-1.2. Need support or a commercial license?',
  },
  live: {
    comment: 'Comment',
    place: 'Click anywhere to comment, drag to mark an area',
    cancel: 'Esc to cancel',
    write: 'Write a comment…',
    reply: 'Reply…',
    send: 'Send',
    here: 'here',
    you: 'you',
    name: 'Your name',
    fades: 'Comments fade after 30 s unless someone answers.',
    full: 'Lots of people here right now. Comments are paused.',
    adjectives: ['Swift', 'Calm', 'Bright', 'Brave', 'Lucky', 'Quiet', 'Clever', 'Happy'],
    animals: ['Fox', 'Otter', 'Owl', 'Lynx', 'Heron', 'Panda', 'Beaver', 'Robin'],
    /** Adjective first (en, de) or after the animal (fr). */
    order: 'adjective-first' as 'adjective-first' | 'animal-first',
  },
};

type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? Widen<U>[]
    : T extends object
      ? { [K in keyof T]: Widen<T[K]> }
      : T;

export type Dict = Widen<typeof en>;
