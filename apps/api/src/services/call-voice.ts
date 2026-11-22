import type { CallOrder } from '@slider/shared';
import type { AppDeps } from '../deps';
import { streamChat, type AiConnection, type StreamTool } from './ai-providers';

/**
 * The agent's voice in a call: a small, fast model on the workspace's `live` key (Mistral, EU)
 * answers each turn as it is written – not a Cloud agent with its tools and rounds, which took
 * seconds. What needs tools or files becomes an order (`auftrag_vorschlagen`), sent as a Cloud
 * agent once someone in the call agrees – as before.
 */

/** Mistral's small model: first words ~0.2 s after the question (measured 2026-11-20). */
export const CALL_VOICE_MODEL = 'mistral-small-latest';
/** Two spoken sentences, and an order's text beside them. */
const MAX_TOKENS = 400;
/** What it remembers of the call's talk with it (questions and answers). */
export const VOICE_HISTORY = 16;

const ORDER_TOOL: StreamTool = {
  name: 'auftrag_vorschlagen',
  description:
    'Schlägt einen Auftrag vor, den ein Agent außerhalb des Gesprächs erledigt (recherchieren, eine Präsentation bauen, etwas schreiben, verschicken, Dateien lesen oder ändern). Losgeschickt wird er erst, wenn jemand im Anruf zustimmt.',
  parameters: {
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
          'Nur wenn dieser Auftrag einen wartenden ändert oder ergänzt: dessen bisheriger Titel. Er wird ersetzt, es bleibt ein Auftrag.',
      },
    },
    required: ['titel', 'auftrag'],
  },
};

const STATES: Record<CallOrder['state'], string> = {
  proposed: 'vorgeschlagen, wartet auf Zustimmung',
  running: 'läuft',
  done: 'fertig',
  failed: 'fehlgeschlagen',
};

/** Work an answer proposes; `replaces` names the waiting order it changes. */
export interface ProposedOrder {
  title: string;
  text: string;
  replaces?: string;
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
    'Im Gespräch liest du keine Dateien und erledigst nichts, das dauert. Soll etwas erledigt werden – recherchieren, eine Präsentation bauen, etwas schreiben oder verschicken, Dateien lesen oder ändern –, ruf auftrag_vorschlagen auf und frag in einem Satz, ob du es losschicken sollst. Erst wenn jemand zustimmt, geht es los. Erfinde nichts über Dateien oder den Workspace und keine Namen oder Einzelheiten für einen Auftrag, die niemand gesagt hat.',
    'Ändert oder ergänzt jemand einen Auftrag, der noch wartet (auch mit „ja, und …“), ruf auftrag_vorschlagen mit dem ganzen geänderten Auftrag, einem Titel, an dem man die Änderung sieht, und ersetzt: seinem bisherigen Titel auf – kein zweiter Auftrag – und frag noch einmal, ob du ihn so losschicken sollst.',
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
 * One answer of the call's voice, read as it is written (`onText`), and the orders it proposed.
 * Aborted with `signal` (someone talks over it, the call ends).
 */
export async function voiceAnswer(
  deps: Pick<AppDeps, 'config' | 'aiFetch'>,
  connection: AiConnection,
  turn: VoiceTurn,
  signal: AbortSignal,
  onText: (piece: string) => void,
): Promise<{ text: string; orders: ProposedOrder[] }> {
  const answer = await streamChat(
    deps,
    connection,
    {
      model: CALL_VOICE_MODEL,
      system: voiceSystem(turn),
      messages: [...turn.history, { role: 'user', content: turn.asked }],
      tools: [ORDER_TOOL],
      maxTokens: MAX_TOKENS,
    },
    signal,
    onText,
  );
  const orders: ProposedOrder[] = [];
  for (const call of answer.calls) {
    if (call.name !== ORDER_TOOL.name) continue;
    try {
      const args = JSON.parse(call.args) as {
        titel?: unknown;
        auftrag?: unknown;
        ersetzt?: unknown;
      };
      const title = typeof args.titel === 'string' ? args.titel.trim() : '';
      const text = typeof args.auftrag === 'string' ? args.auftrag.trim() : '';
      const replaces = typeof args.ersetzt === 'string' ? args.ersetzt.trim() : '';
      if (title && text)
        orders.push({
          title: title.slice(0, 120),
          text: text.slice(0, 4000),
          ...(replaces ? { replaces } : {}),
        });
    } catch {
      // Half a call is none.
    }
  }
  return { text: answer.text, orders };
}
