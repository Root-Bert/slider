import {
  $applyNodeReplacement,
  $createParagraphNode,
  DecoratorNode,
  ElementNode,
  type EditorConfig,
  type RangeSelection,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import type { ReactNode } from 'react';
import { DiagramBlock } from '../components/DiagramBlock';
import { InkBlock } from '../components/InkBlock';
import { DiagramEmbed } from '../components/DiagramEmbed';
import { LiveBlock } from '../components/LiveBlock';
import { PageLinkChip } from '../components/PageLinkChip';
import { RawBlock } from '../components/RawBlock';

/*
 * The page's own nodes, beside Lexical's headings, lists, quotes, code and links:
 *
 * - `PageLinkNode` – a file, folder, area or presentation named in the text, written as the
 *   agents write it (`[[file:id|Name]]`): a page under this one is such a link on a line of its own.
 * - `LiveBlockNode` – what lives elsewhere, shown here as it is now (`{{dateien}}`, …).
 * - `DiagramEmbedNode` – a diagram from Cloud, drawn: its link alone on a line (`[[file:id|X.diagram]]`).
 * - `RawBlockNode` – what the page does not edit by hand (a table, HTML, a reference): shown,
 *   kept as it stands, typed as Markdown where one opens it.
 * - `CalloutNode` – a box with a tone (`> [!NOTE]`, as GitHub writes it).
 */

// ── Links ───────────────────────────────────────────────────────────────────

export const PAGE_LINK_KINDS = ['file', 'folder', 'area', 'presentation'] as const;
export type PageLinkKind = (typeof PAGE_LINK_KINDS)[number];

type SerializedPageLink = Spread<
  { kind: PageLinkKind; target: string; name: string },
  SerializedLexicalNode
>;

export class PageLinkNode extends DecoratorNode<ReactNode> {
  __kind: PageLinkKind;
  __target: string;
  __name: string;

  static override getType() {
    return 'page-link';
  }

  static override clone(node: PageLinkNode) {
    return new PageLinkNode(node.__kind, node.__target, node.__name, node.__key);
  }

  static override importJSON(json: SerializedPageLink) {
    return $createPageLinkNode(json.kind, json.target, json.name);
  }

  constructor(kind: PageLinkKind, target: string, name: string, key?: NodeKey) {
    super(key);
    this.__kind = kind;
    this.__target = target;
    this.__name = name;
  }

  override exportJSON(): SerializedPageLink {
    return {
      ...super.exportJSON(),
      kind: this.__kind,
      target: this.__target,
      name: this.__name,
    };
  }

  override createDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'page-link';
    return span;
  }

  override updateDOM() {
    return false;
  }

  override isInline() {
    return true;
  }

  override getTextContent() {
    return this.__name;
  }

  markdown() {
    return `[[${this.__kind}:${this.__target}|${this.__name}]]`;
  }

  override decorate(): ReactNode {
    return <PageLinkChip kind={this.__kind} target={this.__target} name={this.__name} />;
  }
}

export const $createPageLinkNode = (kind: PageLinkKind, target: string, name: string) =>
  $applyNodeReplacement(new PageLinkNode(kind, target, name));
export const $isPageLinkNode = (node: LexicalNode | null | undefined): node is PageLinkNode =>
  node instanceof PageLinkNode;

// ── Live blocks ─────────────────────────────────────────────────────────────

/** What a live block shows: the pages under this one, the files beside it, the area's … */
export const LIVE_KINDS = ['unterseiten', 'dateien', 'aufgaben', 'personen', 'termine'] as const;
export type LiveKind = (typeof LIVE_KINDS)[number];
export const isLiveKind = (value: string): value is LiveKind =>
  (LIVE_KINDS as readonly string[]).includes(value);

type SerializedLive = Spread<{ live: LiveKind }, SerializedLexicalNode>;

export class LiveBlockNode extends DecoratorNode<ReactNode> {
  __live: LiveKind;

  static override getType() {
    return 'page-live';
  }

  static override clone(node: LiveBlockNode) {
    return new LiveBlockNode(node.__live, node.__key);
  }

  static override importJSON(json: SerializedLive) {
    return $createLiveBlockNode(json.live);
  }

  constructor(live: LiveKind, key?: NodeKey) {
    super(key);
    this.__live = live;
  }

  override exportJSON(): SerializedLive {
    return { ...super.exportJSON(), live: this.__live };
  }

  override createDOM(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'page-block';
    return div;
  }

  override updateDOM() {
    return false;
  }

  override isInline() {
    return false;
  }

  markdown() {
    return `{{${this.__live}}}`;
  }

  override decorate(): ReactNode {
    return <LiveBlock live={this.__live} nodeKey={this.__key} />;
  }
}

export const $createLiveBlockNode = (live: LiveKind) =>
  $applyNodeReplacement(new LiveBlockNode(live));
export const $isLiveBlockNode = (node: LexicalNode | null | undefined): node is LiveBlockNode =>
  node instanceof LiveBlockNode;

// ── Diagrams ────────────────────────────────────────────────────────────────

type SerializedDiagramEmbed = Spread<{ target: string; name: string }, SerializedLexicalNode>;

/** What a link's name may not hold (it ends the link): kept out, as Cloud never names so. */
const linkName = (name: string) => name.replace(/[\]}\n]/g, ' ').trim();

/**
 * A diagram (a Cloud file) shown on the page as it is drawn: a link to it on a line of its own,
 * `[[file:id|Name.diagram]]` – what the agents write, read as a link anywhere else.
 */
export class DiagramEmbedNode extends DecoratorNode<ReactNode> {
  __target: string;
  __name: string;

  static override getType() {
    return 'page-diagram-embed';
  }

