/** The look of a sticker's rich text, shared by the editor and `RichText`. */
export const RICH_THEME = {
  paragraph: 'm-0',
  heading: { h1: 'm-0 text-[1.5em] leading-tight font-bold', h2: 'm-0 text-[1.2em] font-bold' },
  list: {
    ul: 'm-0 list-disc pl-[1.25em]',
    ol: 'm-0 list-decimal pl-[1.4em]',
    listitem: 'm-0',
    nested: { listitem: 'list-none' },
  },
  link: 'underline underline-offset-2',
  text: {
    bold: 'font-bold',
    italic: 'italic',
    underline: 'underline',
    strikethrough: 'line-through',
    underlineStrikethrough: '[text-decoration:underline_line-through]',
  },
};
