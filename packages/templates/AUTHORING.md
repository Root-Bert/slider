# Writing a template

A template is one file `src/templates/<slug>.ts` whose default export is a `Template`
(`src/model.ts`). `bun src/build.ts <slug>` writes `library/<slug>.otp`, reads it back as Slider
reads an uploaded template, and has the real LibreOffice draw one filled slide per layout into
`previews/<slug>.jpg`. **Look at that picture** – a template is done when every layout on it looks
designed, not when the build passes. `src/templates/pop-art.ts` is the worked example.

## Rules

- Page: 28 × 15.75 cm. Lengths are cm, angles degrees clockwise, colours lower-case `#rrggbb`.
- Nine layouts, these names, this order: Titel, Abschnitt, Inhalt, Text und Bild, Zwei Spalten,
  Kennzahl, Zitat, Bild, Schluss. More may follow (own German names).
  - Titel / Schluss: `title` + `subtitle`. Abschnitt: `title` (+ `subtitle`).
  - Inhalt: `title` + `body`. Text und Bild: `title` + `body` + one picture.
  - Zwei Spalten: `title` + two `body` slots. Kennzahl: `title` is the number (huge), `body` what
    it means. Zitat: `body` is the quote (large), `subtitle` who said it. Bild: one large picture
    (+ `title` as its caption).
- A layout = `bg` + `shapes` (decoration, back to front, ≤ 250) + placeholders + `pictures`
  (boxes where a picture goes). Placeholders cannot be turned; decoration can.
- Decoration carries no words (no „Agenda“, no „Lorem“): symbols, numerals as ornament and
  single glyphs are fine. What a slide says comes from its placeholders.
- Text must fit: sample texts are realistic lengths; a title of two lines must not leave its box
  or run over decoration. Leave ≥ 1.2 cm to the page edge unless the style bleeds on purpose.
  Contrast between text and what is behind it must be clearly readable everywhere.
- Fonts: only Slider's (below). Faces a family lacks are faked by LibreOffice – don't ask for
  bold or italic where there is none.
- `paraSpace` only works in text standing at the top (`valign: 'top'`, the default of body and
  subtitle); in centred or bottom text it is left out, because Slider's editor and LibreOffice
  would place such text differently. Titles default to `valign: 'bottom'`.
- Lists draw Slider's own bullets („•“, „–“); a template cannot change them.
- Pictures are made by rule in the spec (`src/art.ts`, or your own canvas code in your file) –
  nothing downloaded, no photos, no existing artwork, logos, brands or characters. A template is
  ≤ 2 MB: whole-page grounds as JPEG (`jpeg`), one-colour pictures as `stencil`, the same picture
  for several layouts where it fits (same bytes are stored once).
- The ten palette colours are what people pick from in the editor: all ten different, usable
  together, `bg`/`text` the page and its text.
- `sample` texts are German, in the tone of the style. The preview's pictures come from the
  palette unless `samplePictures` gives own ones.
- `path`: draw anywhere in its `vb` – the file carries the frame of what the path really draws
  (LibreOffice puts a path's own bounds at the frame's corner, whatever the view box says).
- Several `body` boxes on one layout share the first one's text look (font, size, colour,
  alignment …): LibreOffice sets every outline of a page in it. Box, padding, `valign` and fill
  may differ. The build refuses a layout whose boxes differ.
- Bullets have no colour of their own: LibreOffice picks dark or light against the **page**
  ground, not against a panel under the text. Text with bullets on a light panel needs a light
  page ground (lay a dark full-page rect over it if the page should look dark), and the reverse.
- `lineHeight` in per cent multiplies the font's own line gap, which is large in some families
  (Source Sans 3, Literata, Jost, Oswald, Anton): start at 104–112 there and look.
- Large display type wraps earlier than its box suggests and `nowrap` does not stop it: give
  numerals and huge glyphs a generous box. A big glyph sits low in its line box, so set such
  boxes from the preview – or draw quote marks as shapes.
