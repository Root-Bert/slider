import type { CallOrder } from '@slider/shared';
import type { AppDeps } from '../deps';
import { streamChat, type AiConnection, type StreamTool } from './ai-providers';

/**
 * The agent's voice in a call: a small, fast model on the workspace's `live` key (Mistral, EU)
 * answers each turn as it is written – not a Cloud agent with its tools and rounds, which took
 * seconds. It hears everything, like a colleague at the table, and chimes in where it helps. What
 * needs tools or files becomes an order: sent as a Cloud agent at once when someone says to do it
 * (`auftrag_ausfuehren`), else only listed (`auftrag_vormerken`) – dropped by voice too.
 */

/** Mistral's small model: first words ~0.2 s after the question (measured 2026-11-20). */
export const CALL_VOICE_MODEL = 'mistral-small-latest';
/** Two spoken sentences, and an order's text beside them. */
const MAX_TOKENS = 400;
/** What it remembers of the call's talk with it (questions and answers). */
export const VOICE_HISTORY = 16;

const ORDER_PARAMETERS = {
  type: 'object',
  properties: {
    titel: { type: 'string', description: 'Kurzer Titel, wenige Wörter.' },
    auftrag: {
      type: 'string',
      description: 'Der ganze Auftrag, so dass ein Agent ihn ohne das Gespräch versteht.',
    },
    ersetzt: {
      type: 'string',
      description:
        'Nur wenn dieser Auftrag einen vorgemerkten ändert oder ergänzt: dessen bisheriger Titel. Er wird ersetzt, es bleibt ein Auftrag.',
    },
  },
  required: ['titel', 'auftrag'],
};

/** Someone said to do it now: sent at once, with their rights. */
const DO_TOOL: StreamTool = {
  name: 'auftrag_ausfuehren',
  description:
    'Schickt sofort einen Agenten los, der die Arbeit außerhalb des Gesprächs erledigt (recherchieren, eine Präsentation bauen, etwas schreiben, verschicken, Dateien lesen oder ändern). Nur wenn dir jemand ausdrücklich sagt, dass es jetzt passieren soll („mach“, „schick“, „leg an“, „schreib“, „los“) – auch für einen vorgemerkten Auftrag (dann mit seinem Titel).',
  parameters: ORDER_PARAMETERS,
};

/** Work that came up, not asked for now: listed, nothing sent, nobody asked. */
const NOTE_TOOL: StreamTool = {
  name: 'auftrag_vormerken',
  description:
    'Merkt Arbeit für später vor, ohne sie loszuschicken: Sie steht dann still in der Liste „Aufträge“, wo man sie mit einem Klick losschickt. Für Arbeit, die im Gespräch aufkommt („wir müssten mal …“, „das sollte jemand …“), die dir aber niemand für jetzt aufgetragen hat.',
  parameters: ORDER_PARAMETERS,
};

const DROP_TOOL: StreamTool = {
  name: 'auftrag_verwerfen',
  description:
    'Verwirft einen vorgemerkten Auftrag, wenn jemand ihn nicht mehr will („lass das mit …“, „vergiss …“, „brauchen wir nicht“).',
  parameters: {
    type: 'object',
    properties: { titel: { type: 'string', description: 'Sein Titel aus der Liste.' } },
    required: ['titel'],
  },
};

/** What it answers when it has nothing to add to what it overheard. */
export const SILENT = '[still]';

const STATES: Record<CallOrder['state'], string> = {
  proposed: 'vorgemerkt, nicht losgeschickt',
  running: 'läuft',
  done: 'fertig',
  failed: 'fehlgeschlagen',
};

/**
 * Work an answer gives: `now` – sent at once (someone said to do it), else only listed;
 * `replaces` names the listed order it changes.
 */
export interface ProposedOrder {
  title: string;
  text: string;
  replaces?: string;
  now?: boolean;
}

/** What the voice is told of a waiting order's text – enough to change it. */
const ORDER_TEXT_TOLD = 400;

export interface VoiceTurn {
  /** As whom it speaks: the called or brought-in agent's name, or „Agent“. */
  name: string;
  /** The conversation's title; empty for one's own call with an agent. */
  title: string;
  people: string[];
  /** What the agent's own chat was about (one's call with it). */
  about: string | null;
  orders: readonly CallOrder[];
  /** It writes the notes after the call. */
  writesAlong: boolean;
  history: { role: 'user' | 'assistant'; content: string }[];
  /** This turn: what was said since it was last asked, and who asks what. */
  asked: string;
  /** Nobody spoke to it: it only chimes in where it helps, else stays {@link SILENT}. */
  overheard?: boolean;
}

