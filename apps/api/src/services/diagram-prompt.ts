/**
 * What a page draws of Mermaid – said to the AI that writes a page without Cloud's tools (the
 * document AI): it cannot make a diagram file, so it draws in the page. The page draws it itself
 * (apps/web `features/pages/lib/diagram`), „In Diagramm umwandeln“ makes it a file; anything else
 * of Mermaid stays a code block. AIs with Cloud's tools get `DIAGRAM_FILE_NOTE`.
 */
export const DIAGRAM_NOTE = [
  'A page draws a flow or dependency diagram from a ```mermaid code block in Mermaid flowchart',
  'syntax – use one wherever a flow, a structure or dependencies are clearer drawn than written.',
  'Drawn: the header `flowchart TD` (or `graph`; TD/TB/BT/LR/RL); boxes `A[Text]`, `A(Text)`,',
  '`A([Text])`, `A[[Text]]`, `A[(Text)]`, `A((Text))`, `A{Text}`, `A{{Text}}`, `A[/Text/]`,',
  '`A>Text]`; arrows `-->`, `---`, `-.->`, `==>`, `--o`, `--x`, `<-->`, with words as `-->|Text|`',
  'or `-- Text -->`; chains `A --> B --> C` and `A & B --> C`; groups `subgraph id [Title] …',
  'end` (nested, `direction LR` inside); colours by `classDef`, `class`, `:::name` and `style`;',
  'a title by front matter (`---` / `title: …` / `---`); `%%` comments; `<br>` for a new line in a',
  'box. Text with ( ) [ ] { } | " # ; : in it goes in quotes: `A["Text (x)"]`. Ids are short',
  "(A, B, … or words without spaces); a box's text is written once, where it is first named.",
  'Keep one diagram to about 25 boxes – more is split into an overview and one diagram per',
  'part. Other Mermaid diagrams (sequence, class, state, gantt …) are only shown as code.',
].join(' ');

/**
 * How an AI with Cloud's tools draws (the Cloud chat, the agents, the AI apps over MCP): a diagram
 * is a file of its own, drawn and changed by hand in its editor – a page shows it by its line.
 */
export const DIAGRAM_FILE_NOTE = [
  'A flow, dependencies, a structure or an org chart is drawn as a diagram – a file of its own',
  '(.diagram) that people open and change by hand: create_diagram makes it, read_diagram reads',
  'it, edit_diagram changes it. A page (.md) shows a diagram by its line `[[file:<id>|<Name>.diagram]]`',
  '(as create_diagram and read_diagram give it) alone on a line of its own. Make a diagram for a',
  "page in the page's own folder or area, so whoever sees the page sees it too. Never write",
  'Mermaid for a new diagram.',
].join(' ');

/** The line that shows a diagram on a page – the page reads it as the diagram, drawn. */
export const diagramLine = (id: string, fileName: string) =>
  `[[file:${id}|${fileName.replace(/[\]}\n]/g, ' ')}]]`;