  static override clone(node: DiagramEmbedNode) {
    return new DiagramEmbedNode(node.__target, node.__name, node.__key);
  }

  static override importJSON(json: SerializedDiagramEmbed) {
    return $createDiagramEmbedNode(json.target, json.name);
  }

  constructor(target: string, name: string, key?: NodeKey) {
    super(key);
    this.__target = target;
    this.__name = name;
  }

  override exportJSON(): SerializedDiagramEmbed {
    return { ...super.exportJSON(), target: this.__target, name: this.__name };
  }

  override createDOM(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'page-block';
    return div;
  }

  override updateDOM() {
    return false;
  }

  override isInline() {
    return false;
  }

  override getTextContent() {
    return this.__name;
  }

  markdown() {
    return `[[file:${this.__target}|${linkName(this.__name)}]]`;
  }

  override decorate(): ReactNode {
    return <DiagramEmbed id={this.__target} name={this.__name} nodeKey={this.__key} />;
  }
}

export const $createDiagramEmbedNode = (target: string, name: string) =>
  $applyNodeReplacement(new DiagramEmbedNode(target, name));
export const $isDiagramEmbedNode = (
  node: LexicalNode | null | undefined,
): node is DiagramEmbedNode => node instanceof DiagramEmbedNode;

// ── Kept as written ─────────────────────────────────────────────────────────

/**
 * `table`: drawn as a table; `diagram`: a ```mermaid flowchart, drawn; `ink`: a drawing by hand
 * (```ink, `InkBlock`); `raw`: shown as written.
 */
export type RawKind = 'table' | 'diagram' | 'ink' | 'raw';

type SerializedRaw = Spread<{ text: string; raw: RawKind }, SerializedLexicalNode>;

export class RawBlockNode extends DecoratorNode<ReactNode> {
  __text: string;
  __raw: RawKind;

  static override getType() {
    return 'page-raw';
  }

  static override clone(node: RawBlockNode) {
    return new RawBlockNode(node.__text, node.__raw, node.__key);
  }

  static override importJSON(json: SerializedRaw) {
    return $createRawBlockNode(json.text, json.raw);
  }

  constructor(text: string, raw: RawKind, key?: NodeKey) {
    super(key);
    this.__text = text;
    this.__raw = raw;
  }

  override exportJSON(): SerializedRaw {
    return { ...super.exportJSON(), text: this.__text, raw: this.__raw };
  }

  override createDOM(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'page-block';
    return div;
  }

  override updateDOM() {
    return false;
  }

  override isInline() {
    return false;
  }

  getText() {
    return this.getLatest().__text;
  }

  setText(text: string) {
    this.getWritable().__text = text;
    return this;
  }

  override getTextContent() {
    return this.__text;
  }

  markdown() {
    return this.getLatest().__text;
  }

  getRaw() {
    return this.getLatest().__raw;
  }

  override decorate(): ReactNode {
    if (this.__raw === 'diagram') return <DiagramBlock text={this.__text} nodeKey={this.__key} />;
    if (this.__raw === 'ink') return <InkBlock text={this.__text} nodeKey={this.__key} />;
    return <RawBlock text={this.__text} raw={this.__raw} nodeKey={this.__key} />;
  }
}

export const $createRawBlockNode = (text: string, raw: RawKind) =>
  $applyNodeReplacement(new RawBlockNode(text, raw));
export const $isRawBlockNode = (node: LexicalNode | null | undefined): node is RawBlockNode =>
  node instanceof RawBlockNode;

// ── Callouts ────────────────────────────────────────────────────────────────

/** The tones GitHub writes (`> [!NOTE]`), each with its look. */
export const CALLOUT_TONES = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];
export const isCalloutTone = (value: string): value is CalloutTone =>
  (CALLOUT_TONES as readonly string[]).includes(value);

type SerializedCallout = Spread<{ tone: CalloutTone }, SerializedElementNode>;

export class CalloutNode extends ElementNode {
  __tone: CalloutTone;

  static override getType() {
    return 'page-callout';
  }

  static override clone(node: CalloutNode) {
    return new CalloutNode(node.__tone, node.__key);
  }

  static override importJSON(json: SerializedCallout) {
    return $createCalloutNode(json.tone).updateFromJSON(json);
  }

  constructor(tone: CalloutTone = 'NOTE', key?: NodeKey) {
    super(key);
    this.__tone = tone;
  }

  override exportJSON(): SerializedCallout {
    return { ...super.exportJSON(), tone: this.__tone };
  }

  override createDOM(config: EditorConfig): HTMLElement {
    const div = document.createElement('div');
    div.className = `page-callout page-callout--${this.__tone.toLowerCase()}`;
    const theme = config.theme.callout as string | undefined;
    if (theme) div.classList.add(...theme.split(' '));
    return div;
  }

  override updateDOM(previous: CalloutNode, dom: HTMLElement) {
    if (previous.__tone !== this.__tone) {
      dom.className = `page-callout page-callout--${this.__tone.toLowerCase()}`;
    }
    return false;
  }

  getTone() {
    return this.getLatest().__tone;
  }

  setTone(tone: CalloutTone) {
    this.getWritable().__tone = tone;
    return this;
  }

  // Enter goes on in a paragraph after it, as after a heading.
  override insertNewAfter(_selection: RangeSelection, restoreSelection = true): ElementNode {
    const paragraph = $createParagraphNode();
    this.insertAfter(paragraph, restoreSelection);
    return paragraph;
  }

  override collapseAtStart() {
    return false;
  }
}

export const $createCalloutNode = (tone: CalloutTone = 'NOTE') =>
  $applyNodeReplacement(new CalloutNode(tone));
export const $isCalloutNode = (node: LexicalNode | null | undefined): node is CalloutNode =>
  node instanceof CalloutNode;