/** The instructions and what it knows of the call – short: every token is waited for. */
export function voiceSystem(turn: VoiceTurn): string {
  const orders = turn.orders.map(
    (order) =>
      `- „${order.title}“: ${STATES[order.state]}${order.doing ? ` (${order.doing})` : ''}${
        order.state === 'proposed' ? ` – ${order.text.slice(0, ORDER_TEXT_TOLD)}` : ''
      }`,
  );
  return [
    `Du bist ${turn.name}, ein KI-Agent in Office, und telefonierst gerade. Was du schreibst, wird sofort vorgelesen.`,
    'Sprich wie am Telefon: Deutsch, per du und mit Vornamen, meist ein Satz, höchstens zwei kurze. Kein Markdown, keine Listen, keine Aufzählungszeichen, keine Emojis, keine Links. Zahlen als Ziffern.',
    'Sei herzlich und locker, wie ein netter Kollege am Telefon: Geh auf das ein, was gesagt wird, und antworte natürlich – ein Hallo grüßt du zurück, Smalltalk ist willkommen. Niemand muss dir eine Aufgabe geben: frag nicht danach, dräng nicht und sag nicht „Auftrag“, solange es um keinen geht. Hilfe bietest du höchstens beiläufig an, wenn es passt.',
    'Du bist wie ein Kollege mit am Tisch: Du hörst alles mit, nicht nur, was „Agent“ zu dir sagt. Wird ohne dich weitergeredet, kannst du dich einbringen, wenn du wirklich etwas beiträgst – eine Frage in die Runde, die du beantworten kannst, ein Fehler, ein wichtiger Hinweis. Sonst hältst du dich raus.',
    'Im Gespräch liest du keine Dateien und erledigst nichts, das dauert – das machen Agenten, die du losschickst. Sagt dir jemand, dass etwas jetzt erledigt werden soll, ruf auftrag_ausfuehren auf und sag in ein paar Worten, dass du dich drum kümmerst – frag nicht noch mal nach. Kommt Arbeit nur im Gespräch auf, ohne dass sie dir jemand für jetzt aufgetragen hat, ruf auftrag_vormerken auf und erwähn es höchstens in einem halben Satz – frag nicht, ob du es losschicken sollst. Im Zweifel vormerken. Will jemand einen vorgemerkten Auftrag nicht mehr, ruf auftrag_verwerfen auf. Erfinde nichts über Dateien oder den Workspace und keine Namen oder Einzelheiten für einen Auftrag, die niemand gesagt hat.',
    'Ändert oder ergänzt jemand einen vorgemerkten Auftrag, ruf auftrag_vormerken (oder, soll er jetzt los, auftrag_ausfuehren) mit dem ganzen geänderten Auftrag, einem Titel, an dem man die Änderung sieht, und ersetzt: seinem bisherigen Titel auf – kein zweiter Auftrag.',
    ...(turn.overheard
      ? [
          `Gerade hat niemand dich angesprochen. Hast du nichts beizutragen, antworte genau mit ${SILENT} und sonst nichts. Losschicken darfst du jetzt nichts – nur vormerken.`,
        ]
      : []),
    turn.title ? `Anruf in „${turn.title}“.` : 'Ein Anruf allein mit dir.',
    `Dabei: ${turn.people.join(', ') || 'niemand sonst'}.`,
    ...(turn.about ? [`Worum es in deinem Chat bisher ging: ${turn.about}`] : []),
    ...(turn.writesAlong
      ? ['Du schreibst in diesem Anruf mit und schreibst danach die Notizen in die Unterhaltung.']
      : []),
    ...(orders.length > 0 ? ['Aufträge aus diesem Anruf:', ...orders] : []),
  ].join('\n');
}

/**
 * One answer of the call's voice, read as it is written (`onText`), the orders it gave and the
 * titles of listed ones it dropped.
 * Aborted with `signal` (someone talks over it, the call ends).
 */
export async function voiceAnswer(
  deps: Pick<AppDeps, 'config' | 'aiFetch'>,
  connection: AiConnection,
  turn: VoiceTurn,
  signal: AbortSignal,
  onText: (piece: string) => void,
): Promise<{ text: string; orders: ProposedOrder[]; dropped: string[] }> {
  const answer = await streamChat(
    deps,
    connection,
    {
      model: CALL_VOICE_MODEL,
      system: voiceSystem(turn),
      messages: [...turn.history, { role: 'user', content: turn.asked }],
      tools: turn.overheard ? [NOTE_TOOL, DROP_TOOL] : [DO_TOOL, NOTE_TOOL, DROP_TOOL],
      maxTokens: MAX_TOKENS,
    },
    signal,
    onText,
  );
  const orders: ProposedOrder[] = [];
  const dropped: string[] = [];
  for (const call of answer.calls) {
    try {
      const args = JSON.parse(call.args) as {
        titel?: unknown;
        auftrag?: unknown;
        ersetzt?: unknown;
      };
      const title = typeof args.titel === 'string' ? args.titel.trim() : '';
      if (call.name === DROP_TOOL.name) {
        if (title) dropped.push(title);
        continue;
      }
      if (call.name !== DO_TOOL.name && call.name !== NOTE_TOOL.name) continue;
      const text = typeof args.auftrag === 'string' ? args.auftrag.trim() : '';
      const replaces = typeof args.ersetzt === 'string' ? args.ersetzt.trim() : '';
      if (title && text)
        orders.push({
          title: title.slice(0, 120),
          text: text.slice(0, 4000),
          ...(replaces ? { replaces } : {}),
          // Overheard, nothing is sent – whatever the model calls.
          ...(call.name === DO_TOOL.name && !turn.overheard ? { now: true } : {}),
        });
    } catch {
      // Half a call is none.
    }
  }
  return { text: answer.text, orders, dropped };
}
