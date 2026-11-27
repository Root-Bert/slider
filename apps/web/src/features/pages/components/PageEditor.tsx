import type { WriterOpened, WriterStep } from '@slider/shared';
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin';
import { ClickableLinkPlugin } from '@lexical/react/LexicalClickableLinkPlugin';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { TabIndentationPlugin } from '@lexical/react/LexicalTabIndentationPlugin';
import { mergeRegister } from '@lexical/utils';
import {
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type EditorThemeClasses,
} from 'lexical';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useRef } from 'react';
import { documentLiveUrl, fetchDocument, sendDocumentEdit, writerKeys } from '@/lib/api/writer';
import { PageSync, type PageSyncState } from '../lib/sync';
import { PAGE_NODES, PAGE_TRANSFORMERS } from '../lib/transformers';
import { PageAgent } from './PageAgent';
import { DiagramPlugin } from './DiagramBlock';
import { FormatBar } from './FormatBar';
import { InAppLinks } from './InAppLinks';
import { usePageHost } from './PageHost';
import { SlashMenu } from './SlashMenu';
import './page.css';

/*
 * A page: a Markdown file in Cloud, read as Notion shows a page. Lesen is how it opens – a click
 * in it selects words, follows a link, nothing else. Bearbeiten (the owner's button) makes the
 * same page typable where it stands: nothing moves, nothing appears around it but the caret, the
 * slash menu („/“) and the format bar over selected words. Esc and ⌘↵ go back to Lesen. What is
 * typed is in the file 600 ms later (`sync.ts`); someone else's typing comes in as it is saved.
 */

const THEME: EditorThemeClasses = {
  paragraph: 'page-p',
  heading: {
    h1: 'page-h1',
    h2: 'page-h2',
    h3: 'page-h3',
    h4: 'page-h4',
    h5: 'page-h4',
    h6: 'page-h4',
  },
  quote: 'page-quote',
  list: {
    ul: 'page-ul',
    ol: 'page-ol',
    listitem: 'page-li',
    listitemChecked: 'page-li-check page-li-checked',
    listitemUnchecked: 'page-li-check',
    nested: { listitem: 'page-li-nested' },
    checklist: 'page-checklist',
  },
  link: 'page-anchor',
  code: 'page-code',
  hr: 'page-rule',
  hrSelected: 'page-picked',
  text: {
    bold: 'page-bold',
    italic: 'page-italic',
    underline: 'page-underline',
    strikethrough: 'page-strike',
    underlineStrikethrough: 'page-underline page-strike',
    code: 'page-inline-code',
  },
};

type LiveEvent = { type: 'step'; step: WriterStep } | { type: 'restored' } | { type: string };

const RECONNECT_MS = 3000;

export interface PageEditorProps {
  opened: WriterOpened;
  editing: boolean;
  /** Esc or ⌘↵ in Bearbeiten: back to Lesen. */
  onDone: () => void;
  onSync?: (state: PageSyncState) => void;
  /** Shown in an empty page while it is typed in. */
  placeholder?: string;
}

export function PageEditor(props: PageEditorProps) {
  const id = props.opened.document.id;
  return (
    <LexicalComposer
      key={id}
      initialConfig={{
        namespace: `page-${id}`,
        nodes: PAGE_NODES,
        theme: THEME,
        editable: false,
        onError: (error) => {
          console.error(error);
        },
      }}
    >
      <PageBody {...props} />
    </LexicalComposer>
  );
}

