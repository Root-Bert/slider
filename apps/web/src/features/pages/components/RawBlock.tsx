import { $getNodeByKey, type NodeKey } from 'lexical';
import { useState } from 'react';
import { AutosizeTextarea, cn } from '@/ui';
import { $isRawBlockNode, type RawKind } from '../lib/nodes';
import { useBlockPick } from './useBlockPick';

/** A table's rows as cells: the line under the head left out, `\|` a bar in a cell. */
export function tableRows(text: string): string[][] {
  return text
    .split('\n')
    .filter((line, index) => index !== 1 && line.trim() !== '')
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim().replace(/\\\|/g, '|')),
    );
}

/**
 * What the page keeps as it is written: a table drawn as one, anything else (HTML, a reference)
 * as its text. In Bearbeiten a double click opens its Markdown to type into, in its place.
 */
export function RawBlock({ text, raw, nodeKey }: { text: string; raw: RawKind; nodeKey: NodeKey }) {
  const { editable, picked, pick, editor } = useBlockPick(nodeKey);
  const [typing, setTyping] = useState<string | null>(null);

  const done = () => {
    if (typing === null) return;
    const next = typing;
    setTyping(null);
    if (next === text) return;
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (!$isRawBlockNode(node)) return;
      if (next.trim() === '') node.remove();
      else node.setText(next);
    });
  };

  if (editable && typing !== null) {
    return (
      <AutosizeTextarea
        autoFocus
        value={typing}
        aria-label="Markdown"
        className="page-raw-field"
        onChange={(event) => setTyping(event.target.value)}
        onBlur={done}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
            event.preventDefault();
            done();
          }
        }}
      />
    );
  }

  const rows = raw === 'table' ? tableRows(text) : null;
  return (
    <div
      className={cn('page-raw', picked && 'page-picked')}
      onClick={pick}
      onDoubleClick={() => editable && setTyping(text)}
      title={editable ? 'Doppelklick: als Markdown bearbeiten' : undefined}
    >
      {rows ? (
        <table className="page-table">
          <thead>
            <tr>
              {rows[0]?.map((cell, index) => <th key={index}>{cell}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.slice(1).map((row, index) => (
              <tr key={index}>
                {row.map((cell, column) => (
                  <td key={column}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <pre className="page-raw-text">{text}</pre>
      )}
    </div>
  );
}
