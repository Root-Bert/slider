import { gunzipSync } from 'node:zlib';
import type { AppDeps } from '../deps';
import {
  deckLink,
  findDeck,
  runMcpTool,
  slidesOf,
  toolFailure,
  type McpCaller,
  type McpTool,
  type McpToolResult,
} from './mcp';
import { MCP_VIEW_HTML_GZ } from './mcp-view-html';

/**
 * A presentation as a card in the AI app's chat – an MCP App (`ui://` page, ext-apps
 * 2026-01-26) that renders A2UI 1.0 messages with A2UI's basic catalog. A probe: only AI apps
 * over `/api/mcp` get it (Slider's own chats and agents have no such frame), so it stays out of
 * `APP_TOOLS`. The page is built from `apps/api/mcp-view/` (`bun apps/api/mcp-view/build.ts`).
 */

export const MCP_VIEW_URI = 'ui://slider/presentation.html';
export const MCP_VIEW_MIME = 'text/html;profile=mcp-app';
const A2UI_MIME = 'application/a2ui+json';
const CATALOG = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
const SURFACE = 'slider-presentation';

export const SHOW_PRESENTATION: McpTool & { _meta: Record<string, unknown> } = {
  name: 'show_presentation',
  title: 'Show a presentation',
  description:
    'Shows a presentation to the person as a card in this chat: a slide as it looks, its title, how many slides, buttons to page through and to open it in Slider. Use it when the person wants to see a presentation or a slide; to read one use get_presentation.',
  inputSchema: {
    type: 'object',
    properties: {
      presentation: {
        type: 'string',
        description:
          'The presentation: its id (list_presentations), its Slider link, or its exact title.',
      },
      slide: {
        type: 'integer',
        minimum: 1,
        description: 'The slide to show (1 = the first, the default).',
      },
    },
    required: ['presentation'],
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  // The nested key is the spec's, the flat one what hosts read before it.
  _meta: { ui: { resourceUri: MCP_VIEW_URI }, 'ui/resourceUri': MCP_VIEW_URI },
};

export const MCP_VIEW_RESOURCE = {
  uri: MCP_VIEW_URI,
  name: 'presentation',
  title: 'Slider presentation',
  description: 'A presentation as a card (show_presentation).',
  mimeType: MCP_VIEW_MIME,
};

let html: string | null = null;
/** The page, unpacked once (A2UI brings zod along: ~500 KB). */
export function mcpViewHtml(): string {
  html ??= gunzipSync(Buffer.from(MCP_VIEW_HTML_GZ, 'base64')).toString('utf8');
  return html;
}

export function readMcpView() {
  return {
    contents: [
      {
        uri: MCP_VIEW_URI,
        mimeType: MCP_VIEW_MIME,
        text: mcpViewHtml(),
        // Its own border and background: Slider is dark, the host's chat may not be.
        _meta: { ui: { prefersBorder: false } },
      },
    ],
  };
}

const changedOn = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Europe/Berlin',
});

type Component = Record<string, unknown> & { id: string; component: string };

/** The card's A2UI messages: the slide's picture comes beside them, as the result's image. */
export function presentationCard(card: {
  id: string;
  title: string;
  slide: number;
  slides: number;
  slideTitle: string | null;
  changed: Date;
  link: string;
}) {
  const label = (id: string, text: string): Component => ({ id, component: 'Text', text });
  const button = (
    id: string,
    text: string,
    action: { name: string; context: Record<string, unknown> },
    variant: 'default' | 'primary' = 'default',
  ): Component[] => [
    { id, component: 'Button', child: `${id}_label`, variant, action: { event: action } },
    label(`${id}_label`, text),
  ];
  const paging = [
    ...(card.slide > 1
      ? button('back', 'Zurück', { name: 'show_slide', context: { slide: card.slide - 1 } })
      : []),
    ...(card.slide < card.slides
      ? button('next', 'Weiter', { name: 'show_slide', context: { slide: card.slide + 1 } })
      : []),
  ];
  const open = button(
    'open',
    'In Slider öffnen',
    { name: 'open_link', context: { url: card.link } },
    'primary',
  );
  const buttons = (list: Component[]) =>
    list.filter((each) => each.component === 'Button').map((each) => each.id);
  const meta =
    card.slides > 0
      ? `Folie ${card.slide} von ${card.slides} | geändert am ${changedOn.format(card.changed)}`
      : `Noch keine Folien | geändert am ${changedOn.format(card.changed)}`;
  const components: Component[] = [
    { id: 'root', component: 'Card', child: 'body' },
    {
      id: 'body',
      component: 'Column',
      children: card.slides > 0 ? ['head', 'picture', 'actions'] : ['head', 'actions'],
    },
    // Title and the quiet line under it in one text (`-# `: the page's renderer).
    label('head', `## ${card.title}\n-# ${meta}`),
    {
      id: 'picture',
      component: 'Image',
      url: { '@path': '/picture' },
      description: { '@path': '/caption' },
      fit: 'contain',
      variant: 'largeFeature',
    },
    // Paging on the left, „In Slider öffnen“ on the right.
    {
      id: 'actions',
      component: 'Row',
      justify: 'spaceBetween',
      align: 'center',
      children: ['paging', ...buttons(open)],
    },
    { id: 'paging', component: 'Row', align: 'center', children: buttons(paging) },
    ...paging,
    ...open,
  ];
  return [
    { version: '1.0', createSurface: { surfaceId: SURFACE, catalogId: CATALOG } },
    { version: '1.0', updateComponents: { surfaceId: SURFACE, components } },
    {
      version: '1.0',
      updateDataModel: {
        surfaceId: SURFACE,
        path: '/',
        value: {
          presentation: card.id,
          title: card.title,
          caption: card.slides > 0 ? card.slideTitle?.trim() || `Folie ${card.slide}` : '',
          picture: '',
        },
      },
    },
  ];
}

/** `show_presentation`: the slide's picture and text as `view_slide` gives them, plus the card. */
export async function showPresentation(
  deps: AppDeps,
  caller: McpCaller,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  try {
    const deck = await findDeck(deps, caller, args.presentation);
    const slides = await slidesOf(deps, deck);
    const wanted = typeof args.slide === 'number' && Number.isInteger(args.slide) ? args.slide : 1;
    const number = Math.min(Math.max(1, wanted), Math.max(1, slides.length));
    const viewed =
      slides.length > 0
        ? await runMcpTool(deps, caller, 'view_slide', { presentation: deck.id, slide: number })
        : null;
    if (viewed?.isError) return viewed;
    const messages = presentationCard({
      id: deck.id,
      title: deck.title,
      slide: number,
      slides: slides.length,
      slideTitle: slides[number - 1]?.title ?? null,
      changed: deck.updatedAt,
      link:
        slides.length > 0
          ? deckLink(deps, deck.id, `?slide=${encodeURIComponent(slides[number - 1]!.id)}`)
          : deckLink(deps, deck.id),
    });
    const said =
      slides.length > 0
        ? `Shown to the person as a card: „${deck.title}“, slide ${number} of ${slides.length}.`
        : `Shown to the person as a card: „${deck.title}“, no slides yet.`;
    return {
      content: [
        { type: 'text', text: said },
        ...(viewed?.content ?? []),
        {
          type: 'resource',
          resource: {
            uri: `ui://slider/a2ui/${deck.id}/${number}`,
            mimeType: A2UI_MIME,
            text: JSON.stringify(messages),
          },
        },
      ],
    };
  } catch (error) {
    return toolFailure(deps, SHOW_PRESENTATION.name, error);
  }
}