function PageBody({ opened, editing, onDone, onSync, placeholder }: PageEditorProps) {
  const [editor] = useLexicalComposerContext();
  const host = usePageHost();
  const sync = useRef<PageSync | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const id = opened.document.id;

  const onState = useEffectEvent((state: PageSyncState) => onSync?.(state));
  const onRefused = useEffectEvent((message: string) => host.notify(message, 'danger'));

  // ── The file and the editor ───────────────────────────────────────────────
  useEffect(() => {
    const page = new PageSync(editor, opened.content, {
      send: (input) => sendDocumentEdit(id, input),
      refetch: () => fetchDocument(id).then((fresh) => fresh.content),
      onState,
      onRefused,
    });
    sync.current = page;
    page.load();
    const off = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves, tags }) => {
      if (tags.has('page-load') || !editor.isEditable()) return;
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
      page.changed();
    });
    const leave = () => page.flush();
    window.addEventListener('pagehide', leave);
    return () => {
      off();
      window.removeEventListener('pagehide', leave);
      page.dispose();
      sync.current = null;
    };
    // The file read once per page: what comes after comes as steps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, id]);

  // ── Lesen and Bearbeiten ──────────────────────────────────────────────────
  useEffect(() => {
    editor.setEditable(editing);
    if (editing) editor.focus();
    else sync.current?.flush();
  }, [editor, editing]);

  const done = useEffectEvent(() => onDone());
  useEffect(
    () =>
      mergeRegister(
        // Above RichText's own Esc (it blurs), below the slash menu's (NORMAL): an open menu closes first.
        editor.registerCommand(
          KEY_ESCAPE_COMMAND,
          () => {
            if (!editor.isEditable()) return false;
            done();
            return true;
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          KEY_ENTER_COMMAND,
          (event) => {
            if (!event || !(event.metaKey || event.ctrlKey) || !editor.isEditable()) return false;
            event.preventDefault();
            done();
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
      ),
    [editor],
  );

  // ── The others ────────────────────────────────────────────────────────────
  useEffect(() => {
    let source: EventSource | null = null;
    let timer = 0;
    let down = false;
    let closed = false;
    const open = () => {
      const stream = new EventSource(documentLiveUrl(id), { withCredentials: true });
      source = stream;
      stream.addEventListener('open', () => {
        if (!down) return;
        down = false;
        void sync.current?.resync();
      });
      stream.addEventListener('document', (message) => {
        const event = JSON.parse((message as MessageEvent<string>).data) as LiveEvent;
        if (event.type === 'step' && 'step' in event) sync.current?.remote(event.step);
        else if (event.type === 'restored') void sync.current?.resync();
        // The AI began or ended on a comment (the agent bar's): how it went is read anew.
        else if (event.type === 'comments') {
          void queryClient.invalidateQueries({ queryKey: writerKeys.aiProposals(id) });
        }
      });
      stream.addEventListener('error', () => {
        down = true;
        if (stream.readyState === EventSource.CLOSED && !closed) {
          timer = window.setTimeout(open, RECONNECT_MS);
        }
      });
    };
    open();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      source?.close();
    };
  }, [id, queryClient]);

  const canAsk = opened.document.permissions.canEdit;
  return (
    // Bearbeiten: room under the last line for the agent bar floating over it.
    <div
      ref={frame}
      className={editing && canAsk ? 'page-frame pb-32' : 'page-frame'}
      data-editing={editing || undefined}
    >
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            className="page-body"
            aria-label={opened.document.title}
            aria-placeholder={placeholder ?? 'Schreib etwas oder „/“ für Blöcke'}
            placeholder={(isEditable) =>
              isEditable ? (
                <div className="page-placeholder">
                  {placeholder ?? 'Schreib etwas oder „/“ für Blöcke'}
                </div>
              ) : null
            }
          />
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <ListPlugin />
      <CheckListPlugin />
      <TabIndentationPlugin />
      <InAppLinks />
      <ClickableLinkPlugin />
      <MarkdownShortcutPlugin transformers={PAGE_TRANSFORMERS} />
      {editing && <SlashMenu />}
      {editing && <DiagramPlugin />}
      {editing && <FormatBar />}
      {editing && canAsk && (
        <PageAgent editor={editor} sync={sync} document={opened.document} frame={frame} />
      )}
    </div>
  );
}
