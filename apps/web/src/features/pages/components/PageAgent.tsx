import type { WriterOpened } from '@slider/shared';
import type { LexicalEditor } from 'lexical';
import { use, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { VoiceBarView, VoiceContext } from '@/features/viewer';
import { DocumentVoiceProvider, useWriterVoice, type DocumentVoiceLook } from '@/features/writer';
import { ringColor } from '@/lib/accent';
import { useMe } from '@/lib/api';
import { IconButton } from '@/ui';
import { PAGE_AGENT_STATE, type PageAgentArrival } from '../lib/agent';
import { $anchorOf, lineAt, linesInView, showLine } from '../lib/look';
import type { PageSync } from '../lib/sync';
import { AgentBar } from './AgentBar';
import { usePageHost } from './PageHost';

/*
 * The agent bar with speaking: the page's document session (`DocumentVoiceProvider`, as Writer's)
 * looks at the page through its lines – the blocks in the window, under the pointer, the caret –,
 * and the microphone in the bar turns it into the voice bar until what was said is sent.
 */

export interface PageAgentProps {
  editor: LexicalEditor;
  sync: RefObject<PageSync | null>;
  document: WriterOpened['document'];
  frame: RefObject<HTMLElement | null>;
}

export function PageAgent({ editor, sync, document: file, frame }: PageAgentProps) {
  // Arrived from Notizen: read once, then taken out of the history (a reload asks nothing again).
  const location = useLocation();
  const navigate = useNavigate();
  const [arrival] = useState(
    () =>
      ((location.state as Record<string, unknown> | null)?.[PAGE_AGENT_STATE] as
        PageAgentArrival | undefined) ?? null,
  );
  const cleared = useRef(false);
  useEffect(() => {
    if (!arrival || cleared.current) return;
    cleared.current = true;
    void navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [arrival, location.pathname, location.search, navigate]);
  const look = useMemo<DocumentVoiceLook>(
    () => ({
      sample: (pointer) => {
        const page = sync.current;
        if (!page) return { paragraphs: [], pointer: null, selection: null };
        const anchor = editor.read(() => $anchorOf(page.codec));
        return {
          paragraphs: linesInView(editor, page.codec).slice(0, 120),
          pointer: pointer ? lineAt(editor, page.codec, pointer.x, pointer.y) : null,
          selection: anchor && {
            paragraphId: anchor.paragraphId,
            start: anchor.start,
            end: anchor.end,
            text: anchor.quote,
          },
        };
      },
      show: (lineId) => {
        const page = sync.current;
        if (page) showLine(editor, page.codec, lineId);
      },
    }),
    [editor, sync],
  );
  return (
    <DocumentVoiceProvider
      documentId={file.id}
      mayComment={file.permissions.canComment}
      look={look}
      onOpen={(item) => {
        if (item.paragraphId) look.show(item.paragraphId);
      }}
    >
      <Bar editor={editor} sync={sync} document={file} frame={frame} arrival={arrival} />
    </DocumentVoiceProvider>
  );
}

function Bar({
  editor,
  sync,
  document: file,
  frame,
  arrival,
}: PageAgentProps & { arrival: PageAgentArrival | null }) {
  const host = usePageHost();
  // Inside `DocumentVoiceProvider`, always there.
  const voice = use(VoiceContext)!;
  const speaking = useWriterVoice();
  const me = useMe().data?.viewer.author;
  const open = voice.status !== 'off' || voice.error !== null;
  const ai = speaking?.ai;
  // Made from Notizen by its microphone: listening starts as soon as it can.
  const spoke = useRef(false);
  const canSpeak = !!speaking?.available;
  const { status, toggle } = voice;
  useEffect(() => {
    if (!arrival?.speak || spoke.current || !canSpeak || status !== 'off') return;
    spoke.current = true;
    toggle();
  }, [arrival, canSpeak, status, toggle]);
  return (
    <AgentBar
      workspaceId={file.workspaceId}
      documentId={file.id}
      keep={`page-agent:${file.id}`}
      placeholder="Sag der KI, was sich an der Seite ändern soll"
      notify={host.notify}
      asked={arrival?.asked ?? null}
      frame={frame}
      flush={() => sync.current?.flush()}
      anchor={() => {
        const page = sync.current;
        return page ? editor.read(() => $anchorOf(page.codec)) : null;
      }}
      onLeave={() => editor.focus()}
      voice={
        speaking?.available && ai && me
          ? {
              button: (
                <IconButton
                  icon="mic"
                  label={`Mit ${ai.name} sprechen`}
                  title={`Mit ${ai.name} sprechen – zeig dabei mit der Maus oder dem Cursor, was du meinst`}
                  size="compact"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    // What was typed is in the file before the first words reach the AI.
                    sync.current?.flush();
                    voice.toggle();
                  }}
                />
              ),
              bar: open ? (
                <VoiceBarView
                  host={{
                    aiAuthor: ai,
                    color: ringColor(me.color),
                    place: (item) => (item.threadId === item.commentId ? 'Kommentar' : 'Ergänzung'),
                    open: (item) => {
                      if ('paragraphId' in item && item.paragraphId) speaking.open(item);
                    },
                    hint: `Geh durch die Seite und zeig mit der Maus oder dem Cursor, was du meinst. Fertige Gedanken gehen sofort an ${ai.name}. Senden beendet das Zuhören, was du gesagt hast, wird noch fertig bearbeitet. Auch: „geh zum Abschnitt …“, „vergiss das“, „mach das rückgängig“, „Stopp“.`,
                    listAbove: true,
                    className: 'pointer-events-auto relative w-full max-w-[720px] @container',
                  }}
                />
              ) : null,
            }
          : undefined
      }
    />
  );
}
