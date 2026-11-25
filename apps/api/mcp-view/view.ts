/**
 * The page an AI app (Claude, ChatGPT …) shows for `show_presentation` – an MCP App
 * (`text/html;profile=mcp-app`) that renders the tool's A2UI messages with A2UI's Lit renderer.
 *
 * It talks to the host over postMessage JSON-RPC itself (the `@modelcontextprotocol/ext-apps`
 * package wants MCP SDK 2 and zod 4): `ui/initialize` → `ui/notifications/initialized`, then the
 * host sends `ui/notifications/tool-result`. The slide's picture comes as the result's `image`
 * block (the model sees it as a picture, not as text) and goes into the data model as a data URL.
 *
 * Built into one inline HTML file by `build.ts` – the host's sandbox loads nothing from outside.
 */
import '@a2ui/lit';
import { MessageProcessor, type ProcessableMessagePayload } from '@a2ui/web_core';
import { basicCatalog } from '@a2ui/web_core/catalogs/basic/v1';
import { setMarkdownRenderer } from '@a2ui/web_core/universal';

const PROTOCOL_VERSION = '2026-01-26';
const A2UI_MIME = 'application/a2ui+json';

type Content =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; mimeType?: string; text?: string } };
interface ToolResult {
  content?: Content[];
  isError?: boolean;
}

// The card's texts need headings and lines only – no markdown library in the bundle.
const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
setMarkdownRenderer((value: string) =>
  value
    .split('\n')
    .filter((line) => line.trim())
    .map((line) =>
      line.startsWith('## ')
        ? `<h2 style="margin:0">${escape(line.slice(3))}</h2>`
        : line.startsWith('-# ')
          ? // A quiet line under a heading (fg-subtle) – A2UI's caption is italic.
            `<p style="margin:0;font-size:13px;color:rgb(255 255 255 / 0.5)">${escape(line.slice(3))}</p>`
          : `<p style="margin:0">${escape(line)}</p>`,
    )
    .join(''),
);

// ── JSON-RPC to the host ─────────────────────────────────────────────────────

let nextId = 1;
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function request(method: string, params: object): Promise<unknown> {
  const id = nextId++;
  window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
  return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
}

function notify(method: string, params: object = {}) {
  window.parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const message = event.data as {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    error?: { message?: string };
  };
  if (!message || typeof message !== 'object') return;
  if (message.id !== undefined && !message.method) {
    const pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message ?? 'Fehler'));
    else pending.resolve(message.result);
    return;
  }
  if (message.method === 'ui/notifications/tool-result') show(message.params as ToolResult);
  else if (message.id !== undefined)
    // A request we do not serve (e.g. teardown asks): answer so the host does not wait.
    window.parent.postMessage({ jsonrpc: '2.0', id: message.id, result: {} }, '*');
});

// ── Rendering ────────────────────────────────────────────────────────────────

const root = document.getElementById('root')!;
let processor = makeProcessor();
let presentation: { id: string; title: string } | null = null;

function makeProcessor() {
  const made = new MessageProcessor([basicCatalog], (action) => onAction(action));
  made.onSurfaceCreated((surface) => {
    const element = document.createElement('a2ui-surface') as HTMLElement & { surface: unknown };
    element.surface = surface;
    root.replaceChildren(element);
  });
  return made;
}

function show(result: ToolResult | undefined) {
  const content = result?.content ?? [];
  const a2ui = content.find(
    (part): part is Extract<Content, { type: 'resource' }> =>
      part.type === 'resource' && part.resource.mimeType === A2UI_MIME,
  );
  if (!a2ui?.resource.text) {
    const said = content.find((part) => part.type === 'text') as { text: string } | undefined;
    root.textContent = result?.isError ? (said?.text ?? 'Fehler') : '';
    sizeChanged();
    return;
  }
  const messages = JSON.parse(a2ui.resource.text) as Array<Record<string, unknown>>;
  const picture = content.find((part) => part.type === 'image') as
    Extract<Content, { type: 'image' }> | undefined;
  const surfaceId = surfaceOf(messages);
  presentation = presentationOf(messages) ?? presentation;
  // A new card replaces the old one (another slide): a fresh processor, no surface twice.
  processor = makeProcessor();
  processor.processMessages(messages as unknown as ProcessableMessagePayload);
  if (picture && surfaceId)
    processor.processMessages([
      {
        version: '1.0',
        updateDataModel: {
          surfaceId,
          path: '/picture',
          value: `data:${picture.mimeType};base64,${picture.data}`,
        },
      },
    ] as unknown as ProcessableMessagePayload);
  requestAnimationFrame(sizeChanged);
}

const surfaceOf = (messages: Array<Record<string, unknown>>) =>
  (messages.find((m) => m.createSurface)?.createSurface as { surfaceId?: string } | undefined)
    ?.surfaceId;

const presentationOf = (messages: Array<Record<string, unknown>>) => {
  const model = messages.find((m) => m.updateDataModel)?.updateDataModel as
    { value?: { presentation?: string; title?: string } } | undefined;
  const id = model?.value?.presentation;
  return id ? { id, title: model?.value?.title ?? '' } : null;
};

async function onAction(action: { name: string; context: Record<string, unknown> }) {
  if (action.name === 'open_link' && typeof action.context.url === 'string') {
    await request('ui/open-link', { url: action.context.url });
    return;
  }
  if (action.name === 'show_slide' && presentation) {
    const slide = Number(action.context.slide);
    try {
      show(
        (await request('tools/call', {
          name: 'show_presentation',
          arguments: { presentation: presentation.id, slide },
        })) as ToolResult,
      );
    } catch {
      // A host that lets no page call tools (not every organisation has it): ask in the chat.
      await request('ui/message', {
        role: 'user',
        content: [{ type: 'text', text: `Zeig mir Folie ${slide} von „${presentation.title}“.` }],
      }).catch(() => undefined);
    }
  }
}

// ── Host frame ───────────────────────────────────────────────────────────────

let lastHeight = 0;
function sizeChanged() {
  const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
  if (height === lastHeight) return;
  lastHeight = height;
  notify('ui/notifications/size-changed', { height });
}
new ResizeObserver(sizeChanged).observe(document.documentElement);

// Slider is dark only (the slide the one bright thing) – the host's theme changes nothing here.
await request('ui/initialize', {
  appInfo: { name: 'Slider', version: '1.0.0' },
  appCapabilities: { availableDisplayModes: ['inline'] },
  protocolVersion: PROTOCOL_VERSION,
});
notify('ui/notifications/initialized');
