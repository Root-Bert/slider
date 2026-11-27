import { $isCodeNode, CodeNode } from '@lexical/code-core';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $createNodeSelection, $getNodeByKey, $setSelection, type NodeKey } from 'lexical';
import { useEffect, useMemo, useState } from 'react';
import { cn, Icon } from '@/ui';
import { diagramFromMermaid } from '../lib/diagram/convert';
import { layoutDiagram, type Placed } from '../lib/diagram/layout';
import { isFlowchart, parseDiagram, type Diagram } from '../lib/diagram/parse';
import { $createDiagramEmbedNode, $createRawBlockNode, $isRawBlockNode } from '../lib/nodes';
import { DiagramView, MIN_SCALE } from './DiagramView';
import { usePageHost } from './PageHost';
import { useBlockPick } from './useBlockPick';

/*
 * A ```mermaid flowchart on a page (as agents and other tools write them), drawn – not edited
 * here: picked in Bearbeiten, „In Diagramm umwandeln“ makes it a diagram of its own (a Cloud file,
 * drawn in the editor) that takes its place on the page.
 */

/** The fence's lines around the diagram's text. */
function bodyOf(text: string): string {
  const lines = text.split('\n');
  const last = lines.at(-1)?.trim() ?? '';
  const closed = lines.length > 1 && /^[`~]{3,}$/.test(last);
  return lines.slice(1, closed ? -1 : undefined).join('\n');
}

type Drawn = { diagram: Diagram; placed: Placed } | { error: string; line: number | null };

function draw(body: string): Drawn {
  const parsed = parseDiagram(body);
  if ('error' in parsed) return parsed;
  return { diagram: parsed.diagram, placed: layoutDiagram(parsed.diagram) };
}

/** Bumps once the page's face is loaded: measured before, the boxes would not fit their words. */
function useFontsReady(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return;
    let alive = true;
    void document.fonts.ready.then(() => alive && setTick((value) => value + 1));
    return () => {
      alive = false;
    };
  }, []);
  return tick;
}

export function DiagramBlock({ text, nodeKey }: { text: string; nodeKey: NodeKey }) {
  const { editable, picked, pick, editor } = useBlockPick(nodeKey);
  const host = usePageHost();
  const fonts = useFontsReady();
  const body = bodyOf(text);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fonts` re-measures once the face is in.
  const drawn = useMemo(() => draw(body), [body, fonts]);
  const [turning, setTurning] = useState(false);

  if ('error' in drawn) {
    return (
      <div className={cn('page-diagram', picked && 'page-picked')} onClick={pick}>
        <p className="page-diagram-problem">
          <Icon name="warning" size={16} />
          {drawn.line !== null ? `Zeile ${drawn.line + 1}: ` : ''}
          {drawn.error}
        </p>
        <pre className="page-raw-text">{body}</pre>
      </div>
    );
  }

  const title = drawn.diagram.title;
  const turn = async () => {
    if (!host.createDiagram || turning) return;
    setTurning(true);
    // A title as long as a file's name may be (the front matter's may be longer).
    const name = title?.trim().slice(0, 200) || 'Diagramm';
    const file = await host.createDiagram(name, diagramFromMermaid(drawn.diagram));
    setTurning(false);
    if (!file) return;
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (!$isRawBlockNode(node)) return;
      // It stays picked as what it now is (the old block's pick would point at nothing).
      const embed = $createDiagramEmbedNode(file.id, file.name);
      node.replace(embed);
      const selection = $createNodeSelection();
      selection.add(embed.getKey());
      $setSelection(selection);
    });
  };

  return (
    <div className={cn('page-diagram', picked && 'page-picked')} onClick={pick}>
      {title && <p className="page-diagram-title">{title}</p>}
      <div className="page-diagram-scroll">
        <div
          className="page-diagram-canvas"
          style={{
            width: drawn.placed.width,
            minWidth: Math.round(drawn.placed.width * MIN_SCALE),
          }}
        >
          <DiagramView placed={drawn.placed} label={title ?? 'Diagramm'} />
        </div>
      </div>
      {editable && picked && host.createDiagram && (
        <div className="page-diagram-bar" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="page-diagram-tool"
            disabled={turning}
            onClick={() => void turn()}
          >
            <Icon name="accountTree" size={16} />
            In Diagramm umwandeln
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * A flowchart pasted into a ```mermaid code block is drawn at once – as the file shows it when
 * opened again. One still being typed stays code until it draws something.
 */
export function DiagramPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerNodeTransform(CodeNode, (node) => {
        if (!$isCodeNode(node) || node.getLanguage()?.toLowerCase() !== 'mermaid') return;
        const code = node.getTextContent();
        if (!isFlowchart(code)) return;
        const parsed = parseDiagram(code);
        if ('error' in parsed || parsed.diagram.edges.length === 0) return;
        node.replace($createRawBlockNode(`\`\`\`mermaid\n${code}\n\`\`\``, 'diagram'));
      }),
    [editor],
  );
  return null;
}