- Pictures are drawn above every shape and all text: no decoration across a picture place.
- `hatch` fills come out as faint hairlines; draw hatching as `line` shapes. A `text` shape
  ignores `r` (rounded label = `rect` + unfilled `text`). An `image` shape has no `opacity`.
- Dotted line: `dash: [0.01, step - 0.01]` with `cap: 'round'`.
- Many low-alpha canvas layers band (8-bit alpha): compute soft light per pixel instead.

## Toolbox

- `src/shapes.ts`: `page`, `inset`, `columns`, `rows`, `sunburst`, `stripes`, `slants`, `dots`,
  `gridLines`, `star`, `polygon`, `blob`, `wave`, `squiggle`, `ring`, `disc`, `rule`,
  `smoothPath`, `turned`.
- `src/art.ts`: `rng`, `noise`, `paint` → canvas, `jpeg` / `png` / `stencil`, `grain`, `paper`,
  `halftone`, `brushField`, `mesh`, `wash`, `bubble`, colour helpers `mix`, `lighten`, `darken`,
  `rgba`, `luma`.
- Fills: plain colour, `{ t: 'linear', angle, stops }` (90 = left → right, 180 = top → bottom),
  `{ t: 'radial', stops }` (0 = centre), `{ t: 'hatch', … }`, `opacity`, `fade`.
- Shapes: `rect` (`r` rounds), `ellipse` (`kind: 'section'` for pies), `poly`, `path` (SVG `d`
  with M L C Q Z), `line`, `text`, `image`; `stroke`, `shadow` (`blur` softens), `rotate`.

What LibreOffice does not draw: blur behind a shape, text outlines, text shadows, gradients in
letters, SVG filters. Bake such looks into a picture.

## Fonts

Four faces (regular, bold, italic, bold italic) unless noted.

Sans: Roboto, Open Sans, Noto Sans, Montserrat, Inter, Lato, Poppins, Roboto Condensed, Raleway,
Nunito, Ubuntu, Rubik, Work Sans, PT Sans, Source Sans 3, Nunito Sans, Fira Sans, Barlow, Barlow
Condensed, DM Sans, IBM Plex Sans, Karla, Titillium Web, Josefin Sans, Libre Franklin, Mulish,
Archivo, Plus Jakarta Sans, Figtree, Red Hat Display, Urbanist, Public Sans, Jost, Be Vietnam Pro,
Hanken Grotesk, Geist, Instrument Sans, Cabin, Exo 2, Kanit, Asap.
Sans, regular + bold only: Oswald, Manrope, Space Grotesk, Outfit, Lexend, Sora, Quicksand,
Bricolage Grotesque, Teko, Dosis, Comfortaa, Fredoka.
Display, regular only: Bebas Neue, Anton, Archivo Black, Fjalla One, Varela Round, Righteous,
Abril Fatface.
Serif: Playfair Display, Merriweather, Lora, Noto Serif, Source Serif 4, PT Serif, Libre
Baskerville, EB Garamond, Cormorant Garamond, Crimson Pro, Bitter, Zilla Slab, Arvo, Spectral,
Alegreya, Vollkorn, Literata, Fraunces, Newsreader.
Serif, fewer faces: Roboto Slab, Frank Ruhl Libre, Cinzel (regular + bold); DM Serif Display,
Instrument Serif (regular + italic).
Mono: Roboto Mono, Source Code Pro, JetBrains Mono, IBM Plex Mono, Space Mono; Fira Code,
Inconsolata (regular + bold).
Script and hand: Dancing Script, Caveat, Amatic SC (regular + bold); Pacifico, Lobster, Permanent
Marker, Indie Flower, Great Vibes, Satisfy (regular only).
Also: Carlito, Caladea, Liberation Sans / Serif / Mono, DejaVu Sans (for symbols such as ★ ✦ →).
